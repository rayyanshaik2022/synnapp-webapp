"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { emitEntityHistoryEvent } from "@/lib/workspace/history-client-events";
import { MemberMentionPicker } from "@/components/workspace/member-mention-picker";
import { MemberOwnerInput } from "@/components/workspace/member-owner-input";

type ActionStatus = "open" | "done" | "blocked";
type ActionPriority = "high" | "medium" | "low";

export type ActionEditorValues = {
  title: string;
  description: string;
  owner: string;
  status: ActionStatus;
  priority: ActionPriority;
  project: string;
  dueDate: string;
  dueLabel: string;
  meetingId: string;
  decisionId: string;
  blockedReason: string;
  notes: string;
  mentionUids: string[];
};

type ActionEditorProps = {
  workspaceSlug: string;
  mode: "create" | "edit";
  actionId?: string;
  initialValues: ActionEditorValues;
  isArchived?: boolean;
  canArchiveRestore?: boolean;
  actorRoleLabel?: string;
};

type ActionApiResponse = {
  error?: string;
  actionId?: string;
  archived?: boolean;
};

function mapPayload(values: ActionEditorValues) {
  const dueAtDate = values.dueDate ? new Date(`${values.dueDate}T00:00:00`) : null;
  const dueAt = dueAtDate ? dueAtDate.toISOString() : "";
  const dueLabel =
    values.dueLabel.trim() ||
    (dueAtDate
      ? dueAtDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "No due date");

  return {
    title: values.title.trim(),
    description: values.description.trim(),
    owner: values.owner.trim(),
    status: values.status,
    priority: values.priority,
    project: values.project.trim(),
    dueAt,
    dueLabel,
    meetingId: values.meetingId.trim(),
    decisionId: values.decisionId.trim(),
    blockedReason: values.blockedReason.trim(),
    notes: values.notes.trim(),
    mentionUids: values.mentionUids,
  };
}

export function ActionEditor({
  workspaceSlug,
  mode,
  actionId,
  initialValues,
  isArchived = false,
  canArchiveRestore = true,
  actorRoleLabel = "Member",
}: ActionEditorProps) {
  const router = useRouter();
  const [savedValues, setSavedValues] = useState<ActionEditorValues>(initialValues);
  const [values, setValues] = useState<ActionEditorValues>(initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [archivedState, setArchivedState] = useState(isArchived);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setArchivedState(isArchived);
  }, [isArchived]);

  const canSubmit = useMemo(() => values.title.trim().length > 0, [values.title]);

  const isDirty = useMemo(() => {
    if (mode === "create") return true;
    return JSON.stringify(values) !== JSON.stringify(savedValues);
  }, [mode, savedValues, values]);

  function createHistoryTimestampLabel() {
    return new Date().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function emitLocalHistoryEvent(
    eventType: "updated" | "archived" | "restored",
    message: string,
  ) {
    if (mode !== "edit" || !actionId) return;

    emitEntityHistoryEvent({
      entity: "action",
      entityId: actionId,
      entry: {
        id: `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        actorName: "You",
        message,
        eventType,
        source: "manual",
        atLabel: createHistoryTimestampLabel(),
      },
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!canSubmit) {
      setError("Action title is required.");
      return;
    }

    if (mode === "edit" && !actionId) {
      setError("Action ID is missing.");
      return;
    }

    if (values.status === "blocked" && !values.blockedReason.trim()) {
      setError("Blocked reason is required when status is Blocked.");
      return;
    }

    if (values.dueDate && values.status === "open") {
      const dueDate = new Date(`${values.dueDate}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (dueDate.getTime() < today.getTime()) {
        setError("Due date cannot be in the past for open actions.");
        return;
      }
    }

    const payload = mapPayload(values);
    const endpoint =
      mode === "create"
        ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/actions`
        : `/api/workspaces/${encodeURIComponent(workspaceSlug)}/actions/${encodeURIComponent(actionId ?? "")}`;

    setIsSubmitting(true);

    try {
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: payload }),
      });

      const result = (await response.json().catch(() => null)) as ActionApiResponse | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to save action.");
      }

      const returnedActionId = result?.actionId?.trim();

      if (mode === "create") {
        if (!returnedActionId) {
          throw new Error("Action was created, but no ID was returned.");
        }

        router.push(`/${workspaceSlug}/actions/${returnedActionId}`);
        return;
      }

      setSavedValues(values);
      setValues(values);
      setNotice("Action saved.");
      emitLocalHistoryEvent("updated", `Updated action ${actionId}.`);
      router.refresh();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to save action.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDiscard() {
    setValues(savedValues);
    setError(null);
    setNotice(null);
  }

  async function handleRestore() {
    if (mode !== "edit" || !actionId) {
      return;
    }

    if (!canArchiveRestore) {
      setError("Only owners and admins can restore actions.");
      return;
    }

    setIsRestoring(true);
    setError(null);
    setNotice(null);

    try {
      const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/actions/${encodeURIComponent(actionId)}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });

      const result = (await response.json().catch(() => null)) as ActionApiResponse | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to restore action.");
      }

      setArchivedState(false);
      setNotice("Action restored.");
      emitLocalHistoryEvent("restored", `Restored action ${actionId}.`);
      router.refresh();
    } catch (restoreError) {
      const message =
        restoreError instanceof Error ? restoreError.message : "Failed to restore action.";
      setError(message);
    } finally {
      setIsRestoring(false);
    }
  }

  async function handleArchive() {
    if (mode !== "edit" || !actionId) {
      return;
    }

    if (!canArchiveRestore) {
      setError("Only owners and admins can archive actions.");
      return;
    }

    const confirmed = window.confirm(
      "Archive this action?\n\nIt will be hidden from active views until restored.",
    );

    if (!confirmed) return;

    setIsArchiving(true);
    setError(null);
    setNotice(null);

    try {
      const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/actions/${encodeURIComponent(actionId)}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      const result = (await response.json().catch(() => null)) as ActionApiResponse | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to archive action.");
      }

      setArchivedState(true);
      setNotice("Action archived.");
      emitLocalHistoryEvent("archived", `Archived action ${actionId}.`);
      router.refresh();
    } catch (archiveError) {
      const message =
        archiveError instanceof Error ? archiveError.message : "Failed to archive action.";
      setError(message);
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {archivedState ? (
        <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          This action is archived. Restore it to make it active in default views.
        </p>
      ) : null}

      <MemberMentionPicker
        workspaceSlug={workspaceSlug}
        value={values.mentionUids}
        onChange={(nextMentionUids) =>
          setValues((prev) => ({ ...prev, mentionUids: nextMentionUids }))
        }
        disabled={isSubmitting}
      />

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Title
        </span>
        <input
          value={values.title}
          onChange={(event) => setValues((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Finalize SSO rollout checklist"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Description
        </span>
        <textarea
          value={values.description}
          onChange={(event) =>
            setValues((prev) => ({ ...prev, description: event.target.value }))
          }
          rows={3}
          placeholder="Add execution notes, constraints, and expected completion output."
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <MemberOwnerInput
          workspaceSlug={workspaceSlug}
          value={values.owner}
          onChange={(owner) => setValues((prev) => ({ ...prev, owner }))}
          disabled={isSubmitting}
          label="Owner"
          placeholder="Action owner"
        />

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Project / Team
          </span>
          <input
            value={values.project}
            onChange={(event) => setValues((prev) => ({ ...prev, project: event.target.value }))}
            placeholder="Identity"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Status
          </span>
          <select
            value={values.status}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                status: event.target.value as ActionStatus,
              }))
            }
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="open">Open</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Priority
          </span>
          <select
            value={values.priority}
            onChange={(event) =>
              setValues((prev) => ({
                ...prev,
                priority: event.target.value as ActionPriority,
              }))
            }
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Due Date
          </span>
          <input
            type="date"
            value={values.dueDate}
            onChange={(event) => setValues((prev) => ({ ...prev, dueDate: event.target.value }))}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Due Label Override
        </span>
        <input
          value={values.dueLabel}
          onChange={(event) => setValues((prev) => ({ ...prev, dueLabel: event.target.value }))}
          placeholder="Today, 4:00 PM"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Origin Meeting ID
          </span>
          <input
            value={values.meetingId}
            onChange={(event) => setValues((prev) => ({ ...prev, meetingId: event.target.value }))}
            placeholder="M-123456"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Origin Decision ID
          </span>
          <input
            value={values.decisionId}
            onChange={(event) => setValues((prev) => ({ ...prev, decisionId: event.target.value }))}
            placeholder="D-123456"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      </div>

      {values.status === "blocked" ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Blocked Reason
          </span>
          <textarea
            value={values.blockedReason}
            onChange={(event) =>
              setValues((prev) => ({ ...prev, blockedReason: event.target.value }))
            }
            rows={3}
            placeholder="What dependency is currently blocking this action?"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Notes
        </span>
        <textarea
          value={values.notes}
          onChange={(event) => setValues((prev) => ({ ...prev, notes: event.target.value }))}
          rows={4}
          placeholder="Capture follow-up context or implementation notes."
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      {notice ? (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${workspaceSlug}/actions`}
          className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
        >
          Back to actions
        </Link>
        {mode === "edit" ? (
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!isDirty || isSubmitting}
            className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Discard changes
          </button>
        ) : null}
        {mode === "edit" ? (
          <button
            type="button"
            onClick={handleArchive}
            disabled={
              !canArchiveRestore ||
              archivedState ||
              isSubmitting ||
              isRestoring ||
              isArchiving
            }
            className="rounded-sm border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isArchiving ? "Archiving..." : "Archive"}
          </button>
        ) : null}
        {mode === "edit" ? (
          <button
            type="button"
            onClick={handleRestore}
            disabled={
              !canArchiveRestore ||
              !archivedState ||
              isSubmitting ||
              isRestoring ||
              isArchiving
            }
            className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRestoring ? "Restoring..." : "Restore"}
          </button>
        ) : null}
        <button
          type="submit"
          disabled={
            !canSubmit ||
            (mode === "edit" && !isDirty) ||
            isSubmitting ||
            isArchiving ||
            isRestoring
          }
          className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting
            ? mode === "create"
              ? "Creating action..."
              : "Saving action..."
            : mode === "create"
              ? "Create action"
              : "Save action"}
        </button>
      </div>

      {mode === "edit" && !canArchiveRestore ? (
        <p className="text-xs text-slate-500">
          Archive and restore require owner/admin permission. Your role: {actorRoleLabel}.
        </p>
      ) : null}
    </form>
  );
}
