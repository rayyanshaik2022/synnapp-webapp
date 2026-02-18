"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WorkspacePanel } from "@/components/workspace/primitives";

type MeetingRevisionEventType = "created" | "updated" | "restored";
type MeetingRevisionSource = "meetingUpdate" | "restore";

export type MeetingRevisionHistoryEntry = {
  id: string;
  meetingRevision: number;
  eventType: MeetingRevisionEventType;
  source: MeetingRevisionSource;
  actorName: string;
  summary: string;
  changedFields: string[];
  capturedAtLabel: string;
  restoredFromRevisionId: string;
  isCurrent: boolean;
};

type MeetingRevisionHistoryProps = {
  workspaceSlug: string;
  meetingId: string;
  entries: MeetingRevisionHistoryEntry[];
  canRestoreRevisions: boolean;
  actorRoleLabel: string;
};

type RestoreResponse = {
  error?: string;
  restoredFromRevisionId?: string;
  meeting?: {
    revision?: number;
  };
};

function eventTypeLabel(eventType: MeetingRevisionEventType) {
  if (eventType === "created") return "Created";
  if (eventType === "updated") return "Updated";
  return "Restored";
}

function eventTypeStyle(eventType: MeetingRevisionEventType) {
  if (eventType === "created") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (eventType === "updated") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function sourceLabel(source: MeetingRevisionSource) {
  return source === "restore" ? "Restore" : "Auto Sync";
}

function formatFieldLabel(field: string) {
  return field
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function MeetingRevisionHistory({
  workspaceSlug,
  meetingId,
  entries,
  canRestoreRevisions,
  actorRoleLabel,
}: MeetingRevisionHistoryProps) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string | null>(null);

  async function handleRestore(revisionId: string, meetingRevision: number) {
    if (!canRestoreRevisions) {
      setError("Only owners and admins can restore meeting revisions.");
      return;
    }

    const confirmed = window.confirm(
      `Restore meeting revision ${meetingRevision}?\n\nThis will replace the active meeting record and create a new restore revision.`,
    );

    if (!confirmed) return;

    setRestoringRevisionId(revisionId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/meetings/${encodeURIComponent(meetingId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            restoreFromRevisionId: revisionId,
          }),
        },
      );

      const result = (await response.json().catch(() => null)) as RestoreResponse | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to restore revision.");
      }

      const restoredRevision =
        typeof result?.meeting?.revision === "number" ? result.meeting.revision : null;
      setNotice(
        restoredRevision
          ? `Restored revision ${meetingRevision}. Current revision is now ${restoredRevision}.`
          : `Restored revision ${meetingRevision}.`,
      );
      router.refresh();
    } catch (restoreError) {
      const message =
        restoreError instanceof Error ? restoreError.message : "Failed to restore revision.";
      setError(message);
    } finally {
      setRestoringRevisionId(null);
    }
  }

  return (
    <WorkspacePanel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Revision History</h2>
        <span className="text-xs font-semibold tracking-[0.1em] text-slate-600">
          {entries.length} revision{entries.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-600">
        Review who changed the meeting and restore previous snapshots when needed.
      </p>

      {notice ? (
        <p className="mt-3 rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {!canRestoreRevisions ? (
        <p className="mt-3 text-xs text-slate-500">
          Revision restore requires owner/admin permission. Your role: {actorRoleLabel}.
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="mt-4 rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          No revisions yet. Changes will appear here as the meeting is edited.
        </p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {entries.map((entry) => (
            <article key={entry.id} className="rounded-sm border border-slate-200 bg-white px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${eventTypeStyle(entry.eventType)}`}
                  >
                    {eventTypeLabel(entry.eventType)}
                  </span>
                  <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
                    {sourceLabel(entry.source)}
                  </span>
                  <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
                    Revision {entry.meetingRevision}
                  </span>
                  {entry.isCurrent ? (
                    <span className="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-emerald-700">
                      Current
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleRestore(entry.id, entry.meetingRevision)}
                  disabled={
                    !canRestoreRevisions ||
                    entry.isCurrent ||
                    restoringRevisionId !== null
                  }
                  className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {restoringRevisionId === entry.id ? "Restoring..." : "Restore"}
                </button>
              </div>

              <p className="mt-2 text-sm text-slate-900">{entry.summary}</p>
              <p className="mt-1 text-xs text-slate-600">
                {entry.actorName} • {entry.capturedAtLabel}
              </p>

              {entry.changedFields.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {entry.changedFields.map((field) => (
                    <span
                      key={`${entry.id}-${field}`}
                      className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-700"
                    >
                      {formatFieldLabel(field)}
                    </span>
                  ))}
                </div>
              ) : null}

              {entry.restoredFromRevisionId ? (
                <p className="mt-2 text-xs text-slate-500">
                  Restored from revision snapshot {entry.restoredFromRevisionId}.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </WorkspacePanel>
  );
}
