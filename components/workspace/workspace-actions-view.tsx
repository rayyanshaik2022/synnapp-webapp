"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArchiveRestoreButton } from "@/components/workspace/archive-restore-button";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";

type ActionStatus = "open" | "done" | "blocked";
type ActionPriority = "high" | "medium" | "low";
export type ActionView = "active" | "archived" | "all";

export type WorkspaceActionRecord = {
  id: string;
  title: string;
  owner: string;
  project: string;
  dueLabel: string;
  dueSoon: boolean;
  status: ActionStatus;
  priority: ActionPriority;
  updatedLabel: string;
  meetingId?: string;
  decisionId?: string;
  blockedReason?: string;
  sortTimestamp: number;
  archived: boolean;
};

type WorkspaceActionsViewProps = {
  workspaceSlug: string;
  workspaceName: string;
  actions: WorkspaceActionRecord[];
  initialView: ActionView;
};

function viewChipClass(active: boolean) {
  return active
    ? "rounded-sm border border-[color:var(--accent-soft)] bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-[color:var(--accent-strong)] shadow-sm"
    : "rounded-sm border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-400 hover:bg-white hover:text-slate-900";
}

function statusStyle(status: ActionStatus) {
  if (status === "open") return "border-sky-300 bg-white text-sky-700";
  if (status === "blocked") return "border-rose-300 bg-white text-rose-700";
  return "border-emerald-300 bg-white text-emerald-700";
}

function priorityStyle(priority: ActionPriority) {
  if (priority === "high") return "border-rose-300 bg-white text-rose-700";
  if (priority === "medium") return "border-amber-300 bg-white text-amber-700";
  return "border-slate-300 bg-white text-slate-700";
}

function cardAccentStyle(status: ActionStatus) {
  if (status === "open") return "border-l-sky-400";
  if (status === "blocked") return "border-l-rose-400";
  return "border-l-emerald-400";
}

function titleCase(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

function syncViewQueryParam(view: ActionView) {
  const url = new URL(window.location.href);
  if (view === "active") {
    url.searchParams.delete("view");
  } else {
    url.searchParams.set("view", view);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function ActionCard({
  action,
  workspaceSlug,
  showRestore,
}: {
  action: WorkspaceActionRecord;
  workspaceSlug: string;
  showRestore: boolean;
}) {
  return (
    <article
      className={`rounded-lg border border-slate-300 border-l-4 bg-white px-4 py-4 shadow-sm transition hover:border-slate-400 ${cardAccentStyle(action.status)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{action.title}</p>
          <p className="mt-1 text-xs text-slate-700">
            {action.id} • Owner {action.owner} • {action.project}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
          <span className={`rounded-sm border px-2 py-1 ${statusStyle(action.status)}`}>
            {titleCase(action.status)}
          </span>
          <span className={`rounded-sm border px-2 py-1 ${priorityStyle(action.priority)}`}>
            Priority {titleCase(action.priority)}
          </span>
          {action.archived ? (
            <span className="rounded-sm border border-amber-300 bg-white px-2 py-1 text-amber-700">
              Archived
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-800">
        <span
          className={`rounded-sm border px-2 py-1 ${
            action.dueSoon
              ? "border-amber-300 bg-white text-amber-700"
              : "border-slate-300 bg-slate-50 text-slate-700"
          }`}
        >
          Due {action.dueLabel}
        </span>
        <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">
          {action.updatedLabel}
        </span>
        {action.meetingId ? (
          <Link
            href={`/${workspaceSlug}/meetings/${action.meetingId}`}
            className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700 transition hover:border-slate-500 hover:bg-white hover:text-slate-900"
          >
            Meeting {action.meetingId}
          </Link>
        ) : null}
        {action.decisionId ? (
          <Link
            href={`/${workspaceSlug}/decisions/${action.decisionId}`}
            className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700 transition hover:border-slate-500 hover:bg-white hover:text-slate-900"
          >
            Decision {action.decisionId}
          </Link>
        ) : null}
      </div>

      {action.blockedReason ? (
        <p className="mt-3 rounded-sm border border-rose-300 bg-white px-3 py-2 text-sm text-rose-700">
          Blocked: {action.blockedReason}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Link
          href={`/${workspaceSlug}/actions/${action.id}`}
          className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
        >
          Open action
        </Link>
        {showRestore && action.archived ? (
          <ArchiveRestoreButton workspaceSlug={workspaceSlug} entity="actions" entityId={action.id} />
        ) : null}
      </div>
    </article>
  );
}

export function WorkspaceActionsView({
  workspaceSlug,
  workspaceName,
  actions,
  initialView,
}: WorkspaceActionsViewProps) {
  const [view, setView] = useState<ActionView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    syncViewQueryParam(view);
  }, [view]);

  const activeActions = useMemo(
    () => actions.filter((action) => !action.archived),
    [actions],
  );
  const archivedActions = useMemo(
    () => actions.filter((action) => action.archived),
    [actions],
  );

  const openCount = useMemo(
    () => activeActions.filter((item) => item.status === "open").length,
    [activeActions],
  );
  const doneCount = useMemo(
    () => activeActions.filter((item) => item.status === "done").length,
    [activeActions],
  );
  const blockedCount = useMemo(
    () => activeActions.filter((item) => item.status === "blocked").length,
    [activeActions],
  );
  const dueSoonCount = useMemo(
    () => activeActions.filter((item) => item.status === "open" && item.dueSoon).length,
    [activeActions],
  );

  const active = useMemo(
    () => activeActions.filter((item) => item.status !== "done"),
    [activeActions],
  );
  const completed = useMemo(
    () => activeActions.filter((item) => item.status === "done"),
    [activeActions],
  );

  const visibleActions = useMemo(() => {
    if (view === "archived") return archivedActions;
    if (view === "all") return actions;
    return activeActions;
  }, [actions, activeActions, archivedActions, view]);

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Actions</h1>
            <p className="mt-2 text-sm text-slate-600">
              Track follow-up work from meetings and decisions with clear ownership and status.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${workspaceSlug}/actions/new`}
              className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
            >
              New action
            </Link>
            <button
              type="button"
              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Bulk update (soon)
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-5">
          <SummaryTile
            label="Open"
            value={String(openCount)}
            detail="Needs progress"
            className="border-slate-300 border-l-4 border-l-sky-400"
          />
          <SummaryTile
            label="Due Soon"
            value={String(dueSoonCount)}
            detail="Attention this week"
            className="border-slate-300 border-l-4 border-l-amber-400"
          />
          <SummaryTile
            label="Blocked"
            value={String(blockedCount)}
            detail="Dependency blocked"
            className="border-slate-300 border-l-4 border-l-rose-400"
          />
          <SummaryTile
            label="Done"
            value={String(doneCount)}
            detail="Recently completed"
            className="border-slate-300 border-l-4 border-l-emerald-400"
          />
          <SummaryTile
            label="Archived"
            value={String(archivedActions.length)}
            detail="Hidden from default views"
            className="border-slate-300 border-l-4 border-l-slate-400"
          />
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={viewChipClass(view === "active")} onClick={() => setView("active")}>
            Active
          </button>
          <button
            type="button"
            className={viewChipClass(view === "archived")}
            onClick={() => setView("archived")}
          >
            Archived
          </button>
          <button type="button" className={viewChipClass(view === "all")} onClick={() => setView("all")}>
            All
          </button>
        </div>
      </WorkspacePanel>

      {view === "active" ? (
        <>
          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
                <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden />
                Active Actions
              </h2>
              <span className="text-sm font-medium text-slate-700">{active.length} actions</span>
            </div>

            <div className="space-y-3">
              {active.map((action) => (
                <ActionCard key={action.id} action={action} workspaceSlug={workspaceSlug} showRestore={false} />
              ))}
              {active.length === 0 ? (
                <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  No active canonical actions yet. Create an action or save a meeting record to sync one.
                </p>
              ) : null}
            </div>
          </WorkspacePanel>

          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                Recently Completed
              </h2>
              <span className="text-sm font-medium text-slate-700">{completed.length} actions</span>
            </div>

            <div className="space-y-3">
              {completed.map((action) => (
                <ActionCard key={action.id} action={action} workspaceSlug={workspaceSlug} showRestore={false} />
              ))}
              {completed.length === 0 ? (
                <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  Completed actions will appear once work is marked done.
                </p>
              ) : null}
            </div>
          </WorkspacePanel>
        </>
      ) : (
        <WorkspacePanel>
          <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <span className="h-2 w-2 rounded-full bg-slate-500" aria-hidden />
              {view === "archived" ? "Archived Actions" : "All Actions"}
            </h2>
            <span className="text-sm font-medium text-slate-700">{visibleActions.length} actions</span>
          </div>

          <div className="space-y-3">
            {visibleActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                workspaceSlug={workspaceSlug}
                showRestore={action.archived}
              />
            ))}
            {visibleActions.length === 0 ? (
              <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                {view === "archived"
                  ? "No archived actions yet."
                  : "No canonical actions found yet."}
              </p>
            ) : null}
          </div>
        </WorkspacePanel>
      )}
    </main>
  );
}
