"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArchiveRestoreButton } from "@/components/workspace/archive-restore-button";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";

type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";
type DecisionVisibility = "workspace" | "team" | "private";
export type DecisionView = "active" | "archived" | "all";

export type WorkspaceDecisionRecord = {
  id: string;
  title: string;
  statement: string;
  owner: string;
  status: DecisionStatus;
  visibility: DecisionVisibility;
  teamLabel?: string;
  tags: string[];
  updatedLabel: string;
  meetingId?: string;
  supersedesDecisionId?: string;
  supersededByDecisionId?: string;
  sortTimestamp: number;
  archived: boolean;
};

type WorkspaceDecisionsViewProps = {
  workspaceSlug: string;
  workspaceName: string;
  decisions: WorkspaceDecisionRecord[];
  initialView: DecisionView;
};

function viewChipClass(active: boolean) {
  return active
    ? "rounded-sm border border-[color:var(--accent-soft)] bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-[color:var(--accent-strong)] shadow-sm"
    : "rounded-sm border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-400 hover:bg-white hover:text-slate-900";
}

function statusStyle(status: DecisionStatus) {
  if (status === "accepted") return "border-sky-300 bg-white text-sky-700";
  if (status === "proposed") return "border-slate-300 bg-white text-slate-700";
  if (status === "superseded") return "border-violet-300 bg-white text-violet-700";
  return "border-rose-300 bg-white text-rose-700";
}

function visibilityStyle(visibility: DecisionVisibility) {
  if (visibility === "workspace") return "border-emerald-300 bg-white text-emerald-700";
  if (visibility === "team") return "border-amber-300 bg-white text-amber-700";
  return "border-slate-300 bg-white text-slate-700";
}

function decisionAccentStyle(status: DecisionStatus) {
  if (status === "accepted") return "border-l-sky-400";
  if (status === "proposed") return "border-l-slate-400";
  if (status === "superseded") return "border-l-violet-400";
  return "border-l-rose-400";
}

function statusLabel(status: DecisionStatus) {
  return status[0].toUpperCase() + status.slice(1);
}

function visibilityLabel(decision: WorkspaceDecisionRecord) {
  if (decision.visibility === "team" && decision.teamLabel) {
    return `Team: ${decision.teamLabel}`;
  }

  return decision.visibility[0].toUpperCase() + decision.visibility.slice(1);
}

function syncViewQueryParam(view: DecisionView) {
  const url = new URL(window.location.href);
  if (view === "active") {
    url.searchParams.delete("view");
  } else {
    url.searchParams.set("view", view);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function WorkspaceDecisionsView({
  workspaceSlug,
  workspaceName,
  decisions,
  initialView,
}: WorkspaceDecisionsViewProps) {
  const [view, setView] = useState<DecisionView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    syncViewQueryParam(view);
  }, [view]);

  const activeDecisions = useMemo(
    () => decisions.filter((decision) => !decision.archived),
    [decisions],
  );
  const archivedDecisions = useMemo(
    () => decisions.filter((decision) => decision.archived),
    [decisions],
  );

  const visibleDecisions = useMemo(() => {
    if (view === "archived") return archivedDecisions;
    if (view === "all") return decisions;
    return activeDecisions;
  }, [activeDecisions, archivedDecisions, decisions, view]);

  const acceptedCount = useMemo(
    () => activeDecisions.filter((item) => item.status === "accepted").length,
    [activeDecisions],
  );
  const proposedCount = useMemo(
    () => activeDecisions.filter((item) => item.status === "proposed").length,
    [activeDecisions],
  );
  const supersededCount = useMemo(
    () => activeDecisions.filter((item) => item.status === "superseded").length,
    [activeDecisions],
  );

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Decisions</h1>
            <p className="mt-2 text-sm text-slate-600">
              Durable records of what was decided, why it was decided, and what changed later.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${workspaceSlug}/decisions/new`}
              className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
            >
              New decision
            </Link>
            <button
              type="button"
              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Export (soon)
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <SummaryTile
            label="Accepted"
            value={String(acceptedCount)}
            detail="Active decisions in force"
            className="border-slate-300 border-l-4 border-l-sky-400"
          />
          <SummaryTile
            label="Proposed"
            value={String(proposedCount)}
            detail="Awaiting final decision"
            className="border-slate-300 border-l-4 border-l-slate-400"
          />
          <SummaryTile
            label="Superseded"
            value={String(supersededCount)}
            detail="Historical decision trail"
            className="border-slate-300 border-l-4 border-l-violet-400"
          />
          <SummaryTile
            label="Archived"
            value={String(archivedDecisions.length)}
            detail="Hidden from default views"
            className="border-slate-300 border-l-4 border-l-amber-400"
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

      <WorkspacePanel>
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
            <span
              className={`h-2 w-2 rounded-full ${
                view === "archived" ? "bg-amber-500" : view === "all" ? "bg-slate-500" : "bg-sky-500"
              }`}
              aria-hidden
            />
            {view === "archived" ? "Archived Decisions" : view === "all" ? "All Decisions" : "Decision Records"}
          </h2>
          <span className="text-sm font-medium text-slate-700">{visibleDecisions.length} total</span>
        </div>

        <div className="space-y-3">
          {visibleDecisions.map((decision) => (
            <article
              key={decision.id}
              className={`rounded-lg border border-slate-300 border-l-4 bg-white px-4 py-4 shadow-sm transition hover:border-slate-400 ${decisionAccentStyle(decision.status)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{decision.title}</p>
                  <p className="mt-1 text-sm text-slate-800">{decision.statement}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                  <span className={`rounded-sm border px-2 py-1 ${statusStyle(decision.status)}`}>
                    {statusLabel(decision.status)}
                  </span>
                  <span className={`rounded-sm border px-2 py-1 ${visibilityStyle(decision.visibility)}`}>
                    {visibilityLabel(decision)}
                  </span>
                  {decision.archived ? (
                    <span className="rounded-sm border border-amber-300 bg-white px-2 py-1 text-amber-700">
                      Archived
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-800">
                <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">
                  {decision.id}
                </span>
                <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">
                  Owner {decision.owner}
                </span>
                {decision.meetingId ? (
                  <Link
                    href={`/${workspaceSlug}/meetings/${decision.meetingId}`}
                    className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700 transition hover:border-slate-500 hover:bg-white hover:text-slate-900"
                  >
                    Meeting {decision.meetingId}
                  </Link>
                ) : null}
                <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700">
                  {decision.updatedLabel}
                </span>
                {decision.supersedesDecisionId ? (
                  <span className="rounded-sm border border-violet-300 bg-white px-2 py-1 text-violet-700">
                    Supersedes {decision.supersedesDecisionId}
                  </span>
                ) : null}
                {decision.supersededByDecisionId ? (
                  <span className="rounded-sm border border-violet-300 bg-white px-2 py-1 text-violet-700">
                    Superseded by {decision.supersededByDecisionId}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {decision.tags.map((tag) => (
                  <span
                    key={`${decision.id}-${tag}`}
                    className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Link
                  href={`/${workspaceSlug}/decisions/${decision.id}`}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                >
                  Open decision
                </Link>
                {decision.archived ? (
                  <ArchiveRestoreButton
                    workspaceSlug={workspaceSlug}
                    entity="decisions"
                    entityId={decision.id}
                  />
                ) : null}
              </div>
            </article>
          ))}
          {visibleDecisions.length === 0 ? (
            <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              {view === "archived"
                ? "No archived decisions yet."
                : "No canonical decisions found yet. Create a decision or save a meeting record to sync one."}
            </p>
          ) : null}
        </div>
      </WorkspacePanel>
    </main>
  );
}
