import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import { canEditActions, parseWorkspaceMemberRole } from "@/lib/auth/permissions";
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

type ActionStatus = "open" | "done" | "blocked";
type ActionPriority = "high" | "medium" | "low";

type CreateActionBody = {
  action?: unknown;
};

type NormalizedActionPayload = {
  title: string;
  description: string;
  owner: string;
  status: ActionStatus;
  priority: ActionPriority;
  project: string;
  dueAt: Date | null;
  dueLabel: string;
  meetingId: string;
  decisionId: string;
  blockedReason: string;
  notes: string;
  mentionUids: string[];
};

const ACTION_STATUSES = new Set<ActionStatus>(["open", "done", "blocked"]);
const ACTION_PRIORITIES = new Set<ActionPriority>(["high", "medium", "low"]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const normalized = normalizeText(value) as T;
  if (allowed.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function parseDueAt(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatDueLabel(value: Date) {
  const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;

  if (hasTime) {
    return value.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function createActionId() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 900 + 100);
  return `A-${timestamp}${random}`;
}

function isDueSoon(date: Date | null) {
  if (!date) return false;
  const diff = date.getTime() - Date.now();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return diff >= 0 && diff <= twoDaysMs;
}

function normalizeActionPayload(value: unknown): NormalizedActionPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const dueAt = parseDueAt(candidate.dueAt);
  const explicitDueLabel = normalizeText(candidate.dueLabel);

  return {
    title: normalizeText(candidate.title),
    description: normalizeText(candidate.description),
    owner: normalizeText(candidate.owner),
    status: normalizeEnum(candidate.status, ACTION_STATUSES, "open"),
    priority: normalizeEnum(candidate.priority, ACTION_PRIORITIES, "medium"),
    project: normalizeText(candidate.project),
    dueAt,
    dueLabel: explicitDueLabel || (dueAt ? formatDueLabel(dueAt) : "No due date"),
    meetingId: normalizeText(candidate.meetingId),
    decisionId: normalizeText(candidate.decisionId),
    blockedReason: normalizeText(candidate.blockedReason),
    notes: normalizeText(candidate.notes),
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
    if (!canEditActions(memberRole)) {
      return NextResponse.json(
        { error: "Viewers cannot create actions." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CreateActionBody;
    const action = normalizeActionPayload(body.action);

    if (!action) {
      return NextResponse.json(
        { error: "Valid action payload is required." },
        { status: 400 },
      );
    }

    if (!action.title) {
      return NextResponse.json({ error: "Action title is required." }, { status: 400 });
    }

    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const actorName =
      normalizeText(userSnapshot.get("displayName")) ||
      normalizeText(memberSnapshot.get("displayName")) ||
      "Workspace User";

    const now = Timestamp.now();
    let actionRef = workspaceRef.collection("actions").doc(createActionId());
    let attempts = 0;

    while (attempts < 4) {
      const existingSnapshot = await actionRef.get();
      if (!existingSnapshot.exists) break;
      actionRef = workspaceRef.collection("actions").doc(createActionId());
      attempts += 1;
    }

    if ((await actionRef.get()).exists) {
      actionRef = workspaceRef.collection("actions").doc();
    }

    const owner = action.owner || actorName;
    const mentionUidResolution = await resolveWorkspaceMentionUids(
      workspace.workspaceId,
      action.mentionUids,
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

    await actionRef.set({
      title: action.title,
      description: action.description || action.title,
      owner,
      ownerUid: uid,
      status: action.status,
      priority: action.priority,
      project: action.project || workspace.workspaceName || "Workspace",
      dueAt: action.dueAt ? Timestamp.fromDate(action.dueAt) : null,
      dueLabel: action.dueLabel,
      dueSoon: action.status === "open" && isDueSoon(action.dueAt),
      meetingId: action.meetingId || "",
      decisionId: action.decisionId || "",
      blockedReason: action.status === "blocked" ? action.blockedReason : "",
      notes: action.notes,
      mentionUids,
      completedAt: action.status === "done" ? now : null,
      archived: false,
      archivedAt: null,
      archivedBy: "",
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });

    await writeCanonicalHistoryEvent({
      entityRef: actionRef,
      entity: "action",
      eventType: "created",
      source: "manual",
      actorUid: uid,
      actorName,
      message: `Created action ${actionRef.id}.`,
      at: now,
      metadata: {
        meetingId: action.meetingId || "",
      },
    });

    const nextDescription = action.description || action.title;
    const nextBlockedReason = action.status === "blocked" ? action.blockedReason : "";
    await emitMentionNotifications({
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
      workspaceName: workspace.workspaceName,
      entityType: "action",
      entityId: actionRef.id,
      entityTitle: action.title,
      entityPath: `/${workspace.workspaceSlug}/actions/${actionRef.id}`,
      mentionText: [
        action.title,
        nextDescription,
        nextBlockedReason,
        action.notes,
      ].join("\n"),
      mentionUids,
      previousMentionUids: [],
      previousMentionText: "",
      actorUid: uid,
      actorName,
      now,
    });

    return NextResponse.json({
      ok: true,
      workspaceSlug: workspace.workspaceSlug,
      actionId: actionRef.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create action.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withWriteGuardrails(
  {
    routeId: "workspace.actions.create",
  },
  postHandler,
);
