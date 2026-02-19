import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import { canEditDecisions, parseWorkspaceMemberRole } from "@/lib/auth/permissions";
import { writeCanonicalHistoryEvent } from "@/lib/workspace/activity-history";
import {
  emitMentionNotifications,
  normalizeMentionUids,
  resolveWorkspaceMentionUids,
} from "@/lib/notifications/mentions";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
  }>;
};

type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";
type DecisionVisibility = "workspace" | "team" | "private";

type CreateDecisionBody = {
  decision?: unknown;
};

type NormalizedDecisionPayload = {
  title: string;
  statement: string;
  rationale: string;
  owner: string;
  status: DecisionStatus;
  visibility: DecisionVisibility;
  teamLabel: string;
  tags: string[];
  meetingId: string;
  supersedesDecisionId: string;
  supersededByDecisionId: string;
  mentionUids: string[];
};

const DECISION_STATUSES = new Set<DecisionStatus>([
  "proposed",
  "accepted",
  "superseded",
  "rejected",
]);

const DECISION_VISIBILITIES = new Set<DecisionVisibility>([
  "workspace",
  "team",
  "private",
]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  value.forEach((entry) => {
    const normalized = normalizeText(entry);
    if (normalized) {
      unique.add(normalized);
    }
  });

  return Array.from(unique);
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const normalized = normalizeText(value) as T;
  if (allowed.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function createDecisionId() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 900 + 100);
  return `D-${timestamp}${random}`;
}

function buildAllowedTeamIds(teamLabel: string) {
  return teamLabel ? [teamLabel] : [];
}

function normalizeDecisionPayload(value: unknown): NormalizedDecisionPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  return {
    title: normalizeText(candidate.title),
    statement: normalizeText(candidate.statement),
    rationale: normalizeText(candidate.rationale),
    owner: normalizeText(candidate.owner),
    status: normalizeEnum(candidate.status, DECISION_STATUSES, "proposed"),
    visibility: normalizeEnum(candidate.visibility, DECISION_VISIBILITIES, "workspace"),
    teamLabel: normalizeText(candidate.teamLabel),
    tags: normalizeStringArray(candidate.tags),
    meetingId: normalizeText(candidate.meetingId),
    supersedesDecisionId: normalizeText(candidate.supersedesDecisionId),
    supersededByDecisionId: normalizeText(candidate.supersededByDecisionId),
    mentionUids: normalizeMentionUids(candidate.mentionUids),
  };
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function postHandler(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspaceBySlug(workspaceSlug);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
    const memberSnapshot = await workspaceRef.collection("members").doc(uid).get();

    if (!memberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const memberRole = parseWorkspaceMemberRole(memberSnapshot.get("role"));
    if (!canEditDecisions(memberRole)) {
      return NextResponse.json(
        { error: "Viewers cannot create decisions." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CreateDecisionBody;
    const decision = normalizeDecisionPayload(body.decision);

    if (!decision) {
      return NextResponse.json(
        { error: "Valid decision payload is required." },
        { status: 400 },
      );
    }

    if (!decision.title) {
      return NextResponse.json({ error: "Decision title is required." }, { status: 400 });
    }

    if (!decision.statement) {
      return NextResponse.json(
        { error: "Decision statement is required." },
        { status: 400 },
      );
    }

    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const actorName =
      normalizeText(userSnapshot.get("displayName")) ||
      normalizeText(memberSnapshot.get("displayName")) ||
      "Workspace User";

    const now = Timestamp.now();
    let decisionRef = workspaceRef.collection("decisions").doc(createDecisionId());
    let attempts = 0;

    while (attempts < 4) {
      const existingSnapshot = await decisionRef.get();
      if (!existingSnapshot.exists) break;
      decisionRef = workspaceRef.collection("decisions").doc(createDecisionId());
      attempts += 1;
    }

    if ((await decisionRef.get()).exists) {
      decisionRef = workspaceRef.collection("decisions").doc();
    }

    const owner = decision.owner || actorName;
    const teamLabel = decision.visibility === "team" ? decision.teamLabel : "";
    const allowedTeamIds =
      decision.visibility === "team" ? buildAllowedTeamIds(teamLabel) : [];
    const mentionUidResolution = await resolveWorkspaceMentionUids(
      workspace.workspaceId,
      decision.mentionUids,
    );
    if (mentionUidResolution.invalidMentionUids.length > 0) {
      return NextResponse.json(
        {
          error:
            "Mentions must reference members of this workspace. Remove invalid mentions and retry.",
        },
        { status: 400 },
      );
    }
    const mentionUids = mentionUidResolution.validMentionUids;

    await decisionRef.set({
      title: decision.title,
      statement: decision.statement,
      rationale: decision.rationale || decision.statement,
      owner,
      ownerUid: uid,
      status: decision.status,
      visibility: decision.visibility,
      teamLabel,
      allowedTeamIds,
      tags: decision.tags,
      meetingId: decision.meetingId || "",
      supersedesDecisionId: decision.supersedesDecisionId || "",
      supersededByDecisionId: decision.supersededByDecisionId || "",
      mentionUids,
      supersededAt: decision.status === "superseded" ? now : null,
      archived: false,
      archivedAt: null,
      archivedBy: "",
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });

    await writeCanonicalHistoryEvent({
      entityRef: decisionRef,
      entity: "decision",
      eventType: "created",
      source: "manual",
      actorUid: uid,
      actorName,
      message: `Created decision ${decisionRef.id}.`,
      at: now,
      metadata: {
        meetingId: decision.meetingId || "",
      },
    });

    const nextRationale = decision.rationale || decision.statement;
    await emitMentionNotifications({
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
      workspaceName: workspace.workspaceName,
      entityType: "decision",
      entityId: decisionRef.id,
      entityTitle: decision.title,
      entityPath: `/${workspace.workspaceSlug}/decisions/${decisionRef.id}`,
      mentionText: [decision.title, decision.statement, nextRationale].join("\n"),
      mentionUids,
      previousMentionUids: [],
      actorUid: uid,
      actorName,
      now,
    });

    return NextResponse.json({
      ok: true,
      workspaceSlug: workspace.workspaceSlug,
      decisionId: decisionRef.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create decision.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withWriteGuardrails(
  {
    routeId: "workspace.decisions.create",
  },
  postHandler,
);
