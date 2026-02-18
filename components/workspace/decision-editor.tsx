"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { emitEntityHistoryEvent } from "@/lib/workspace/history-client-events";
import { MemberMentionPicker } from "@/components/workspace/member-mention-picker";
import { MemberOwnerInput } from "@/components/workspace/member-owner-input";

type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";
type DecisionVisibility = "workspace" | "team" | "private";

export type DecisionEditorValues = {
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

type DecisionEditorProps = {
  workspaceSlug: string;
  mode: "create" | "edit";
  decisionId?: string;
  initialValues: DecisionEditorValues;
  isArchived?: boolean;
  canArchiveRestore?: boolean;
  actorRoleLabel?: string;
};

type DecisionApiResponse = {
  error?: string;
  decisionId?: string;
  archived?: boolean;
};

type DecisionFormState = Omit<DecisionEditorValues, "tags"> & {
  tagsInput: string;
};

function parseTags(value: string) {
  const unique = new Set<string>();
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => unique.add(entry));

  return Array.from(unique);
}

function mapValuesToFormState(values: DecisionEditorValues): DecisionFormState {
  return {
    title: values.title,
    statement: values.statement,
    rationale: values.rationale,
    owner: values.owner,
    status: values.status,
    visibility: values.visibility,
    teamLabel: values.teamLabel,
    tagsInput: values.tags.join(", "),
    meetingId: values.meetingId,
    supersedesDecisionId: values.supersedesDecisionId,
    supersededByDecisionId: values.supersededByDecisionId,
    mentionUids: values.mentionUids,
  };
}

function mapFormStateToPayload(values: DecisionFormState): DecisionEditorValues {
  return {
    title: values.title.trim(),
    statement: values.statement.trim(),
    rationale: values.rationale.trim(),
    owner: values.owner.trim(),
    status: values.status,
    visibility: values.visibility,
    teamLabel: values.teamLabel.trim(),
    tags: parseTags(values.tagsInput),
    meetingId: values.meetingId.trim(),
    supersedesDecisionId: values.supersedesDecisionId.trim(),
    supersededByDecisionId: values.supersededByDecisionId.trim(),
    mentionUids: values.mentionUids,
  };
}

export function DecisionEditor({
  workspaceSlug,
  mode,
  decisionId,
  initialValues,
  isArchived = false,
  canArchiveRestore = true,
  actorRoleLabel = "Member",
}: DecisionEditorProps) {
  const router = useRouter();
  const [savedFormState, setSavedFormState] = useState<DecisionFormState>(
    mapValuesToFormState(initialValues),
  );
  const [formState, setFormState] = useState<DecisionFormState>(
    mapValuesToFormState(initialValues),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [archivedState, setArchivedState] = useState(isArchived);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setArchivedState(isArchived);
  }, [isArchived]);

  const canSubmit = useMemo(() => {
    return formState.title.trim().length > 0 && formState.statement.trim().length > 0;
  }, [formState.statement, formState.title]);

  const isDirty = useMemo(() => {
    if (mode === "create") return true;
    return JSON.stringify(formState) !== JSON.stringify(savedFormState);
  }, [formState, mode, savedFormState]);

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
    if (mode !== "edit" || !decisionId) return;

    emitEntityHistoryEvent({
      entity: "decision",
      entityId: decisionId,
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
      setError("Title and statement are required.");
      return;
    }

    if (mode === "edit" && !decisionId) {
      setError("Decision ID is missing.");
      return;
    }

    const payload = mapFormStateToPayload(formState);
    if (payload.visibility === "team" && !payload.teamLabel) {
      setError("Team label is required when visibility is set to Team.");
      return;
    }

    if (
      payload.status === "superseded" &&
      !payload.supersedesDecisionId &&
      !payload.supersededByDecisionId
    ) {
      setError(
        "Superseded decisions should reference either the decision they supersede or the decision replacing them.",
      );
      return;
    }

    const endpoint =
      mode === "create"
        ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/decisions`
        : `/api/workspaces/${encodeURIComponent(workspaceSlug)}/decisions/${encodeURIComponent(decisionId ?? "")}`;

    setIsSubmitting(true);

    try {
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: payload }),
      });

      const result = (await response.json().catch(() => null)) as
        | DecisionApiResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to save decision.");
      }

      const returnedDecisionId = result?.decisionId?.trim();

      if (mode === "create") {
        if (!returnedDecisionId) {
          throw new Error("Decision was created, but no ID was returned.");
        }

        router.push(`/${workspaceSlug}/decisions/${returnedDecisionId}`);
        return;
      }

      const nextSavedState = mapValuesToFormState(payload);
      setFormState(nextSavedState);
      setSavedFormState(nextSavedState);
      setNotice("Decision saved.");
      emitLocalHistoryEvent("updated", `Updated decision ${decisionId}.`);
      router.refresh();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to save decision.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDiscard() {
    setFormState(savedFormState);
    setError(null);
    setNotice(null);
  }

  async function handleRestore() {
    if (mode !== "edit" || !decisionId) {
      return;
    }

    if (!canArchiveRestore) {
      setError("Only owners and admins can restore decisions.");
      return;
    }

    setIsRestoring(true);
    setError(null);
    setNotice(null);

    try {
      const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/decisions/${encodeURIComponent(decisionId)}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });

      const result = (await response.json().catch(() => null)) as DecisionApiResponse | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to restore decision.");
      }

      setArchivedState(false);
      setNotice("Decision restored.");
      emitLocalHistoryEvent("restored", `Restored decision ${decisionId}.`);
      router.refresh();
    } catch (restoreError) {
      const message =
        restoreError instanceof Error ? restoreError.message : "Failed to restore decision.";
      setError(message);
    } finally {
      setIsRestoring(false);
    }
  }

  async function handleArchive() {
    if (mode !== "edit" || !decisionId) {
      return;
    }

    if (!canArchiveRestore) {
      setError("Only owners and admins can archive decisions.");
      return;
    }

    const confirmed = window.confirm(
      "Archive this decision?\n\nIt will be hidden from active views until restored.",
    );

    if (!confirmed) return;

    setIsArchiving(true);
    setError(null);
    setNotice(null);

    try {
      const endpoint = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/decisions/${encodeURIComponent(decisionId)}`;
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      const result = (await response.json().catch(() => null)) as DecisionApiResponse | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to archive decision.");
      }

      setArchivedState(true);
      setNotice("Decision archived.");
      emitLocalHistoryEvent("archived", `Archived decision ${decisionId}.`);
      router.refresh();
    } catch (archiveError) {
      const message =
        archiveError instanceof Error ? archiveError.message : "Failed to archive decision.";
      setError(message);
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {archivedState ? (
        <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          This decision is archived. Restore it to make it active in default views.
        </p>
      ) : null}

      <MemberMentionPicker
        workspaceSlug={workspaceSlug}
        value={formState.mentionUids}
        onChange={(nextMentionUids) =>
          setFormState((prev) => ({ ...prev, mentionUids: nextMentionUids }))
        }
        disabled={isSubmitting}
      />

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Title
        </span>
        <input
          value={formState.title}
          onChange={(event) =>
            setFormState((prev) => ({ ...prev, title: event.target.value }))
          }
          placeholder="Adopt role-based onboarding in workspace setup"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Statement
        </span>
        <textarea
          value={formState.statement}
          onChange={(event) =>
            setFormState((prev) => ({ ...prev, statement: event.target.value }))
          }
          rows={3}
          placeholder="What was decided in 1-3 sentences?"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Rationale
        </span>
        <textarea
          value={formState.rationale}
          onChange={(event) =>
            setFormState((prev) => ({ ...prev, rationale: event.target.value }))
          }
          rows={4}
          placeholder="Why this decision was made and what tradeoffs were accepted."
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <MemberOwnerInput
          workspaceSlug={workspaceSlug}
          value={formState.owner}
          onChange={(owner) => setFormState((prev) => ({ ...prev, owner }))}
          disabled={isSubmitting}
          label="Owner"
          placeholder="Decision owner"
        />

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Status
          </span>
          <select
            value={formState.status}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                status: event.target.value as DecisionStatus,
              }))
            }
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="proposed">Proposed</option>
            <option value="accepted">Accepted</option>
            <option value="superseded">Superseded</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Visibility
          </span>
          <select
            value={formState.visibility}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                visibility: event.target.value as DecisionVisibility,
              }))
            }
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          >
            <option value="workspace">Workspace</option>
            <option value="team">Team</option>
            <option value="private">Private</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Team Label (if team visibility)
          </span>
          <input
            value={formState.teamLabel}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, teamLabel: event.target.value }))
            }
            placeholder="Product"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Tags
        </span>
        <input
          value={formState.tagsInput}
          onChange={(event) =>
            setFormState((prev) => ({ ...prev, tagsInput: event.target.value }))
          }
          placeholder="onboarding, sso, permissions"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Meeting ID
          </span>
          <input
            value={formState.meetingId}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, meetingId: event.target.value }))
            }
            placeholder="M-123456"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Supersedes Decision ID
          </span>
          <input
            value={formState.supersedesDecisionId}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                supersedesDecisionId: event.target.value,
              }))
            }
            placeholder="D-123456"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Superseded By Decision ID
          </span>
          <input
            value={formState.supersededByDecisionId}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                supersededByDecisionId: event.target.value,
              }))
            }
            placeholder="D-654321"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      </div>

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
          href={`/${workspaceSlug}/decisions`}
          className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
        >
          Back to decisions
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
              ? "Creating decision..."
              : "Saving decision..."
            : mode === "create"
              ? "Create decision"
              : "Save decision"}
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
