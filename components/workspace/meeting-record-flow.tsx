"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";

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

export type MeetingRecordSeed = {
  id: string;
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
  lastSentLabel?: string;
  attendees: Attendee[];
  agenda: AgendaItem[];
  notes: NoteSection[];
  openQuestions: OpenQuestion[];
  decisions: Decision[];
  actions: Action[];
  digestRecipients: DigestRecipient[];
  digestOptions?: {
    includeNotes?: boolean;
    includeOpenQuestions?: boolean;
    includeActionOwners?: boolean;
  };
};

type MeetingRecordFlowProps = {
  workspaceSlug: string;
  meeting: MeetingRecordSeed;
};

type PersistMeetingResponse = {
  error?: string;
  meeting?: {
    revision?: number;
    lastSentLabel?: string;
  };
};

type PendingRemoval =
  | {
      key: string;
      entity: "decision";
      decision: Decision;
      index: number;
      timerId: number;
    }
  | {
      key: string;
      entity: "action";
      action: Action;
      index: number;
      timerId: number;
    };

const UNDO_WINDOW_MS = 4000;

function cx(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function meetingStateLabel(state: MeetingState) {
  if (state === "inProgress") return "In Progress";
  return state[0].toUpperCase() + state.slice(1);
}

function meetingStateStyle(state: MeetingState) {
  if (state === "scheduled") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (state === "inProgress") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function digestLabel(state: DigestState) {
  return state === "sent" ? "Digest Sent" : "Digest Pending";
}

function digestStyle(state: DigestState) {
  if (state === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function agendaStyle(state: AgendaState) {
  if (state === "done") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "inProgress") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function agendaLabel(state: AgendaState) {
  if (state === "inProgress") return "In Progress";
  return state[0].toUpperCase() + state.slice(1);
}

function nextAgendaState(state: AgendaState): AgendaState {
  if (state === "queued") return "inProgress";
  if (state === "inProgress") return "done";
  return "queued";
}

function decisionStyle(state: DecisionStatus) {
  if (state === "accepted") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function actionStatusStyle(state: ActionStatus) {
  if (state === "open") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (state === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function actionPriorityStyle(priority: ActionPriority) {
  if (priority === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function questionStyle(state: QuestionStatus) {
  if (state === "open") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function titleCase(value: string) {
  return value[0]?.toUpperCase() + value.slice(1);
}

function truncate(value: string, maxLength = 120) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function createInlineId(prefix: "D" | "A") {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${timestamp}${random}`;
}

export function MeetingRecordFlow({ workspaceSlug, meeting }: MeetingRecordFlowProps) {
  const [locked, setLocked] = useState(meeting.locked);
  const [revision, setRevision] = useState(meeting.revision);
  const [digestState, setDigestState] = useState<DigestState>(meeting.digest);
  const [lastSentLabel, setLastSentLabel] = useState(meeting.lastSentLabel ?? "Not sent yet");
  const [activityNotice, setActivityNotice] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>(meeting.agenda);
  const [notes, setNotes] = useState<NoteSection[]>(meeting.notes);
  const [attendees, setAttendees] = useState<Attendee[]>(meeting.attendees);
  const [openQuestions, setOpenQuestions] = useState<OpenQuestion[]>(meeting.openQuestions);
  const [decisions, setDecisions] = useState<Decision[]>(meeting.decisions);
  const [actions, setActions] = useState<Action[]>(meeting.actions);
  const [digestRecipients, setDigestRecipients] = useState<DigestRecipient[]>(
    meeting.digestRecipients,
  );
  const [includeNotes, setIncludeNotes] = useState(
    meeting.digestOptions?.includeNotes !== false,
  );
  const [includeOpenQuestions, setIncludeOpenQuestions] = useState(
    meeting.digestOptions?.includeOpenQuestions !== false,
  );
  const [includeActionOwners, setIncludeActionOwners] = useState(
    meeting.digestOptions?.includeActionOwners !== false,
  );
  const [decisionDraft, setDecisionDraft] = useState({
    title: "",
    owner: meeting.owner,
    rationale: "",
  });
  const [actionDraft, setActionDraft] = useState({
    title: "",
    owner: meeting.owner,
    dueLabel: "Next Tuesday",
    priority: "medium" as ActionPriority,
  });
  const [questionDraft, setQuestionDraft] = useState({
    question: "",
    owner: meeting.owner,
    dueLabel: "Before next sync",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [pendingRemovals, setPendingRemovals] = useState<PendingRemoval[]>([]);
  const hasHydratedRef = useRef(false);
  const saveRequestRef = useRef(0);
  const pendingRemovalsRef = useRef<PendingRemoval[]>([]);

  const presentCount = attendees.filter((attendee) => attendee.present).length;
  const openQuestionCount = openQuestions.filter((question) => question.status === "open").length;
  const openActionCount = actions.filter((action) => action.status !== "done").length;
  const enabledRecipients = digestRecipients.filter((recipient) => recipient.enabled).length;
  const pendingRemovalCount = pendingRemovals.length;
  const saveStatusLabel = saveError
    ? `Sync failed: ${saveError}`
    : pendingRemovalCount > 0
      ? `Waiting to sync ${pendingRemovalCount} pending removal${pendingRemovalCount === 1 ? "" : "s"}...`
      : isSaving
        ? "Saving changes..."
        : lastSavedAt
          ? `Saved at ${lastSavedAt}`
          : "Changes sync automatically.";

  const digestPreview = useMemo(() => {
    const previewNotes = includeNotes
      ? notes
          .map((note) => note.content.trim())
          .filter(Boolean)
          .slice(0, 2)
          .map((content) => truncate(content))
      : [];

    const previewDecisions = decisions.slice(0, 3).map((decision) => ({
      id: decision.id,
      title: decision.title,
      owner: decision.owner,
    }));

    const previewActions = actions
      .filter((action) => action.status !== "done")
      .slice(0, 4)
      .map((action) => ({
        id: action.id,
        title: action.title,
        owner: action.owner,
      }));

    const previewQuestions = includeOpenQuestions
      ? openQuestions
          .filter((question) => question.status === "open")
          .slice(0, 3)
          .map((question) => ({
            id: question.id,
            question: question.question,
          }))
      : [];

    return {
      previewNotes,
      previewDecisions,
      previewActions,
      previewQuestions,
    };
  }, [actions, decisions, includeNotes, includeOpenQuestions, notes, openQuestions]);

  const persistedMeeting = useMemo(
    () => ({
      title: meeting.title,
      team: meeting.team,
      owner: meeting.owner,
      timeLabel: meeting.timeLabel,
      duration: meeting.duration,
      location: meeting.location,
      objective: meeting.objective,
      state: meeting.state,
      digest: digestState,
      locked,
      revision,
      lastSentLabel,
      attendees,
      agenda,
      notes,
      openQuestions,
      decisions,
      actions,
      digestRecipients,
      digestOptions: {
        includeNotes,
        includeOpenQuestions,
        includeActionOwners,
      },
    }),
    [
      actions,
      agenda,
      attendees,
      decisions,
      digestRecipients,
      digestState,
      includeActionOwners,
      includeNotes,
      includeOpenQuestions,
      lastSentLabel,
      locked,
      notes,
      openQuestions,
      revision,
      meeting.duration,
      meeting.location,
      meeting.objective,
      meeting.owner,
      meeting.state,
      meeting.team,
      meeting.timeLabel,
      meeting.title,
    ],
  );

  const persistMeetingRecord = useCallback(async () => {
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/meetings/${encodeURIComponent(meeting.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meeting: persistedMeeting }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | PersistMeetingResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to save meeting record.");
      }

      if (requestId === saveRequestRef.current) {
        const revisionFromServer =
          typeof result?.meeting?.revision === "number"
            ? result.meeting.revision
            : null;
        if (revisionFromServer !== null && revisionFromServer !== revision) {
          setRevision(revisionFromServer);
        }

        const sentLabelFromServer =
          typeof result?.meeting?.lastSentLabel === "string"
            ? result.meeting.lastSentLabel
            : null;
        if (sentLabelFromServer && sentLabelFromServer !== lastSentLabel) {
          setLastSentLabel(sentLabelFromServer);
        }

        setLastSavedAt(
          new Date().toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
      }
    } catch (error) {
      if (requestId === saveRequestRef.current) {
        setSaveError(
          error instanceof Error ? error.message : "Failed to save meeting record.",
        );
      }
    } finally {
      if (requestId === saveRequestRef.current) {
        setIsSaving(false);
      }
    }
  }, [meeting.id, persistedMeeting, revision, workspaceSlug, lastSentLabel]);

  useEffect(() => {
    pendingRemovalsRef.current = pendingRemovals;
  }, [pendingRemovals]);

  useEffect(() => {
    return () => {
      pendingRemovalsRef.current.forEach((entry) => {
        window.clearTimeout(entry.timerId);
      });
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }

    if (pendingRemovals.length > 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      void persistMeetingRecord();
    }, 600);

    return () => window.clearTimeout(timer);
  }, [pendingRemovals.length, persistMeetingRecord]);

  function handleFinalizeRecord() {
    setLocked(true);
    setRevision((value) => value + 1);
    setActivityNotice("Meeting record finalized.");
  }

  function handleToggleLock() {
    setLocked((value) => !value);
    setActivityNotice(
      locked ? "Record unlocked." : "Record locked.",
    );
  }

  function handleSendDigestPreview() {
    if (enabledRecipients === 0) {
      setActivityNotice("Select at least one recipient before marking digest as sent.");
      return;
    }

    setDigestState("sent");
    setLastSentLabel("Moments ago");
    setRevision((value) => value + 1);
    setActivityNotice("Digest status updated to sent.");
  }

  function handleDecisionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = decisionDraft.title.trim();
    if (!title) {
      setActivityNotice("Decision title is required.");
      return;
    }

    const newDecision: Decision = {
      id: createInlineId("D"),
      title,
      owner: decisionDraft.owner.trim() || meeting.owner,
      status: "proposed",
      rationale: decisionDraft.rationale.trim() || "Rationale to be added.",
    };

    setDecisions((prev) => [newDecision, ...prev]);
    setDecisionDraft({ title: "", owner: meeting.owner, rationale: "" });
    setRevision((value) => value + 1);
    setActivityNotice(`Added decision ${newDecision.id}.`);
  }

  const commitPendingRemoval = useCallback((key: string) => {
    let pending: PendingRemoval | null = null;

    setPendingRemovals((prev) => {
      const found = prev.find((entry) => entry.key === key) ?? null;
      if (!found) return prev;
      pending = found;
      return prev.filter((entry) => entry.key !== key);
    });

    if (!pending) return;

    setRevision((value) => value + 1);

    if (pending.entity === "decision") {
      setActivityNotice(
        `Removed decision ${pending.decision.id}. It will be archived from canonical views after sync.`,
      );
      return;
    }

    setActivityNotice(
      `Removed action ${pending.action.id}. It will be archived from canonical views after sync.`,
    );
  }, []);

  const undoPendingRemoval = useCallback((key: string) => {
    let pending: PendingRemoval | null = null;

    setPendingRemovals((prev) => {
      const found = prev.find((entry) => entry.key === key) ?? null;
      if (!found) return prev;
      pending = found;
      return prev.filter((entry) => entry.key !== key);
    });

    if (!pending) return;

    window.clearTimeout(pending.timerId);

    if (pending.entity === "decision") {
      const restoredDecision = pending.decision;
      const restoredIndex = pending.index;

      setDecisions((prev) => {
        if (prev.some((decision) => decision.id === restoredDecision.id)) {
          return prev;
        }

        const next = [...prev];
        const insertAt = Math.min(Math.max(restoredIndex, 0), next.length);
        next.splice(insertAt, 0, restoredDecision);
        return next;
      });
      setActivityNotice(`Restored decision ${restoredDecision.id}.`);
      return;
    }

    const restoredAction = pending.action;
    const restoredIndex = pending.index;

    setActions((prev) => {
      if (prev.some((action) => action.id === restoredAction.id)) {
        return prev;
      }

      const next = [...prev];
      const insertAt = Math.min(Math.max(restoredIndex, 0), next.length);
      next.splice(insertAt, 0, restoredAction);
      return next;
    });
    setActivityNotice(`Restored action ${restoredAction.id}.`);
  }, []);

  function handleDecisionRemove(id: string) {
    const decisionIndex = decisions.findIndex((decision) => decision.id === id);
    if (decisionIndex === -1) return;
    const decision = decisions[decisionIndex];

    const confirmed = window.confirm(
      `Remove decision ${decision.id} from this meeting?\n\n` +
        "This removes it from the meeting record. After sync, the canonical decision will be archived from active views.\n\n" +
        "You can undo for a few seconds.",
    );

    if (!confirmed) return;

    const key = `decision:${decision.id}:${Date.now()}`;
    const timerId = window.setTimeout(() => {
      commitPendingRemoval(key);
    }, UNDO_WINDOW_MS);

    setPendingRemovals((prev) => [
      ...prev,
      {
        key,
        entity: "decision",
        decision,
        index: decisionIndex,
        timerId,
      },
    ]);
    setDecisions((prev) => prev.filter((entry) => entry.id !== id));
    setActivityNotice(
      `Removed decision ${decision.id}. Undo available for ${Math.floor(UNDO_WINDOW_MS / 1000)}s.`,
    );
  }

  function handleActionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = actionDraft.title.trim();
    if (!title) {
      setActivityNotice("Action title is required.");
      return;
    }

    const newAction: Action = {
      id: createInlineId("A"),
      title,
      owner: actionDraft.owner.trim() || meeting.owner,
      dueLabel: actionDraft.dueLabel.trim() || "No due date",
      priority: actionDraft.priority,
      status: "open",
    };

    setActions((prev) => [newAction, ...prev]);
    setActionDraft({
      title: "",
      owner: meeting.owner,
      dueLabel: "Next Tuesday",
      priority: "medium",
    });
    setRevision((value) => value + 1);
    setActivityNotice(`Added action ${newAction.id}.`);
  }

  function handleActionRemove(id: string) {
    const actionIndex = actions.findIndex((action) => action.id === id);
    if (actionIndex === -1) return;
    const action = actions[actionIndex];

    const confirmed = window.confirm(
      `Remove action ${action.id} from this meeting?\n\n` +
        "This removes it from the meeting record. After sync, the canonical action will be archived from active views.\n\n" +
        "You can undo for a few seconds.",
    );

    if (!confirmed) return;

    const key = `action:${action.id}:${Date.now()}`;
    const timerId = window.setTimeout(() => {
      commitPendingRemoval(key);
    }, UNDO_WINDOW_MS);

    setPendingRemovals((prev) => [
      ...prev,
      {
        key,
        entity: "action",
        action,
        index: actionIndex,
        timerId,
      },
    ]);
    setActions((prev) => prev.filter((entry) => entry.id !== id));
    setActivityNotice(
      `Removed action ${action.id}. Undo available for ${Math.floor(UNDO_WINDOW_MS / 1000)}s.`,
    );
  }

  function handleQuestionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = questionDraft.question.trim();
    if (!question) {
      setActivityNotice("Question text is required.");
      return;
    }

    const newQuestion: OpenQuestion = {
      id: `Q-${openQuestions.length + 1}`,
      question,
      owner: questionDraft.owner.trim() || meeting.owner,
      dueLabel: questionDraft.dueLabel.trim() || "No due date",
      status: "open",
    };

    setOpenQuestions((prev) => [newQuestion, ...prev]);
    setQuestionDraft({
      question: "",
      owner: meeting.owner,
      dueLabel: "Before next sync",
    });
    setRevision((value) => value + 1);
    setActivityNotice(`Added open question ${newQuestion.id}.`);
  }

  return (
    <>
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{meeting.team}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Record Overview</h2>
            <p className="mt-2 text-sm text-slate-600">{meeting.objective}</p>
            <p className="mt-2 text-xs text-slate-600">
              {meeting.timeLabel} • {meeting.duration} • {meeting.location}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
            <span className={`rounded-sm border px-2 py-1 ${meetingStateStyle(meeting.state)}`}>
              {meetingStateLabel(meeting.state)}
            </span>
            <span className={`rounded-sm border px-2 py-1 ${digestStyle(digestState)}`}>
              {digestLabel(digestState)}
            </span>
            <span
              className={cx(
                "rounded-sm border px-2 py-1",
                locked
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-slate-100 text-slate-700",
              )}
            >
              {locked ? "Locked" : "Editable"}
            </span>
            <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 text-slate-700">
              Revision {revision}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <SummaryTile
            label="Attendees Present"
            value={`${presentCount}/${attendees.length}`}
            detail="Attendance tracked"
          />
          <SummaryTile
            label="Decisions"
            value={String(decisions.length)}
            detail="Captured during meeting"
          />
          <SummaryTile
            label="Open Actions"
            value={String(openActionCount)}
            detail="Follow-up ownership"
          />
          <SummaryTile
            label="Open Questions"
            value={String(openQuestionCount)}
            detail="Needs resolution"
          />
        </div>
      </WorkspacePanel>

      {activityNotice ? (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
          {activityNotice}
        </p>
      ) : null}

      {pendingRemovals.length > 0 ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(28rem,calc(100vw-1.5rem))] flex-col gap-2">
          {pendingRemovals.map((pending) => (
            <div
              key={pending.key}
              className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 shadow-sm"
            >
              <p className="text-sm text-amber-800">
                {pending.entity === "decision"
                  ? `Decision ${pending.decision.id} removed.`
                  : `Action ${pending.action.id} removed.`}{" "}
                Undo before sync to cancel archive.
              </p>
              <button
                type="button"
                onClick={() => undoPendingRemoval(pending.key)}
                className="rounded-sm border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 transition hover:border-amber-500"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <p
        className={cx(
          "rounded-sm border px-3 py-2 text-sm",
          saveError
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-white text-slate-600",
        )}
      >
        {saveStatusLabel}
      </p>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-6">
          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">Agenda and Notes</h3>
              <span className="text-xs font-semibold tracking-[0.1em] text-slate-600">
                Tap status to cycle
              </span>
            </div>

            <div className="space-y-2">
              {agenda.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    setAgenda((prev) =>
                      prev.map((current) =>
                        current.id === item.id
                          ? { ...current, state: nextAgendaState(current.state) }
                          : current,
                      ),
                    )
                  }
                  className="flex w-full items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-400"
                >
                  <span className="text-sm text-slate-700">{item.title}</span>
                  <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${agendaStyle(item.state)}`}>
                    {agendaLabel(item.state)}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {notes.map((note) => (
                <label key={note.id} className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
                    {note.heading}
                  </span>
                  <textarea
                    value={note.content}
                    onChange={(event) =>
                      setNotes((prev) =>
                        prev.map((current) =>
                          current.id === note.id
                            ? { ...current, content: event.target.value }
                            : current,
                        ),
                      )
                    }
                    rows={3}
                    className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
                  />
                </label>
              ))}
            </div>
          </WorkspacePanel>

          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">Open Questions</h3>
              <span className="text-sm text-slate-600">{openQuestionCount} unresolved</span>
            </div>

            <div className="space-y-2">
              {openQuestions.map((question) => (
                <article key={question.id} className="rounded-sm border border-slate-200 bg-white px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{question.question}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {question.id} • Owner {question.owner} • Due {question.dueLabel}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${questionStyle(question.status)}`}>
                        {titleCase(question.status)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenQuestions((prev) =>
                            prev.map((current) =>
                              current.id === question.id
                                ? {
                                    ...current,
                                    status:
                                      current.status === "open" ? "resolved" : "open",
                                  }
                                : current,
                            ),
                          )
                        }
                        className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                      >
                        {question.status === "open" ? "Mark resolved" : "Reopen"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <form className="mt-4 grid gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3" onSubmit={handleQuestionSubmit}>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
                Add Open Question
              </p>
              <input
                value={questionDraft.question}
                onChange={(event) =>
                  setQuestionDraft((prev) => ({ ...prev, question: event.target.value }))
                }
                placeholder="Question to track"
                className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={questionDraft.owner}
                  onChange={(event) =>
                    setQuestionDraft((prev) => ({ ...prev, owner: event.target.value }))
                  }
                  placeholder="Owner"
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <input
                  value={questionDraft.dueLabel}
                  onChange={(event) =>
                    setQuestionDraft((prev) => ({ ...prev, dueLabel: event.target.value }))
                  }
                  placeholder="Due label"
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <button
                type="submit"
                className="justify-self-start rounded-sm bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
              >
                Add question
              </button>
            </form>
          </WorkspacePanel>

          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">Decisions Captured</h3>
              <span className="text-sm text-slate-600">{decisions.length} decisions</span>
            </div>

            <div className="space-y-2">
              {decisions.map((decision) => (
                <article key={decision.id} className="rounded-sm border border-slate-200 bg-white px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{decision.title}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {decision.id} • Owner {decision.owner}
                      </p>
                      <p className="mt-2 text-sm text-slate-700">{decision.rationale}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${decisionStyle(decision.status)}`}>
                        {titleCase(decision.status)}
                      </span>
                      <Link
                        href={`/${workspaceSlug}/decisions/${decision.id}`}
                        className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDecisionRemove(decision.id)}
                        className="rounded-sm border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <form className="mt-4 grid gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3" onSubmit={handleDecisionSubmit}>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
                Capture Decision Inline
              </p>
              <input
                value={decisionDraft.title}
                onChange={(event) =>
                  setDecisionDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Decision title"
                className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <div className="grid gap-2 sm:grid-cols-[0.6fr_1.4fr]">
                <input
                  value={decisionDraft.owner}
                  onChange={(event) =>
                    setDecisionDraft((prev) => ({ ...prev, owner: event.target.value }))
                  }
                  placeholder="Owner"
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <input
                  value={decisionDraft.rationale}
                  onChange={(event) =>
                    setDecisionDraft((prev) => ({ ...prev, rationale: event.target.value }))
                  }
                  placeholder="Short rationale"
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <button
                type="submit"
                className="justify-self-start rounded-sm bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
              >
                Add decision
              </button>
            </form>
          </WorkspacePanel>

          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">Actions Captured</h3>
              <span className="text-sm text-slate-600">{actions.length} actions</span>
            </div>

            <div className="space-y-2">
              {actions.map((action) => (
                <article key={action.id} className="rounded-sm border border-slate-200 bg-white px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{action.title}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {action.id} • Owner {action.owner} • Due {action.dueLabel}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${actionStatusStyle(action.status)}`}>
                        {titleCase(action.status)}
                      </span>
                      <span className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${actionPriorityStyle(action.priority)}`}>
                        {titleCase(action.priority)}
                      </span>
                      <Link
                        href={`/${workspaceSlug}/actions/${action.id}`}
                        className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleActionRemove(action.id)}
                        className="rounded-sm border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <form className="mt-4 grid gap-2 rounded-sm border border-slate-200 bg-slate-50 p-3" onSubmit={handleActionSubmit}>
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
                Create Action Inline
              </p>
              <input
                value={actionDraft.title}
                onChange={(event) =>
                  setActionDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Action title"
                className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  value={actionDraft.owner}
                  onChange={(event) =>
                    setActionDraft((prev) => ({ ...prev, owner: event.target.value }))
                  }
                  placeholder="Owner"
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <input
                  value={actionDraft.dueLabel}
                  onChange={(event) =>
                    setActionDraft((prev) => ({ ...prev, dueLabel: event.target.value }))
                  }
                  placeholder="Due label"
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
                <select
                  value={actionDraft.priority}
                  onChange={(event) =>
                    setActionDraft((prev) => ({
                      ...prev,
                      priority: event.target.value as ActionPriority,
                    }))
                  }
                  className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <button
                type="submit"
                className="justify-self-start rounded-sm bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
              >
                Add action
              </button>
            </form>
          </WorkspacePanel>
        </div>

        <div className="space-y-6">
          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold tracking-tight text-slate-900">Attendees</h3>
              <span className="text-sm text-slate-600">{presentCount} present</span>
            </div>

            <div className="space-y-2">
              {attendees.map((attendee) => (
                <article key={attendee.id} className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{attendee.name}</p>
                    <p className="text-xs text-slate-600">
                      {attendee.role} • {attendee.required ? "Required" : "Optional"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAttendees((prev) =>
                        prev.map((current) =>
                          current.id === attendee.id
                            ? { ...current, present: !current.present }
                            : current,
                        ),
                      )
                    }
                    className={cx(
                      "rounded-sm border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] transition",
                      attendee.present
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-400"
                        : "border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-400",
                    )}
                  >
                    {attendee.present ? "Present" : "Absent"}
                  </button>
                </article>
              ))}
            </div>
          </WorkspacePanel>

          <WorkspacePanel>
            <h3 className="text-xl font-semibold tracking-tight text-slate-900">Digest</h3>
            <p className="mt-1 text-sm text-slate-600">
              Last sent: {lastSentLabel}
            </p>

            <div className="mt-4 space-y-2">
              {digestRecipients.map((recipient) => (
                <label
                  key={recipient.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2.5"
                >
                  <span className="text-sm text-slate-700">{recipient.label}</span>
                  <input
                    type="checkbox"
                    checked={recipient.enabled}
                    onChange={(event) =>
                      setDigestRecipients((prev) =>
                        prev.map((current) =>
                          current.id === recipient.id
                            ? { ...current, enabled: event.target.checked }
                            : current,
                        ),
                      )
                    }
                    className="h-4 w-4 rounded-sm border-slate-300"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-3">
              <ToggleSetting
                label="Include notes summary"
                enabled={includeNotes}
                onToggle={() => setIncludeNotes((value) => !value)}
              />
              <ToggleSetting
                label="Include open questions"
                enabled={includeOpenQuestions}
                onToggle={() => setIncludeOpenQuestions((value) => !value)}
              />
              <ToggleSetting
                label="Include action owners"
                enabled={includeActionOwners}
                onToggle={() => setIncludeActionOwners((value) => !value)}
              />
            </div>

            <div className="mt-4 rounded-sm border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
                Digest Body
              </p>
              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <p>
                  {meeting.title} concluded with {decisions.length} decision(s) and {openActionCount} open action(s).
                </p>

                {digestPreview.previewNotes.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">Notes</p>
                    <ul className="mt-1 space-y-1">
                      {digestPreview.previewNotes.map((note) => (
                        <li key={note} className="text-sm text-slate-700">
                          • {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                    Decisions
                  </p>
                  <ul className="mt-1 space-y-1">
                    {digestPreview.previewDecisions.map((decision) => (
                      <li key={decision.id} className="text-sm text-slate-700">
                        • {decision.id}: {decision.title} ({decision.owner})
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                    Action Items
                  </p>
                  <ul className="mt-1 space-y-1">
                    {digestPreview.previewActions.map((action) => (
                      <li key={action.id} className="text-sm text-slate-700">
                        • {action.id}: {action.title}
                        {includeActionOwners ? ` (${action.owner})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>

                {digestPreview.previewQuestions.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-600">
                      Open Questions
                    </p>
                    <ul className="mt-1 space-y-1">
                      {digestPreview.previewQuestions.map((question) => (
                        <li key={question.id} className="text-sm text-slate-700">
                          • {question.id}: {question.question}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSendDigestPreview}
                className="rounded-sm bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
              >
                Mark digest sent
              </button>
              <span className="text-xs text-slate-600">
                Recipients selected: {enabledRecipients}
              </span>
            </div>
          </WorkspacePanel>

          <WorkspacePanel className="border-amber-200 bg-amber-50/50">
            <h3 className="text-xl font-semibold tracking-tight text-amber-900">Record Controls</h3>
            <p className="mt-2 text-sm text-amber-800">
              Finalize after reviewing notes, decisions, actions, and open questions.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleFinalizeRecord}
                className="rounded-sm border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:border-amber-500"
              >
                Finalize record
              </button>
              <button
                type="button"
                onClick={handleToggleLock}
                className="rounded-sm border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:border-amber-500"
              >
                {locked ? "Unlock record" : "Lock record"}
              </button>
            </div>
            <p className="mt-3 text-xs text-amber-800">
              Changes are persisted to your workspace automatically.
            </p>
          </WorkspacePanel>
        </div>
      </section>
    </>
  );
}

function ToggleSetting({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2 text-left"
    >
      <span className="text-sm text-slate-700">{label}</span>
      <span
        className={cx(
          "rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em]",
          enabled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-100 text-slate-700",
        )}
      >
        {enabled ? "On" : "Off"}
      </span>
    </button>
  );
}
