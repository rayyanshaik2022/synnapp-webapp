import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import {
  canArchiveRestoreActions,
  canEditActions,
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
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
    actionId: string;
  }>;
};

type ActionStatus = "open" | "done" | "blocked";
type ActionPriority = "high" | "medium" | "low";

type UpdateActionBody = {
  action?: unknown;
  archived?: unknown;
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

function parseDueAt(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizeDateToEpoch(value: Date | null) {
  return value ? value.getTime() : null;
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

async function resolveAuthorizedActionContext(
  request: NextRequest,
  workspaceSlug: string,
  actionId: string,
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
  if (requireWrite && !canEditActions(memberRole)) {
    return { error: "Viewers cannot edit actions.", status: 403 as const };
  }

  const actionRef = workspaceRef.collection("actions").doc(actionId);
  const memberDisplayName = normalizeText(memberSnapshot.get("displayName"));
  return {
    uid,
    memberRole,
    memberDisplayName,
    workspace,
    workspaceRef,
    actionRef,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, actionId } = await context.params;
    const authorizedContext = await resolveAuthorizedActionContext(
      request,
      workspaceSlug,
      actionId,
      false,
    );

    if ("error" in authorizedContext) {
      return NextResponse.json(
        { error: authorizedContext.error },
        { status: authorizedContext.status },
      );
    }

    const actionSnapshot = await authorizedContext.actionRef.get();
    if (!actionSnapshot.exists) {
      return NextResponse.json({ error: "Action not found." }, { status: 404 });
    }

    const data = actionSnapshot.data() as Record<string, unknown>;
    const dueAt = parseDate(data.dueAt);

    return NextResponse.json({
      ok: true,
      workspaceSlug: authorizedContext.workspace.workspaceSlug,
      action: {
        id: actionSnapshot.id,
        title: normalizeText(data.title) || normalizeText(data.description) || `Action ${actionSnapshot.id}`,
        description: normalizeText(data.description),
        owner: normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned",
        status: normalizeEnum(data.status, ACTION_STATUSES, "open"),
        priority: normalizeEnum(data.priority, ACTION_PRIORITIES, "medium"),
        project: normalizeText(data.project) || normalizeText(data.teamLabel) || "Workspace",
        dueAt: dueAt?.toISOString() ?? "",
        dueLabel: normalizeText(data.dueLabel),
        meetingId: normalizeText(data.meetingId),
        decisionId: normalizeText(data.decisionId),
        blockedReason: normalizeText(data.blockedReason),
        notes: normalizeText(data.notes),
        mentionUids: normalizeMentionUids(data.mentionUids),
        archived: data.archived === true,
        archivedAt: parseDate(data.archivedAt)?.toISOString() ?? "",
        archivedBy: normalizeText(data.archivedBy),
        createdAt: parseDate(data.createdAt)?.toISOString() ?? "",
        updatedAt: parseDate(data.updatedAt)?.toISOString() ?? "",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load action.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function patchHandler(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, actionId } = await context.params;
    const authorizedContext = await resolveAuthorizedActionContext(
      request,
      workspaceSlug,
      actionId,
      true,
    );

    if ("error" in authorizedContext) {
      return NextResponse.json(
        { error: authorizedContext.error },
        { status: authorizedContext.status },
      );
    }

    const body = (await request.json()) as UpdateActionBody;
    const action = normalizeActionPayload(body.action);
    const hasArchivedToggle = typeof body.archived === "boolean";
    const archivedToggle = hasArchivedToggle ? body.archived === true : null;

    if (!action && !hasArchivedToggle) {
      return NextResponse.json(
        { error: "Valid action payload or archived toggle is required." },
        { status: 400 },
      );
    }

    if (hasArchivedToggle && !canArchiveRestoreActions(authorizedContext.memberRole)) {
      return NextResponse.json(
        { error: "Only owners and admins can archive or restore actions." },
        { status: 403 },
      );
    }

    if (action && !action.title) {
      return NextResponse.json({ error: "Action title is required." }, { status: 400 });
    }

    const now = Timestamp.now();
    const actionSnapshot = await authorizedContext.actionRef.get();
    const wasExisting = actionSnapshot.exists;
    const existingData = (actionSnapshot.data() as Record<string, unknown> | undefined) ?? {};

    if (!action && !wasExisting) {
      return NextResponse.json({ error: "Action not found." }, { status: 404 });
    }

    if (!action && hasArchivedToggle) {
      const isArchived = archivedToggle === true;
      const wasArchived = existingData.archived === true;
      await authorizedContext.actionRef.set(
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
          entityRef: authorizedContext.actionRef,
          entity: "action",
          eventType: isArchived ? "archived" : "restored",
          source: "manual",
          actorUid: authorizedContext.uid,
          actorName:
            authorizedContext.memberDisplayName ||
            normalizeText(existingData.owner) ||
            "Workspace User",
          message: `${isArchived ? "Archived" : "Restored"} action ${actionId}.`,
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
        actionId,
        archived: isArchived,
      });
    }

    const userSnapshot = await adminDb.collection("users").doc(authorizedContext.uid).get();
    const actorName =
      normalizeText(userSnapshot.get("displayName")) ||
      normalizeText(existingData.owner) ||
      "Workspace User";

    const nextAction = action as NormalizedActionPayload;
    const owner = nextAction.owner || actorName;
    const nextProject =
      nextAction.project || authorizedContext.workspace.workspaceName || "Workspace";
    const dueAtTimestamp = nextAction.dueAt ? Timestamp.fromDate(nextAction.dueAt) : null;
    const existingCompletedAt = existingData.completedAt ?? null;
    const isArchived = archivedToggle === true;
    const wasArchived = existingData.archived === true;
    const nextMeetingId = nextAction.meetingId || "";
    const nextDecisionId = nextAction.decisionId || "";
    const nextBlockedReason =
      nextAction.status === "blocked" ? nextAction.blockedReason : "";
    const nextDescription = nextAction.description || nextAction.title;
    const nextDueSoon = nextAction.status === "open" && isDueSoon(nextAction.dueAt);
    const nextDueAtEpoch = normalizeDateToEpoch(nextAction.dueAt);
    const existingDueAtEpoch = normalizeDateToEpoch(parseDate(existingData.dueAt));
    const existingDueSoon = typeof existingData.dueSoon === "boolean" ? existingData.dueSoon : false;
    const existingMentionUids = normalizeMentionUids(existingData.mentionUids);
    const mentionUidResolution = await resolveWorkspaceMentionUids(
      authorizedContext.workspace.workspaceId,
      nextAction.mentionUids,
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
      normalizeText(existingData.title) !== nextAction.title ||
      normalizeText(existingData.description) !== nextDescription ||
      normalizeText(existingData.owner) !== owner ||
      normalizeEnum(existingData.status, ACTION_STATUSES, "open") !== nextAction.status ||
      normalizeEnum(existingData.priority, ACTION_PRIORITIES, "medium") !== nextAction.priority ||
      normalizeText(existingData.project) !== nextProject ||
      existingDueAtEpoch !== nextDueAtEpoch ||
      normalizeText(existingData.dueLabel) !== nextAction.dueLabel ||
      existingDueSoon !== nextDueSoon ||
      normalizeText(existingData.meetingId) !== nextMeetingId ||
      normalizeText(existingData.decisionId) !== nextDecisionId ||
      normalizeText(existingData.blockedReason) !== nextBlockedReason ||
      normalizeText(existingData.notes) !== nextAction.notes ||
      !areStringArraysEqual(existingMentionUids, mentionUids);
    const archivedStateChanged = wasArchived !== isArchived;

    const completedAt =
      nextAction.status === "done" ? existingCompletedAt ?? now : null;

    await authorizedContext.actionRef.set(
      {
        title: nextAction.title,
        description: nextDescription,
        owner,
        ownerUid: authorizedContext.uid,
        status: nextAction.status,
        priority: nextAction.priority,
        project: nextProject,
        dueAt: dueAtTimestamp,
        dueLabel: nextAction.dueLabel,
        dueSoon: nextDueSoon,
        meetingId: nextMeetingId,
        decisionId: nextDecisionId,
        blockedReason: nextBlockedReason,
        notes: nextAction.notes,
        mentionUids,
        completedAt,
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
        entityRef: authorizedContext.actionRef,
        entity: "action",
        eventType: "created",
        source: "manual",
        actorUid: authorizedContext.uid,
        actorName,
        message: `Created action ${actionId}.`,
        at: now,
        metadata: {
          meetingId: nextMeetingId,
        },
      });
    } else if (didContentChange) {
      await writeCanonicalHistoryEvent({
        entityRef: authorizedContext.actionRef,
        entity: "action",
        eventType: "updated",
        source: "manual",
        actorUid: authorizedContext.uid,
        actorName,
        message: `Updated action ${actionId}.`,
        at: now,
        metadata: {
          meetingId: nextMeetingId,
        },
      });
    }

    if (archivedStateChanged) {
      await writeCanonicalHistoryEvent({
        entityRef: authorizedContext.actionRef,
        entity: "action",
        eventType: isArchived ? "archived" : "restored",
        source: "manual",
        actorUid: authorizedContext.uid,
        actorName,
        message: `${isArchived ? "Archived" : "Restored"} action ${actionId}.`,
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
        entityType: "action",
        entityId: actionId,
        entityTitle: nextAction.title,
        entityPath: `/${authorizedContext.workspace.workspaceSlug}/actions/${actionId}`,
        mentionText: [
          nextAction.title,
          nextDescription,
          nextBlockedReason,
          nextAction.notes,
        ].join("\n"),
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
      actionId,
      archived: isArchived,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save action.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const PATCH = withWriteGuardrails(
  {
    routeId: "workspace.actions.update",
  },
  patchHandler,
);
