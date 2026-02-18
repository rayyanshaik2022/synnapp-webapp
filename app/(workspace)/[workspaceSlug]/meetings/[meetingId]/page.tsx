import Link from "next/link";
import {
  MeetingRecordFlow,
  type MeetingRecordSeed,
} from "@/components/workspace/meeting-record-flow";
import {
  MeetingRevisionHistory,
  type MeetingRevisionHistoryEntry,
} from "@/components/workspace/meeting-revision-history";
import { WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  canRestoreMeetingRevisions,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";
import { adminDb } from "@/lib/firebase/admin";
import { parseMeetingDraftPayload } from "@/lib/workspace/meeting-draft";

type MeetingRecordPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string; meetingId: string }>;
  searchParams: Promise<{ draft?: string | string[] }>;
}>;

const meetingSeeds: Record<string, MeetingRecordSeed> = {
  "M-319": {
    id: "M-319",
    title: "Weekly Product Decisions",
    team: "Product Ops",
    owner: "Priya",
    timeLabel: "Today, 2:30 PM",
    duration: "45 min",
    location: "Room Atlas + Zoom",
    objective:
      "Finalize rollout sequencing for digest reliability and align owners for post-launch guardrails.",
    state: "inProgress",
    digest: "pending",
    locked: false,
    revision: 3,
    lastSentLabel: "Draft only",
    attendees: [
      { id: "u-1", name: "Priya Shah", role: "Facilitator", required: true, present: true },
      { id: "u-2", name: "Noah Lin", role: "Engineering Lead", required: true, present: true },
      { id: "u-3", name: "Maya Clark", role: "Support Lead", required: true, present: true },
      { id: "u-4", name: "Avery Patel", role: "Architect", required: false, present: true },
      { id: "u-5", name: "Ravi Menon", role: "Stakeholder", required: false, present: false },
    ],
    agenda: [
      { id: "ag-1", title: "Review digest incident timeline", state: "done" },
      { id: "ag-2", title: "Lock retry/backoff strategy", state: "inProgress" },
      { id: "ag-3", title: "Assign launch owners", state: "queued" },
      { id: "ag-4", title: "Define post-launch metrics", state: "queued" },
    ],
    notes: [
      {
        id: "n-1",
        heading: "Key Discussion",
        content:
          "Queue-based retries are preferred to reduce coupling with request lifecycle and improve reliability under load.",
      },
      {
        id: "n-2",
        heading: "Risks and Constraints",
        content:
          "Current worker concurrency caps may delay retries during peak traffic unless limits are tuned.",
      },
      {
        id: "n-3",
        heading: "Follow-up Context",
        content:
          "Need a handoff doc for on-call so digest failures can be triaged without involving platform every time.",
      },
    ],
    openQuestions: [
      {
        id: "Q-1",
        question: "Do we need per-workspace rate limits for retry queues?",
        owner: "Noah",
        dueLabel: "Before launch",
        status: "open",
      },
      {
        id: "Q-2",
        question: "Should failed digests trigger immediate Slack alerts?",
        owner: "Maya",
        dueLabel: "Friday",
        status: "resolved",
      },
    ],
    decisions: [
      {
        id: "D-61",
        title: "Adopt 90-day review cadence for accepted decisions",
        owner: "Priya",
        status: "accepted",
        rationale: "Keeps decisions fresh without adding weekly ceremony overhead.",
      },
      {
        id: "D-59",
        title: "Move digest retries to managed queue",
        owner: "Noah",
        status: "proposed",
        rationale: "Improves resilience and keeps retry behavior observable.",
      },
    ],
    actions: [
      {
        id: "A-203",
        title: "Finalize SSO rollout checklist for onboarding",
        owner: "You",
        dueLabel: "Today, 4:00 PM",
        priority: "high",
        status: "open",
      },
      {
        id: "A-165",
        title: "Draft owner handoff notes for digest scheduling",
        owner: "You",
        dueLabel: "Feb 22",
        priority: "medium",
        status: "open",
      },
      {
        id: "A-177",
        title: "Unblock retention dashboard backfill",
        owner: "You",
        dueLabel: "No due date",
        priority: "high",
        status: "blocked",
      },
    ],
    digestRecipients: [
      { id: "r-1", label: "Priya Shah <priya@synn.co>", enabled: true },
      { id: "r-2", label: "Noah Lin <noah@synn.co>", enabled: true },
      { id: "r-3", label: "Product Ops Team <product-ops@synn.co>", enabled: true },
      { id: "r-4", label: "Stakeholders <leadership@synn.co>", enabled: false },
    ],
  },
  "M-312": {
    id: "M-312",
    title: "Architecture Council",
    team: "Architecture",
    owner: "Avery",
    timeLabel: "Yesterday, 11:00 AM",
    duration: "60 min",
    location: "Room Northstar",
    objective:
      "Align on reliability architecture and track system-level decisions affecting digest delivery.",
    state: "completed",
    digest: "sent",
    locked: true,
    revision: 7,
    lastSentLabel: "Yesterday, 1:10 PM",
    attendees: [
      { id: "u-1", name: "Avery Patel", role: "Facilitator", required: true, present: true },
      { id: "u-2", name: "Noah Lin", role: "Engineering Lead", required: true, present: true },
      { id: "u-3", name: "Priya Shah", role: "Product Ops", required: false, present: true },
      { id: "u-4", name: "Maya Clark", role: "Support", required: false, present: false },
    ],
    agenda: [
      { id: "ag-1", title: "Review architecture proposals", state: "done" },
      { id: "ag-2", title: "Validate failure handling model", state: "done" },
      { id: "ag-3", title: "Decide ownership boundaries", state: "done" },
    ],
    notes: [
      {
        id: "n-1",
        heading: "Key Discussion",
        content:
          "Consensus reached on queue visibility tooling and alert thresholds for delayed retries.",
      },
      {
        id: "n-2",
        heading: "Risks and Constraints",
        content:
          "Alert fatigue risk if thresholds are too sensitive; tuning window proposed post-rollout.",
      },
      {
        id: "n-3",
        heading: "Follow-up Context",
        content:
          "Architecture diagrams need refresh to reflect new ownership boundaries.",
      },
    ],
    openQuestions: [
      {
        id: "Q-1",
        question: "Do we auto-scale workers by queue age or queue depth first?",
        owner: "Noah",
        dueLabel: "Next council",
        status: "open",
      },
    ],
    decisions: [
      {
        id: "D-59",
        title: "Move digest retries to managed queue",
        owner: "Noah",
        status: "accepted",
        rationale: "Reduces failure coupling and supports standard retry patterns.",
      },
    ],
    actions: [
      {
        id: "A-154",
        title: "Document superseding architecture guidance",
        owner: "Noah",
        dueLabel: "Feb 17",
        priority: "medium",
        status: "done",
      },
      {
        id: "A-158",
        title: "Archive obsolete architecture templates",
        owner: "Maya",
        dueLabel: "Feb 18",
        priority: "low",
        status: "done",
      },
    ],
    digestRecipients: [
      { id: "r-1", label: "Architecture Council <arch@synn.co>", enabled: true },
      { id: "r-2", label: "Engineering Managers <eng-mgr@synn.co>", enabled: true },
      { id: "r-3", label: "Leadership <leadership@synn.co>", enabled: false },
    ],
  },
};

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function decodeDraftParam(rawValue: string | string[] | undefined) {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const json = decodeURIComponent(decoded);
    const parsed = JSON.parse(json);
    return parseMeetingDraftPayload(parsed);
  } catch {
    return null;
  }
}

function formatTimeLabel(date: string, time: string) {
  const parsedDate = date ? new Date(`${date}T00:00:00`) : null;
  const dateLabel =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : date || "Date TBD";

  if (!time) return dateLabel;

  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return `${dateLabel}`;

  const period = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 === 0 ? 12 : hours % 12;
  const normalizedMinutes = String(minutes).padStart(2, "0");

  return `${dateLabel}, ${normalizedHours}:${normalizedMinutes} ${period}`;
}

function buildMeetingFromDraft(
  meetingId: string,
  draft: NonNullable<ReturnType<typeof decodeDraftParam>>,
): MeetingRecordSeed {
  const attendees =
    draft.attendees.length > 0
      ? draft.attendees.map((name, index) => ({
          id: `u-${index + 1}`,
          name,
          role: index === 0 ? "Facilitator" : "Participant",
          required: true,
          present: true,
        }))
      : [{ id: "u-1", name: "You", role: "Facilitator", required: true, present: true }];

  const agenda =
    draft.agenda.length > 0
      ? draft.agenda.map((title, index) => ({
          id: `ag-${index + 1}`,
          title,
          state: index === 0 ? ("inProgress" as const) : ("queued" as const),
        }))
      : [{ id: "ag-1", title: "Set context and goals", state: "inProgress" as const }];

  const owner = attendees[0]?.name ?? "You";

  return {
    id: meetingId,
    title: draft.title || "New Meeting",
    team: "Draft Meeting",
    owner,
    timeLabel: formatTimeLabel(draft.date, draft.time),
    duration: "45 min",
    location: draft.location || "TBD",
    objective:
      draft.objective ||
      "Capture outcomes, decisions, actions, and open questions from this meeting.",
    state: "scheduled",
    digest: "pending",
    locked: false,
    revision: 1,
    lastSentLabel: "Not sent yet",
    attendees,
    agenda,
    notes: [
      {
        id: "n-1",
        heading: "Key Discussion",
        content: draft.objective || "Capture key context and tradeoffs discussed in the meeting.",
      },
      {
        id: "n-2",
        heading: "Risks and Constraints",
        content: "Capture blockers, dependencies, and assumptions to revisit.",
      },
      {
        id: "n-3",
        heading: "Follow-up Context",
        content: "Add handoff context for owners and stakeholders not present.",
      },
    ],
    openQuestions: [],
    decisions: [],
    actions: [],
    digestRecipients: attendees.slice(0, 4).map((attendee, index) => ({
      id: `r-${index + 1}`,
      label: attendee.name,
      enabled: index < 2,
    })),
  };
}

function buildFallbackMeeting(meetingId: string): MeetingRecordSeed {
  return {
    id: meetingId,
    title: "Meeting Record",
    team: "Workspace",
    owner: "You",
    timeLabel: "Today, 10:00 AM",
    duration: "45 min",
    location: "TBD",
    objective: "Capture outcomes, decisions, actions, and open questions from this meeting.",
    state: "scheduled",
    digest: "pending",
    locked: false,
    revision: 1,
    lastSentLabel: "Not sent yet",
    attendees: [
      { id: "u-1", name: "You", role: "Facilitator", required: true, present: true },
      { id: "u-2", name: "Teammate", role: "Participant", required: true, present: false },
    ],
    agenda: [
      { id: "ag-1", title: "Set context and goals", state: "inProgress" },
      { id: "ag-2", title: "Capture decisions and tradeoffs", state: "queued" },
      { id: "ag-3", title: "Assign actions", state: "queued" },
    ],
    notes: [
      {
        id: "n-1",
        heading: "Key Discussion",
        content: "Use this section to capture the core decisions and rationale from the meeting.",
      },
      {
        id: "n-2",
        heading: "Risks and Constraints",
        content: "Track blockers, dependencies, and assumptions that can impact delivery.",
      },
      {
        id: "n-3",
        heading: "Follow-up Context",
        content: "Capture anything needed by owners who were not in the room.",
      },
    ],
    openQuestions: [],
    decisions: [],
    actions: [],
    digestRecipients: [
      { id: "r-1", label: "You <you@company.com>", enabled: true },
      { id: "r-2", label: "Team <team@company.com>", enabled: false },
    ],
  };
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
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

function formatDateTimeLabel(value: unknown) {
  const parsed = parseDate(value);
  if (!parsed) return "Unknown time";

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function parseRevisionEventType(value: unknown): MeetingRevisionHistoryEntry["eventType"] {
  const normalized = normalizeText(value);
  if (normalized === "created" || normalized === "updated" || normalized === "restored") {
    return normalized;
  }
  return "updated";
}

function parseRevisionSource(value: unknown): MeetingRevisionHistoryEntry["source"] {
  const normalized = normalizeText(value);
  if (normalized === "meetingUpdate" || normalized === "restore") {
    return normalized;
  }
  return "meetingUpdate";
}

function normalizeArray<T>(value: unknown, parser: (entry: unknown, index: number) => T | null) {
  if (!Array.isArray(value)) return [] as T[];
  return value
    .map((entry, index) => parser(entry, index))
    .filter((entry): entry is T => entry !== null);
}

function parsePersistedMeeting(
  meetingId: string,
  value: unknown,
): MeetingRecordSeed | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;

  const attendees = normalizeArray(data.attendees, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const attendee = entry as Record<string, unknown>;
    const name = normalizeText(attendee.name);
    if (!name) return null;

    return {
      id: normalizeText(attendee.id) || `u-${index + 1}`,
      name,
      role: normalizeText(attendee.role) || "Participant",
      required: normalizeBoolean(attendee.required, true),
      present: normalizeBoolean(attendee.present, true),
    };
  });

  const agenda = normalizeArray(data.agenda, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as Record<string, unknown>;
    const title = normalizeText(item.title);
    if (!title) return null;
    const state = normalizeText(item.state);
    const normalizedState =
      state === "queued" || state === "inProgress" || state === "done"
        ? state
        : "queued";
    return {
      id: normalizeText(item.id) || `ag-${index + 1}`,
      title,
      state: normalizedState,
    };
  });

  const notes = normalizeArray(data.notes, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const note = entry as Record<string, unknown>;
    const heading = normalizeText(note.heading);
    const content = normalizeText(note.content);
    if (!heading && !content) return null;
    return {
      id: normalizeText(note.id) || `n-${index + 1}`,
      heading: heading || `Notes ${index + 1}`,
      content,
    };
  });

  const openQuestions = normalizeArray(data.openQuestions, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const question = entry as Record<string, unknown>;
    const questionText = normalizeText(question.question);
    if (!questionText) return null;
    const status = normalizeText(question.status);
    const normalizedStatus = status === "open" || status === "resolved" ? status : "open";
    return {
      id: normalizeText(question.id) || `Q-${index + 1}`,
      question: questionText,
      owner: normalizeText(question.owner) || "Unassigned",
      dueLabel: normalizeText(question.dueLabel) || "No due date",
      status: normalizedStatus,
    };
  });

  const decisions = normalizeArray(data.decisions, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const decision = entry as Record<string, unknown>;
    const title = normalizeText(decision.title);
    if (!title) return null;
    const status = normalizeText(decision.status);
    const normalizedStatus = status === "accepted" || status === "proposed" ? status : "proposed";
    return {
      id: normalizeText(decision.id) || `D-${index + 1}`,
      title,
      owner: normalizeText(decision.owner) || "Unassigned",
      status: normalizedStatus,
      rationale: normalizeText(decision.rationale) || "Rationale to be added.",
    };
  });

  const actions = normalizeArray(data.actions, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const action = entry as Record<string, unknown>;
    const title = normalizeText(action.title);
    if (!title) return null;
    const status = normalizeText(action.status);
    const priority = normalizeText(action.priority);
    const normalizedStatus =
      status === "open" || status === "blocked" || status === "done" ? status : "open";
    const normalizedPriority =
      priority === "high" || priority === "medium" || priority === "low"
        ? priority
        : "medium";
    return {
      id: normalizeText(action.id) || `A-${index + 1}`,
      title,
      owner: normalizeText(action.owner) || "Unassigned",
      dueLabel: normalizeText(action.dueLabel) || "No due date",
      priority: normalizedPriority,
      status: normalizedStatus,
    };
  });

  const digestRecipients = normalizeArray(data.digestRecipients, (entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const recipient = entry as Record<string, unknown>;
    const label = normalizeText(recipient.label);
    if (!label) return null;
    return {
      id: normalizeText(recipient.id) || `r-${index + 1}`,
      label,
      enabled: normalizeBoolean(recipient.enabled, index < 2),
    };
  });

  const meetingState = normalizeText(data.state);
  const digestState = normalizeText(data.digest);
  const normalizedMeetingState =
    meetingState === "scheduled" || meetingState === "inProgress" || meetingState === "completed"
      ? meetingState
      : "scheduled";
  const normalizedDigestState =
    digestState === "pending" || digestState === "sent" ? digestState : "pending";

  const digestOptionsRaw =
    data.digestOptions && typeof data.digestOptions === "object"
      ? (data.digestOptions as Record<string, unknown>)
      : null;

  return {
    id: meetingId,
    title: normalizeText(data.title) || `Meeting ${meetingId}`,
    team: normalizeText(data.team) || "Workspace",
    owner: normalizeText(data.owner) || attendees[0]?.name || "Workspace User",
    timeLabel: normalizeText(data.timeLabel) || "Date TBD",
    duration: normalizeText(data.duration) || "45 min",
    location: normalizeText(data.location) || "TBD",
    objective:
      normalizeText(data.objective) ||
      "Capture outcomes, decisions, actions, and open questions from this meeting.",
    state: normalizedMeetingState,
    digest: normalizedDigestState,
    locked: normalizeBoolean(data.locked, false),
    revision:
      typeof data.revision === "number" && Number.isFinite(data.revision) && data.revision > 0
        ? Math.floor(data.revision)
        : 1,
    lastSentLabel: normalizeText(data.lastSentLabel) || "Not sent yet",
    attendees,
    agenda,
    notes,
    openQuestions,
    decisions,
    actions,
    digestRecipients,
    digestOptions: {
      includeNotes: normalizeBoolean(digestOptionsRaw?.includeNotes, true),
      includeOpenQuestions: normalizeBoolean(digestOptionsRaw?.includeOpenQuestions, true),
      includeActionOwners: normalizeBoolean(digestOptionsRaw?.includeActionOwners, true),
    },
  };
}

export default async function MeetingRecordPage({
  params,
  searchParams,
}: MeetingRecordPageProps) {
  const { workspaceSlug, meetingId } = await params;
  const resolvedSearchParams = await searchParams;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";
  const canRestoreRevisions = canRestoreMeetingRevisions(
    parseWorkspaceMemberRole(access.membershipRole),
  );
  const meetingRef = adminDb
    .collection("workspaces")
    .doc(access.workspaceId)
    .collection("meetings")
    .doc(meetingId);
  const meetingSnapshot = await meetingRef.get();
  const draft = decodeDraftParam(resolvedSearchParams.draft);
  const persistedMeeting = meetingSnapshot.exists
    ? parsePersistedMeeting(meetingId, meetingSnapshot.data())
    : null;
  const meeting =
    persistedMeeting ??
    (draft
      ? buildMeetingFromDraft(meetingId, draft)
      : meetingSeeds[meetingId] ?? buildFallbackMeeting(meetingId));
  const revisionSnapshots = await meetingRef
    .collection("revisions")
    .orderBy("capturedAt", "desc")
    .limit(20)
    .get();
  const rawRevisions = revisionSnapshots.docs.map((snapshot) => {
    const data = snapshot.data() as Record<string, unknown>;
    const meetingRevision =
      typeof data.meetingRevision === "number" &&
      Number.isFinite(data.meetingRevision) &&
      data.meetingRevision > 0
        ? Math.floor(data.meetingRevision)
        : 1;

    return {
      id: snapshot.id,
      meetingRevision,
      eventType: parseRevisionEventType(data.eventType),
      source: parseRevisionSource(data.source),
      actorName: normalizeText(data.actorName) || "Workspace User",
      summary: normalizeText(data.summary) || "Meeting updated.",
      changedFields: parseStringArray(data.changedFields),
      capturedAtLabel: formatDateTimeLabel(data.capturedAt),
      restoredFromRevisionId: normalizeText(data.restoredFromRevisionId),
    };
  });
  const currentRevisionIndex = rawRevisions.findIndex(
    (entry) => entry.meetingRevision === meeting.revision,
  );
  const revisions: MeetingRevisionHistoryEntry[] = rawRevisions.map((entry, index) => ({
    ...entry,
    isCurrent: index === currentRevisionIndex,
  }));

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          {meeting.title} ({meeting.id})
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Capture agenda, attendees, notes, decisions, actions, open questions, and digest output from one place.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/${workspaceSlugForNav}/meetings`}
            className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Back to meetings
          </Link>
          <button
            type="button"
            className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Export record (preview)
          </button>
          <Link
            href={`/${workspaceSlugForNav}/decisions/new`}
            className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
          >
            New decision
          </Link>
          <Link
            href={`/${workspaceSlugForNav}/actions/new`}
            className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
          >
            New action
          </Link>
        </div>
      </WorkspacePanel>

      <MeetingRecordFlow
        key={`${meeting.id}-${meeting.revision}`}
        workspaceSlug={workspaceSlugForNav}
        meeting={meeting}
      />

      <MeetingRevisionHistory
        workspaceSlug={workspaceSlugForNav}
        meetingId={meeting.id}
        entries={revisions}
        canRestoreRevisions={canRestoreRevisions}
        actorRoleLabel={access.membershipRoleLabel}
      />
    </main>
  );
}
