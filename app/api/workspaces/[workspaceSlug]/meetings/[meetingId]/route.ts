import { NextRequest, NextResponse } from "next/server";
import { type DocumentReference, Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import {
  canEditMeetings,
  canRestoreMeetingRevisions,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";
import {
  areStringArraysEqual,
  writeCanonicalHistoryEvent,
} from "@/lib/workspace/activity-history";
import { emitMentionNotifications } from "@/lib/notifications/mentions";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
    meetingId: string;
  }>;
};

type MeetingState = "scheduled" | "inProgress" | "completed";
type DigestState = "pending" | "sent";
type AgendaState = "queued" | "inProgress" | "done";
type QuestionStatus = "open" | "resolved";
type DecisionStatus = "proposed" | "accepted";
type ActionStatus = "open" | "blocked" | "done";
type ActionPriority = "high" | "medium" | "low";

type Attendee = {
  id: string;
  name: string;
  role: string;
  required: boolean;
  present: boolean;
};

type AgendaItem = {
  id: string;
  title: string;
  state: AgendaState;
};

type NoteSection = {
  id: string;
  heading: string;
  content: string;
};

type OpenQuestion = {
  id: string;
  question: string;
  owner: string;
  dueLabel: string;
  status: QuestionStatus;
};

type Decision = {
  id: string;
  title: string;
  owner: string;
  status: DecisionStatus;
  rationale: string;
};

type Action = {
  id: string;
  title: string;
  owner: string;
  dueLabel: string;
  priority: ActionPriority;
  status: ActionStatus;
};

type DigestRecipient = {
  id: string;
  label: string;
  enabled: boolean;
};

type MeetingRecordPayload = {
  title: string;
  team: string;
  owner: string;
  timeLabel: string;
  duration: string;
  location: string;
  objective: string;
  state: MeetingState;
  digest: DigestState;
  locked: boolean;
  revision: number;
  lastSentLabel: string;
  attendees: Attendee[];
  agenda: AgendaItem[];
  notes: NoteSection[];
  openQuestions: OpenQuestion[];
  decisions: Decision[];
  actions: Action[];
  digestRecipients: DigestRecipient[];
  digestOptions: {
    includeNotes: boolean;
    includeOpenQuestions: boolean;
    includeActionOwners: boolean;
  };
};

type UpdateMeetingBody = {
  meeting?: unknown;
  restoreFromRevisionId?: unknown;
};
type MeetingRevisionEventType = "created" | "updated" | "restored";
type MeetingRevisionSource = "meetingUpdate" | "restore";

const MEETING_STATES = new Set<MeetingState>(["scheduled", "inProgress", "completed"]);
const DIGEST_STATES = new Set<DigestState>(["pending", "sent"]);
const AGENDA_STATES = new Set<AgendaState>(["queued", "inProgress", "done"]);
const QUESTION_STATES = new Set<QuestionStatus>(["open", "resolved"]);
const DECISION_STATES = new Set<DecisionStatus>(["proposed", "accepted"]);
const ACTION_STATES = new Set<ActionStatus>(["open", "blocked", "done"]);
const ACTION_PRIORITIES = new Set<ActionPriority>(["high", "medium", "low"]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeRevision(value: unknown, fallback = 1) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const normalized = normalizeText(value) as T;
  if (allowed.has(normalized)) return normalized;
  return fallback;
}

function ensureId(value: unknown, prefix: string, index: number) {
  const normalized = normalizeText(value);
  if (normalized) return normalized;
  return `${prefix}-${index + 1}`;
}

function parseAttendees(value: unknown): Attendee[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const name = normalizeText(candidate.name);
      if (!name) return null;

      return {
        id: ensureId(candidate.id, "u", index),
        name,
        role: normalizeText(candidate.role) || "Participant",
        required: normalizeBoolean(candidate.required, true),
        present: normalizeBoolean(candidate.present, true),
      };
    })
    .filter((entry): entry is Attendee => entry !== null);
}

function parseAgenda(value: unknown): AgendaItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const title = normalizeText(candidate.title);
      if (!title) return null;

      return {
        id: ensureId(candidate.id, "ag", index),
        title,
        state: normalizeEnum(candidate.state, AGENDA_STATES, "queued"),
      };
    })
    .filter((entry): entry is AgendaItem => entry !== null);
}

function parseNotes(value: unknown): NoteSection[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const heading = normalizeText(candidate.heading);
      const content = normalizeText(candidate.content);
      if (!heading && !content) return null;

      return {
        id: ensureId(candidate.id, "n", index),
        heading: heading || `Notes ${index + 1}`,
        content,
      };
    })
    .filter((entry): entry is NoteSection => entry !== null);
}

function parseOpenQuestions(value: unknown): OpenQuestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const question = normalizeText(candidate.question);
      if (!question) return null;

      return {
        id: ensureId(candidate.id, "Q", index),
        question,
        owner: normalizeText(candidate.owner) || "Unassigned",
        dueLabel: normalizeText(candidate.dueLabel) || "No due date",
        status: normalizeEnum(candidate.status, QUESTION_STATES, "open"),
      };
    })
    .filter((entry): entry is OpenQuestion => entry !== null);
}

function parseDecisions(value: unknown): Decision[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const title = normalizeText(candidate.title);
      if (!title) return null;

      return {
        id: ensureId(candidate.id, "D", index),
        title,
        owner: normalizeText(candidate.owner) || "Unassigned",
        status: normalizeEnum(candidate.status, DECISION_STATES, "proposed"),
        rationale: normalizeText(candidate.rationale) || "Rationale to be added.",
      };
    })
    .filter((entry): entry is Decision => entry !== null);
}

function parseActions(value: unknown): Action[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const title = normalizeText(candidate.title);
      if (!title) return null;

      return {
        id: ensureId(candidate.id, "A", index),
        title,
        owner: normalizeText(candidate.owner) || "Unassigned",
        dueLabel: normalizeText(candidate.dueLabel) || "No due date",
        priority: normalizeEnum(candidate.priority, ACTION_PRIORITIES, "medium"),
        status: normalizeEnum(candidate.status, ACTION_STATES, "open"),
      };
    })
    .filter((entry): entry is Action => entry !== null);
}

function parseDigestRecipients(value: unknown): DigestRecipient[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const label = normalizeText(candidate.label);
      if (!label) return null;

      return {
        id: ensureId(candidate.id, "r", index),
        label,
        enabled: normalizeBoolean(candidate.enabled, index < 2),
      };
    })
    .filter((entry): entry is DigestRecipient => entry !== null);
}

function parseDigestOptions(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      includeNotes: true,
      includeOpenQuestions: true,
      includeActionOwners: true,
    };
  }

  const candidate = value as Record<string, unknown>;
  return {
    includeNotes: normalizeBoolean(candidate.includeNotes, true),
    includeOpenQuestions: normalizeBoolean(candidate.includeOpenQuestions, true),
    includeActionOwners: normalizeBoolean(candidate.includeActionOwners, true),
  };
}

function normalizeMeetingPayload(
  meetingId: string,
  value: unknown,
): MeetingRecordPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  const attendees = parseAttendees(candidate.attendees);
  const agenda = parseAgenda(candidate.agenda);
  const notes = parseNotes(candidate.notes);
  const openQuestions = parseOpenQuestions(candidate.openQuestions);
  const decisions = parseDecisions(candidate.decisions);
  const actions = parseActions(candidate.actions);
  const digestRecipients = parseDigestRecipients(candidate.digestRecipients);
  const objective = normalizeText(candidate.objective);

  return {
    title: normalizeText(candidate.title) || `Meeting ${meetingId}`,
    team: normalizeText(candidate.team) || "Workspace",
    owner: normalizeText(candidate.owner) || attendees[0]?.name || "Workspace User",
    timeLabel: normalizeText(candidate.timeLabel) || "Date TBD",
    duration: normalizeText(candidate.duration) || "45 min",
    location: normalizeText(candidate.location) || "TBD",
    objective:
      objective || "Capture outcomes, decisions, actions, and open questions from this meeting.",
    state: normalizeEnum(candidate.state, MEETING_STATES, "scheduled"),
    digest: normalizeEnum(candidate.digest, DIGEST_STATES, "pending"),
    locked: normalizeBoolean(candidate.locked, false),
    revision: normalizeRevision(candidate.revision, 1),
    lastSentLabel: normalizeText(candidate.lastSentLabel) || "Not sent yet",
    attendees,
    agenda,
    notes,
    openQuestions,
    decisions,
    actions,
    digestRecipients,
    digestOptions: parseDigestOptions(candidate.digestOptions),
  };
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

function parseTimestampValue(value: unknown): Date | null {
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

function normalizeDateToEpoch(value: Date | null) {
  return value ? value.getTime() : null;
}

function areDigestOptionsEqual(
  left: MeetingRecordPayload["digestOptions"],
  right: MeetingRecordPayload["digestOptions"],
) {
  return (
    left.includeNotes === right.includeNotes &&
    left.includeOpenQuestions === right.includeOpenQuestions &&
    left.includeActionOwners === right.includeActionOwners
  );
}

function areMeetingPayloadsEqual(left: MeetingRecordPayload, right: MeetingRecordPayload) {
  return (
    left.title === right.title &&
    left.team === right.team &&
    left.owner === right.owner &&
    left.timeLabel === right.timeLabel &&
    left.duration === right.duration &&
    left.location === right.location &&
    left.objective === right.objective &&
    left.state === right.state &&
    left.digest === right.digest &&
    left.locked === right.locked &&
    left.lastSentLabel === right.lastSentLabel &&
    JSON.stringify(left.attendees) === JSON.stringify(right.attendees) &&
    JSON.stringify(left.agenda) === JSON.stringify(right.agenda) &&
    JSON.stringify(left.notes) === JSON.stringify(right.notes) &&
    JSON.stringify(left.openQuestions) === JSON.stringify(right.openQuestions) &&
    JSON.stringify(left.decisions) === JSON.stringify(right.decisions) &&
    JSON.stringify(left.actions) === JSON.stringify(right.actions) &&
    JSON.stringify(left.digestRecipients) === JSON.stringify(right.digestRecipients) &&
    areDigestOptionsEqual(left.digestOptions, right.digestOptions)
  );
}

function listChangedMeetingFields(
  previous: MeetingRecordPayload,
  next: MeetingRecordPayload,
) {
  const changed: string[] = [];

  if (previous.title !== next.title) changed.push("title");
  if (previous.team !== next.team) changed.push("team");
  if (previous.owner !== next.owner) changed.push("owner");
  if (previous.timeLabel !== next.timeLabel) changed.push("time");
  if (previous.duration !== next.duration) changed.push("duration");
  if (previous.location !== next.location) changed.push("location");
  if (previous.objective !== next.objective) changed.push("objective");
  if (previous.state !== next.state) changed.push("state");
  if (previous.digest !== next.digest) changed.push("digest");
  if (previous.locked !== next.locked) changed.push("lock");
  if (previous.lastSentLabel !== next.lastSentLabel) changed.push("sent label");

  if (JSON.stringify(previous.attendees) !== JSON.stringify(next.attendees)) {
    changed.push("attendees");
  }
  if (JSON.stringify(previous.agenda) !== JSON.stringify(next.agenda)) {
    changed.push("agenda");
  }
  if (JSON.stringify(previous.notes) !== JSON.stringify(next.notes)) {
    changed.push("notes");
  }
  if (JSON.stringify(previous.openQuestions) !== JSON.stringify(next.openQuestions)) {
    changed.push("open questions");
  }
  if (JSON.stringify(previous.decisions) !== JSON.stringify(next.decisions)) {
    changed.push("decisions");
  }
  if (JSON.stringify(previous.actions) !== JSON.stringify(next.actions)) {
    changed.push("actions");
  }
  if (JSON.stringify(previous.digestRecipients) !== JSON.stringify(next.digestRecipients)) {
    changed.push("digest recipients");
  }
  if (!areDigestOptionsEqual(previous.digestOptions, next.digestOptions)) {
    changed.push("digest options");
  }

  return changed;
}

function summarizeChangedMeetingFields(
  changedFields: string[],
  eventType: MeetingRevisionEventType,
) {
  if (eventType === "restored") {
    return "Restored meeting from a previous revision.";
  }

  if (changedFields.length === 0) {
    return eventType === "created"
      ? "Captured initial meeting revision."
      : "Updated meeting.";
  }

  if (changedFields.length <= 3) {
    return `${eventType === "created" ? "Created" : "Updated"} ${changedFields.join(", ")}.`;
  }

  const head = changedFields.slice(0, 3).join(", ");
  return `${eventType === "created" ? "Created" : "Updated"} ${head} and ${changedFields.length - 3} more fields.`;
}

async function writeMeetingRevisionSnapshot({
  meetingRef,
  meeting,
  actorUid,
  actorName,
  now,
  source,
  eventType,
  changedFields,
  restoredFromRevisionId,
}: {
  meetingRef: DocumentReference;
  meeting: MeetingRecordPayload;
  actorUid: string;
  actorName: string;
  now: Timestamp;
  source: MeetingRevisionSource;
  eventType: MeetingRevisionEventType;
  changedFields: string[];
  restoredFromRevisionId?: string;
}) {
  await meetingRef.collection("revisions").add({
    source,
    eventType,
    changedFields,
    summary: summarizeChangedMeetingFields(changedFields, eventType),
    meetingRevision: meeting.revision,
    actorUid,
    actorName,
    capturedAt: now,
    restoredFromRevisionId: restoredFromRevisionId ?? "",
    meeting,
  });
}

function applyTimeFromLabel(base: Date, label: string) {
  const match = label.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return base;

  const hourValue = Number.parseInt(match[1] ?? "", 10);
  const minuteValue = Number.parseInt(match[2] ?? "0", 10);
  const meridiem = (match[3] ?? "").toUpperCase();

  if (Number.isNaN(hourValue) || Number.isNaN(minuteValue)) return base;

  const normalizedHour = hourValue % 12 + (meridiem === "PM" ? 12 : 0);
  const next = new Date(base);
  next.setHours(normalizedHour, minuteValue, 0, 0);
  return next;
}

function parseDueAtFromLabel(dueLabel: string) {
  const normalized = dueLabel.trim();
  if (!normalized || normalized.toLowerCase() === "no due date") {
    return null;
  }

  const lower = normalized.toLowerCase();
  if (lower.includes("today")) {
    const now = new Date();
    now.setHours(9, 0, 0, 0);
    return applyTimeFromLabel(now, normalized);
  }

  if (lower.includes("tomorrow")) {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return applyTimeFromLabel(next, normalized);
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function isDueSoonDate(value: Date | null) {
  if (!value) return false;
  const diff = value.getTime() - Date.now();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return diff >= 0 && diff <= twoDaysMs;
}

function isDueSoonLabel(dueLabel: string) {
  const normalized = dueLabel.toLowerCase();
  return normalized.includes("today") || normalized.includes("tomorrow");
}

async function syncMeetingOutputsToCanonical({
  workspaceId,
  workspaceSlug,
  workspaceName,
  meetingId,
  meeting,
  uid,
  actorName,
  now,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  meetingId: string;
  meeting: MeetingRecordPayload;
  uid: string;
  actorName: string;
  now: Timestamp;
}) {
  const workspaceRef = adminDb.collection("workspaces").doc(workspaceId);
  const teamLabel = meeting.team || "Workspace";
  const meetingDecisionIds = new Set(meeting.decisions.map((decision) => decision.id));
  const meetingActionIds = new Set(meeting.actions.map((action) => action.id));

  for (const decision of meeting.decisions) {
    const decisionRef = workspaceRef.collection("decisions").doc(decision.id);
    const decisionSnapshot = await decisionRef.get();
    const existing = (decisionSnapshot.data() as Record<string, unknown> | undefined) ?? {};
    const wasExisting = decisionSnapshot.exists;

    const visibility = normalizeText(existing.visibility);
    const normalizedVisibility =
      visibility === "workspace" || visibility === "team" || visibility === "private"
        ? visibility
        : "workspace";
    const existingTeamLabel = normalizeText(existing.teamLabel);
    const decisionTeamLabel = existingTeamLabel || teamLabel;
    const existingAllowedTeamIds = normalizeStringArray(existing.allowedTeamIds);
    const allowedTeamIds =
      normalizedVisibility === "team"
        ? existingAllowedTeamIds.length > 0
          ? existingAllowedTeamIds
          : decisionTeamLabel
            ? [decisionTeamLabel]
            : []
        : [];
    const nextTitle = decision.title || `Decision ${decision.id}`;
    const nextStatement = decision.rationale || decision.title || "Decision statement pending.";
    const nextRationale = decision.rationale || nextStatement;
    const nextOwner = decision.owner || normalizeText(existing.owner) || "Unassigned";
    const nextOwnerUid = normalizeText(existing.ownerUid) || uid;
    const nextTags = normalizeStringArray(existing.tags);
    const nextMeetingId = normalizeText(existing.meetingId) || meetingId;
    const nextSupersedesDecisionId = normalizeText(existing.supersedesDecisionId);
    const nextSupersededByDecisionId = normalizeText(existing.supersededByDecisionId);
    const wasArchived = existing.archived === true;
    const didContentChange =
      !wasExisting ||
      normalizeText(existing.title) !== nextTitle ||
      normalizeText(existing.statement) !== nextStatement ||
      normalizeText(existing.rationale) !== nextRationale ||
      normalizeText(existing.owner) !== nextOwner ||
      normalizeText(existing.ownerUid) !== nextOwnerUid ||
      normalizeEnum(existing.status, DECISION_STATES, "proposed") !== decision.status ||
      normalizeText(existing.visibility) !== normalizedVisibility ||
      normalizeText(existing.teamLabel) !== decisionTeamLabel ||
      !areStringArraysEqual(existingAllowedTeamIds, allowedTeamIds) ||
      !areStringArraysEqual(normalizeStringArray(existing.tags), nextTags) ||
      normalizeText(existing.meetingId) !== nextMeetingId ||
      normalizeText(existing.supersedesDecisionId) !== nextSupersedesDecisionId ||
      normalizeText(existing.supersededByDecisionId) !== nextSupersededByDecisionId;

    if (didContentChange || wasArchived) {
      await decisionRef.set(
        {
          title: nextTitle,
          statement: nextStatement,
          rationale: nextRationale,
          owner: nextOwner,
          ownerUid: nextOwnerUid,
          status: decision.status,
          visibility: normalizedVisibility,
          teamLabel: decisionTeamLabel,
          allowedTeamIds,
          tags: nextTags,
          meetingId: nextMeetingId,
          supersedesDecisionId: nextSupersedesDecisionId,
          supersededByDecisionId: nextSupersededByDecisionId,
          archived: false,
          archivedAt: null,
          archivedBy: "",
          updatedAt: now,
          updatedBy: uid,
          createdAt: existing.createdAt ?? now,
          createdBy: normalizeText(existing.createdBy) || uid,
        },
        { merge: true },
      );

      if (!wasExisting) {
        await writeCanonicalHistoryEvent({
          entityRef: decisionRef,
          entity: "decision",
          eventType: "created",
          source: "meetingSync",
          actorUid: uid,
          actorName,
          message: `Created decision ${decision.id} from meeting ${meetingId}.`,
          at: now,
          metadata: {
            meetingId,
          },
        });
      } else {
        if (didContentChange) {
          await writeCanonicalHistoryEvent({
            entityRef: decisionRef,
            entity: "decision",
            eventType: "updated",
            source: "meetingSync",
            actorUid: uid,
            actorName,
            message: `Synced decision ${decision.id} from meeting ${meetingId}.`,
            at: now,
            metadata: {
              meetingId,
            },
          });
        }

        if (wasArchived) {
          await writeCanonicalHistoryEvent({
            entityRef: decisionRef,
            entity: "decision",
            eventType: "restored",
            source: "meetingSync",
            actorUid: uid,
            actorName,
            message: `Restored decision ${decision.id} via meeting ${meetingId}.`,
            at: now,
            metadata: {
              meetingId,
            },
          });
        }
      }

      if (didContentChange) {
        await emitMentionNotifications({
          workspaceId,
          workspaceSlug,
          workspaceName,
          entityType: "decision",
          entityId: decision.id,
          entityTitle: nextTitle,
          entityPath: `/${workspaceSlug}/decisions/${decision.id}`,
          mentionText: [nextTitle, nextStatement, nextRationale].join("\n"),
          previousMentionText: [
            normalizeText(existing.title),
            normalizeText(existing.statement),
            normalizeText(existing.rationale),
          ].join("\n"),
          actorUid: uid,
          actorName,
          now,
        });
      }
    }
  }

  for (const action of meeting.actions) {
    const actionRef = workspaceRef.collection("actions").doc(action.id);
    const actionSnapshot = await actionRef.get();
    const existing = (actionSnapshot.data() as Record<string, unknown> | undefined) ?? {};
    const wasExisting = actionSnapshot.exists;

    const dueAtFromLabel = parseDueAtFromLabel(action.dueLabel);
    const existingDueAt = parseTimestampValue(existing.dueAt);
    const dueAtDate = dueAtFromLabel ?? existingDueAt;
    const dueAtTimestamp = dueAtDate ? Timestamp.fromDate(dueAtDate) : null;
    const dueSoon =
      action.status === "open" &&
      (dueAtDate ? isDueSoonDate(dueAtDate) : isDueSoonLabel(action.dueLabel));
    const nextTitle = action.title || `Action ${action.id}`;
    const nextDescription = normalizeText(existing.description) || action.title;
    const nextOwner = action.owner || normalizeText(existing.owner) || "Unassigned";
    const nextOwnerUid = normalizeText(existing.ownerUid) || uid;
    const nextProject = normalizeText(existing.project) || teamLabel;
    const nextDueLabel = action.dueLabel || "No due date";
    const nextMeetingId = normalizeText(existing.meetingId) || meetingId;
    const nextDecisionId = normalizeText(existing.decisionId);
    const nextBlockedReason =
      action.status === "blocked"
        ? normalizeText(existing.blockedReason) || "Blocked in meeting record."
        : "";
    const nextNotes = normalizeText(existing.notes);
    const nextCompletedAt = action.status === "done" ? existing.completedAt ?? now : null;
    const wasArchived = existing.archived === true;
    const nextDueAtEpoch = normalizeDateToEpoch(dueAtDate);
    const existingDueAtEpoch = normalizeDateToEpoch(existingDueAt);
    const existingDueSoon = typeof existing.dueSoon === "boolean" ? existing.dueSoon : false;
    const didContentChange =
      !wasExisting ||
      normalizeText(existing.title) !== nextTitle ||
      normalizeText(existing.description) !== nextDescription ||
      normalizeText(existing.owner) !== nextOwner ||
      normalizeText(existing.ownerUid) !== nextOwnerUid ||
      normalizeEnum(existing.status, ACTION_STATES, "open") !== action.status ||
      normalizeEnum(existing.priority, ACTION_PRIORITIES, "medium") !== action.priority ||
      normalizeText(existing.project) !== nextProject ||
      existingDueAtEpoch !== nextDueAtEpoch ||
      normalizeText(existing.dueLabel) !== nextDueLabel ||
      existingDueSoon !== dueSoon ||
      normalizeText(existing.meetingId) !== nextMeetingId ||
      normalizeText(existing.decisionId) !== nextDecisionId ||
      normalizeText(existing.blockedReason) !== nextBlockedReason ||
      normalizeText(existing.notes) !== nextNotes;

    if (didContentChange || wasArchived) {
      await actionRef.set(
        {
          title: nextTitle,
          description: nextDescription,
          owner: nextOwner,
          ownerUid: nextOwnerUid,
          status: action.status,
          priority: action.priority,
          project: nextProject,
          dueAt: dueAtTimestamp,
          dueLabel: nextDueLabel,
          dueSoon,
          meetingId: nextMeetingId,
          decisionId: nextDecisionId,
          blockedReason: nextBlockedReason,
          notes: nextNotes,
          completedAt: nextCompletedAt,
          archived: false,
          archivedAt: null,
          archivedBy: "",
          updatedAt: now,
          updatedBy: uid,
          createdAt: existing.createdAt ?? now,
          createdBy: normalizeText(existing.createdBy) || uid,
        },
        { merge: true },
      );

      if (!wasExisting) {
        await writeCanonicalHistoryEvent({
          entityRef: actionRef,
          entity: "action",
          eventType: "created",
          source: "meetingSync",
          actorUid: uid,
          actorName,
          message: `Created action ${action.id} from meeting ${meetingId}.`,
          at: now,
          metadata: {
            meetingId,
          },
        });
      } else {
        if (didContentChange) {
          await writeCanonicalHistoryEvent({
            entityRef: actionRef,
            entity: "action",
            eventType: "updated",
            source: "meetingSync",
            actorUid: uid,
            actorName,
            message: `Synced action ${action.id} from meeting ${meetingId}.`,
            at: now,
            metadata: {
              meetingId,
            },
          });
        }

        if (wasArchived) {
          await writeCanonicalHistoryEvent({
            entityRef: actionRef,
            entity: "action",
            eventType: "restored",
            source: "meetingSync",
            actorUid: uid,
            actorName,
            message: `Restored action ${action.id} via meeting ${meetingId}.`,
            at: now,
            metadata: {
              meetingId,
            },
          });
        }
      }

      if (didContentChange) {
        await emitMentionNotifications({
          workspaceId,
          workspaceSlug,
          workspaceName,
          entityType: "action",
          entityId: action.id,
          entityTitle: nextTitle,
          entityPath: `/${workspaceSlug}/actions/${action.id}`,
          mentionText: [nextTitle, nextDescription, nextBlockedReason, nextNotes].join(
            "\n",
          ),
          previousMentionText: [
            normalizeText(existing.title),
            normalizeText(existing.description),
            normalizeText(existing.blockedReason),
            normalizeText(existing.notes),
          ].join("\n"),
          actorUid: uid,
          actorName,
          now,
        });
      }
    }
  }

  const linkedDecisionSnapshots = await workspaceRef
    .collection("decisions")
    .where("meetingId", "==", meetingId)
    .get();

  for (const decisionSnapshot of linkedDecisionSnapshots.docs) {
    if (meetingDecisionIds.has(decisionSnapshot.id)) {
      continue;
    }

    const existing = decisionSnapshot.data() as Record<string, unknown>;
    if (existing.archived === true) {
      continue;
    }

    await decisionSnapshot.ref.set(
      {
        archived: true,
        archivedAt: now,
        archivedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    await writeCanonicalHistoryEvent({
      entityRef: decisionSnapshot.ref,
      entity: "decision",
      eventType: "archived",
      source: "meetingSync",
      actorUid: uid,
      actorName,
      message: `Archived decision ${decisionSnapshot.id} removed from meeting ${meetingId}.`,
      at: now,
      metadata: {
        meetingId,
      },
    });
  }

  const linkedActionSnapshots = await workspaceRef
    .collection("actions")
    .where("meetingId", "==", meetingId)
    .get();

  for (const actionSnapshot of linkedActionSnapshots.docs) {
    if (meetingActionIds.has(actionSnapshot.id)) {
      continue;
    }

    const existing = actionSnapshot.data() as Record<string, unknown>;
    if (existing.archived === true) {
      continue;
    }

    await actionSnapshot.ref.set(
      {
        archived: true,
        archivedAt: now,
        archivedBy: uid,
        updatedAt: now,
        updatedBy: uid,
      },
      { merge: true },
    );

    await writeCanonicalHistoryEvent({
      entityRef: actionSnapshot.ref,
      entity: "action",
      eventType: "archived",
      source: "meetingSync",
      actorUid: uid,
      actorName,
      message: `Archived action ${actionSnapshot.id} removed from meeting ${meetingId}.`,
      at: now,
      metadata: {
        meetingId,
      },
    });
  }
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function resolveAuthorizedMeetingContext(
  request: NextRequest,
  workspaceSlug: string,
  meetingId: string,
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
  const meetingRef = workspaceRef.collection("meetings").doc(meetingId);
  const memberDisplayName = normalizeText(memberSnapshot.get("displayName"));

  return {
    uid,
    memberRole,
    memberDisplayName,
    workspace,
    workspaceRef,
    meetingRef,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, meetingId } = await context.params;
    const resolvedContext = await resolveAuthorizedMeetingContext(
      request,
      workspaceSlug,
      meetingId,
    );

    if ("error" in resolvedContext) {
      return NextResponse.json({ error: resolvedContext.error }, { status: resolvedContext.status });
    }

    const meetingSnapshot = await resolvedContext.meetingRef.get();
    if (!meetingSnapshot.exists) {
      return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
    }

    const meeting = normalizeMeetingPayload(meetingSnapshot.id, meetingSnapshot.data());
    if (!meeting) {
      return NextResponse.json({ error: "Meeting payload is invalid." }, { status: 500 });
    }

    return NextResponse.json({
      meeting: {
        id: meetingSnapshot.id,
        ...meeting,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load meeting.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, meetingId } = await context.params;
    const resolvedContext = await resolveAuthorizedMeetingContext(
      request,
      workspaceSlug,
      meetingId,
    );

    if ("error" in resolvedContext) {
      return NextResponse.json({ error: resolvedContext.error }, { status: resolvedContext.status });
    }

    const body = (await request.json()) as UpdateMeetingBody;
    const restoreFromRevisionId = normalizeText(body.restoreFromRevisionId);
    if (!canEditMeetings(resolvedContext.memberRole)) {
      return NextResponse.json(
        { error: "Viewers cannot edit meetings." },
        { status: 403 },
      );
    }

    if (restoreFromRevisionId && !canRestoreMeetingRevisions(resolvedContext.memberRole)) {
      return NextResponse.json(
        { error: "Only owners and admins can restore meeting revisions." },
        { status: 403 },
      );
    }

    const now = Timestamp.now();
    const existingSnapshot = await resolvedContext.meetingRef.get();
    const existingMeeting = existingSnapshot.exists
      ? normalizeMeetingPayload(meetingId, existingSnapshot.data())
      : null;
    let nextMeeting: MeetingRecordPayload | null = null;
    let changedFields: string[] = [];
    let revisionEventType: MeetingRevisionEventType = "updated";
    let revisionSource: MeetingRevisionSource = "meetingUpdate";
    let restoredFromRevisionIdForSnapshot = "";

    if (restoreFromRevisionId) {
      const revisionSnapshot = await resolvedContext.meetingRef
        .collection("revisions")
        .doc(restoreFromRevisionId)
        .get();

      if (!revisionSnapshot.exists) {
        return NextResponse.json({ error: "Revision not found." }, { status: 404 });
      }

      const revisionMeeting = normalizeMeetingPayload(
        meetingId,
        revisionSnapshot.get("meeting"),
      );

      if (!revisionMeeting) {
        return NextResponse.json(
          { error: "Revision snapshot is invalid." },
          { status: 500 },
        );
      }

      const nextRevision = existingMeeting
        ? Math.max(existingMeeting.revision + 1, revisionMeeting.revision + 1, 1)
        : Math.max(revisionMeeting.revision + 1, 1);

      nextMeeting = {
        ...revisionMeeting,
        revision: nextRevision,
      };
      changedFields = existingMeeting
        ? listChangedMeetingFields(existingMeeting, nextMeeting)
        : ["restored snapshot"];
      if (changedFields.length === 0) {
        changedFields = ["restored snapshot"];
      }
      revisionEventType = "restored";
      revisionSource = "restore";
      restoredFromRevisionIdForSnapshot = restoreFromRevisionId;
    } else {
      const meeting = normalizeMeetingPayload(meetingId, body.meeting);

      if (!meeting) {
        return NextResponse.json(
          { error: "Meeting payload is required." },
          { status: 400 },
        );
      }

      const hasMeaningfulChanges =
        !existingMeeting || !areMeetingPayloadsEqual(existingMeeting, meeting);

      if (!hasMeaningfulChanges && existingMeeting) {
        return NextResponse.json({
          ok: true,
          meeting: {
            id: meetingId,
            ...existingMeeting,
          },
        });
      }

      const nextRevision = existingMeeting
        ? Math.max(existingMeeting.revision + 1, meeting.revision, 1)
        : Math.max(meeting.revision, 1);

      nextMeeting = {
        ...meeting,
        revision: nextRevision,
      };
      changedFields = existingMeeting
        ? listChangedMeetingFields(existingMeeting, nextMeeting)
        : ["initial capture"];
      revisionEventType = existingSnapshot.exists ? "updated" : "created";
      revisionSource = "meetingUpdate";
    }

    if (!nextMeeting) {
      return NextResponse.json({ error: "Failed to resolve meeting payload." }, { status: 500 });
    }

    const actorName = resolvedContext.memberDisplayName || nextMeeting.owner || "Workspace User";

    await resolvedContext.meetingRef.set(
      {
        ...nextMeeting,
        updatedAt: now,
        updatedBy: resolvedContext.uid,
        ...(existingSnapshot.exists
          ? {}
          : {
              createdAt: now,
              createdBy: resolvedContext.uid,
            }),
      },
      { merge: true },
    );

    await writeMeetingRevisionSnapshot({
      meetingRef: resolvedContext.meetingRef,
      meeting: nextMeeting,
      actorUid: resolvedContext.uid,
      actorName,
      now,
      source: revisionSource,
      eventType: revisionEventType,
      changedFields,
      restoredFromRevisionId: restoredFromRevisionIdForSnapshot || undefined,
    });

    await syncMeetingOutputsToCanonical({
      workspaceId: resolvedContext.workspace.workspaceId,
      workspaceSlug: resolvedContext.workspace.workspaceSlug,
      workspaceName: resolvedContext.workspace.workspaceName,
      meetingId,
      meeting: nextMeeting,
      uid: resolvedContext.uid,
      actorName,
      now,
    });

    return NextResponse.json({
      ok: true,
      meeting: {
        id: meetingId,
        ...nextMeeting,
      },
      restoredFromRevisionId: restoreFromRevisionId || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update meeting.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
