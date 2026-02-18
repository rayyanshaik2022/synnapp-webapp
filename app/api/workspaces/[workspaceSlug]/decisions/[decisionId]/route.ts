import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import {
  canArchiveRestoreDecisions,
  canEditDecisions,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";
import {
  emitMentionNotifications,
  normalizeMentionUids,
  resolveWorkspaceMentionUids,
} from "@/lib/notifications/mentions";
import {
  areStringArraysEqual,
  writeCanonicalHistoryEvent,
} from "@/lib/workspace/activity-history";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
    decisionId: string;
  }>;
};

type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";
type DecisionVisibility = "workspace" | "team" | "private";

type UpdateDecisionBody = {
  decision?: unknown;
  archived?: unknown;
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

function parseDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
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

async function resolveAuthorizedDecisionContext(
  request: NextRequest,
  workspaceSlug: string,
  decisionId: string,
  requireWrite = false,
) {
  const uid = await authenticateUid(request);
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    return { error: "Workspace not found.", status: 404 as const };
  }

  const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
  const memberSnapshot = await workspaceRef.collection("members").doc(uid).get();

  if (!memberSnapshot.exists) {
    return { error: "Access denied.", status: 403 as const };
  }

  const memberRole = parseWorkspaceMemberRole(memberSnapshot.get("role"));
  if (requireWrite && !canEditDecisions(memberRole)) {
    return { error: "Viewers cannot edit decisions.", status: 403 as const };
  }

  const decisionRef = workspaceRef.collection("decisions").doc(decisionId);
  const memberDisplayName = normalizeText(memberSnapshot.get("displayName"));
  return {
    uid,
    memberRole,
    memberDisplayName,
    workspace,
    workspaceRef,
    decisionRef,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, decisionId } = await context.params;
    const authorizedContext = await resolveAuthorizedDecisionContext(
      request,
      workspaceSlug,
      decisionId,
      false,
    );

    if ("error" in authorizedContext) {
      return NextResponse.json(
        { error: authorizedContext.error },
        { status: authorizedContext.status },
      );
    }

    const decisionSnapshot = await authorizedContext.decisionRef.get();
    if (!decisionSnapshot.exists) {
      return NextResponse.json({ error: "Decision not found." }, { status: 404 });
    }

    const data = decisionSnapshot.data() as Record<string, unknown>;

    return NextResponse.json({
      ok: true,
      workspaceSlug: authorizedContext.workspace.workspaceSlug,
      decision: {
        id: decisionSnapshot.id,
        title: normalizeText(data.title) || `Decision ${decisionSnapshot.id}`,
        statement: normalizeText(data.statement),
        rationale: normalizeText(data.rationale),
        owner: normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned",
        status: normalizeEnum(data.status, DECISION_STATUSES, "proposed"),
        visibility: normalizeEnum(data.visibility, DECISION_VISIBILITIES, "workspace"),
        teamLabel: normalizeText(data.teamLabel),
        tags: normalizeStringArray(data.tags),
        meetingId: normalizeText(data.meetingId),
        supersedesDecisionId: normalizeText(data.supersedesDecisionId),
        supersededByDecisionId: normalizeText(data.supersededByDecisionId),
        mentionUids: normalizeMentionUids(data.mentionUids),
        archived: data.archived === true,
        archivedAt: parseDate(data.archivedAt)?.toISOString() ?? "",
        archivedBy: normalizeText(data.archivedBy),
        createdAt: parseDate(data.createdAt)?.toISOString() ?? "",
        updatedAt: parseDate(data.updatedAt)?.toISOString() ?? "",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load decision.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, decisionId } = await context.params;
    const authorizedContext = await resolveAuthorizedDecisionContext(
      request,
      workspaceSlug,
      decisionId,
      true,
    );

    if ("error" in authorizedContext) {
      return NextResponse.json(
        { error: authorizedContext.error },
        { status: authorizedContext.status },
      );
    }

    const body = (await request.json()) as UpdateDecisionBody;
    const decision = normalizeDecisionPayload(body.decision);
    const hasArchivedToggle = typeof body.archived === "boolean";
    const archivedToggle = hasArchivedToggle ? body.archived === true : null;

    if (!decision && !hasArchivedToggle) {
      return NextResponse.json(
        { error: "Valid decision payload or archived toggle is required." },
        { status: 400 },
      );
    }

    if (hasArchivedToggle && !canArchiveRestoreDecisions(authorizedContext.memberRole)) {
      return NextResponse.json(
        { error: "Only owners and admins can archive or restore decisions." },
        { status: 403 },
      );
    }

    if (decision && !decision.title) {
      return NextResponse.json({ error: "Decision title is required." }, { status: 400 });
    }

    if (decision && !decision.statement) {
      return NextResponse.json(
        { error: "Decision statement is required." },
        { status: 400 },
      );
    }

    const now = Timestamp.now();
    const decisionSnapshot = await authorizedContext.decisionRef.get();
    const wasExisting = decisionSnapshot.exists;
    const existingData = (decisionSnapshot.data() as Record<string, unknown> | undefined) ?? {};

    if (!decision && !wasExisting) {
      return NextResponse.json({ error: "Decision not found." }, { status: 404 });
    }

    if (!decision && hasArchivedToggle) {
      const isArchived = archivedToggle === true;
      const wasArchived = existingData.archived === true;
      await authorizedContext.decisionRef.set(
        {
          archived: isArchived,
          archivedAt: isArchived ? existingData.archivedAt ?? now : null,
          archivedBy: isArchived ? authorizedContext.uid : "",
          updatedAt: now,
          updatedBy: authorizedContext.uid,
          createdAt: existingData.createdAt ?? now,
          createdBy: normalizeText(existingData.createdBy) || authorizedContext.uid,
        },
        { merge: true },
      );

      if (wasArchived !== isArchived) {
        await writeCanonicalHistoryEvent({
          entityRef: authorizedContext.decisionRef,
          entity: "decision",
          eventType: isArchived ? "archived" : "restored",
          source: "manual",
          actorUid: authorizedContext.uid,
          actorName:
            authorizedContext.memberDisplayName ||
            normalizeText(existingData.owner) ||
            "Workspace User",
          message: `${isArchived ? "Archived" : "Restored"} decision ${decisionId}.`,
          at: now,
          metadata: {
            meetingId: normalizeText(existingData.meetingId),
          },
        });
      }

      return NextResponse.json({
        ok: true,
        created: !wasExisting,
        workspaceSlug: authorizedContext.workspace.workspaceSlug,
        decisionId,
        archived: isArchived,
      });
    }

    const userSnapshot = await adminDb.collection("users").doc(authorizedContext.uid).get();
    const actorName =
      normalizeText(userSnapshot.get("displayName")) ||
      normalizeText(existingData.owner) ||
      "Workspace User";

    const nextDecision = decision as NormalizedDecisionPayload;
    const owner = nextDecision.owner || actorName;
    const teamLabel = nextDecision.visibility === "team" ? nextDecision.teamLabel : "";
    const allowedTeamIds =
      nextDecision.visibility === "team" ? buildAllowedTeamIds(teamLabel) : [];
    const isArchived = archivedToggle === true;
    const wasArchived = existingData.archived === true;
    const nextRationale = nextDecision.rationale || nextDecision.statement;
    const nextMeetingId = nextDecision.meetingId || "";
    const nextSupersedesDecisionId = nextDecision.supersedesDecisionId || "";
    const nextSupersededByDecisionId = nextDecision.supersededByDecisionId || "";
    const existingTags = normalizeStringArray(existingData.tags);
    const existingAllowedTeamIds = normalizeStringArray(existingData.allowedTeamIds);
    const existingMentionUids = normalizeMentionUids(existingData.mentionUids);
    const mentionUidResolution = await resolveWorkspaceMentionUids(
      authorizedContext.workspace.workspaceId,
      nextDecision.mentionUids,
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

    const didContentChange =
      !wasExisting ||
      normalizeText(existingData.title) !== nextDecision.title ||
      normalizeText(existingData.statement) !== nextDecision.statement ||
      normalizeText(existingData.rationale) !== nextRationale ||
      normalizeText(existingData.owner) !== owner ||
      normalizeEnum(existingData.status, DECISION_STATUSES, "proposed") !==
        nextDecision.status ||
      normalizeEnum(existingData.visibility, DECISION_VISIBILITIES, "workspace") !==
        nextDecision.visibility ||
      normalizeText(existingData.teamLabel) !== teamLabel ||
      !areStringArraysEqual(existingAllowedTeamIds, allowedTeamIds) ||
      !areStringArraysEqual(existingTags, nextDecision.tags) ||
      normalizeText(existingData.meetingId) !== nextMeetingId ||
      normalizeText(existingData.supersedesDecisionId) !== nextSupersedesDecisionId ||
      normalizeText(existingData.supersededByDecisionId) !== nextSupersededByDecisionId ||
      !areStringArraysEqual(existingMentionUids, mentionUids);
    const archivedStateChanged = wasArchived !== isArchived;

    await authorizedContext.decisionRef.set(
      {
        title: nextDecision.title,
        statement: nextDecision.statement,
        rationale: nextRationale,
        owner,
        ownerUid: authorizedContext.uid,
        status: nextDecision.status,
        visibility: nextDecision.visibility,
        teamLabel,
        allowedTeamIds,
        tags: nextDecision.tags,
        meetingId: nextMeetingId,
        supersedesDecisionId: nextSupersedesDecisionId,
        supersededByDecisionId: nextSupersededByDecisionId,
        mentionUids,
        supersededAt:
          nextDecision.status === "superseded"
            ? existingData.supersededAt ?? now
            : null,
        archived: isArchived,
        archivedAt: isArchived ? existingData.archivedAt ?? now : null,
        archivedBy: isArchived ? authorizedContext.uid : "",
        updatedAt: now,
        updatedBy: authorizedContext.uid,
        createdAt: existingData.createdAt ?? now,
        createdBy: normalizeText(existingData.createdBy) || authorizedContext.uid,
      },
      { merge: true },
    );

    if (!wasExisting) {
      await writeCanonicalHistoryEvent({
        entityRef: authorizedContext.decisionRef,
        entity: "decision",
        eventType: "created",
        source: "manual",
        actorUid: authorizedContext.uid,
        actorName,
        message: `Created decision ${decisionId}.`,
        at: now,
        metadata: {
          meetingId: nextMeetingId,
        },
      });
    } else if (didContentChange) {
      await writeCanonicalHistoryEvent({
        entityRef: authorizedContext.decisionRef,
        entity: "decision",
        eventType: "updated",
        source: "manual",
        actorUid: authorizedContext.uid,
        actorName,
        message: `Updated decision ${decisionId}.`,
        at: now,
        metadata: {
          meetingId: nextMeetingId,
        },
      });
    }

    if (archivedStateChanged) {
      await writeCanonicalHistoryEvent({
        entityRef: authorizedContext.decisionRef,
        entity: "decision",
        eventType: isArchived ? "archived" : "restored",
        source: "manual",
        actorUid: authorizedContext.uid,
        actorName,
        message: `${isArchived ? "Archived" : "Restored"} decision ${decisionId}.`,
        at: now,
        metadata: {
          meetingId: nextMeetingId,
        },
      });
    }

    if (didContentChange) {
      await emitMentionNotifications({
        workspaceId: authorizedContext.workspace.workspaceId,
        workspaceSlug: authorizedContext.workspace.workspaceSlug,
        workspaceName: authorizedContext.workspace.workspaceName,
        entityType: "decision",
        entityId: decisionId,
        entityTitle: nextDecision.title,
        entityPath: `/${authorizedContext.workspace.workspaceSlug}/decisions/${decisionId}`,
        mentionText: [nextDecision.title, nextDecision.statement, nextRationale].join("\n"),
        mentionUids,
        previousMentionUids: existingMentionUids,
        previousMentionText: "",
        actorUid: authorizedContext.uid,
        actorName,
        now,
      });
    }

    return NextResponse.json({
      ok: true,
      created: !wasExisting,
      workspaceSlug: authorizedContext.workspace.workspaceSlug,
      decisionId,
      archived: isArchived,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save decision.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
