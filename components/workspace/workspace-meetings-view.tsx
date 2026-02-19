"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";

type MeetingState = "scheduled" | "inProgress" | "completed";
type DigestState = "sent" | "pending";
export type MeetingView = "all" | "mine" | "digestPending" | "locked";
export type MeetingSort = "updated" | "title";

export type WorkspaceMeetingRecord = {
  id: string;
  title: string;
  team: string;
  timeLabel: string;
  duration: string;
  attendees: number;
  decisions: number;
  actions: number;
  openQuestions: number;
  state: MeetingState;
  digest: DigestState;
  locked: boolean;
  owner: string;
  isMine: boolean;
  sortTimestamp: number;
};

type WorkspaceMeetingsViewProps = {
  workspaceSlug: string;
  workspaceName: string;
  meetings: WorkspaceMeetingRecord[];
  initialView: MeetingView;
  initialSort: MeetingSort;
};

function meetingStateStyle(state: MeetingState) {
  if (state === "scheduled") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (state === "inProgress") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function meetingStateLabel(state: MeetingState) {
  if (state === "inProgress") return "In Progress";
  return state[0].toUpperCase() + state.slice(1);
}

function digestStyle(state: DigestState) {
  if (state === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function digestLabel(state: DigestState) {
  return state === "sent" ? "Digest Sent" : "Digest Pending";
}

function queryChipClass(active: boolean) {
  return active
    ? "rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
    : "rounded-sm border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-600 transition hover:border-slate-300 hover:text-slate-800";
}

function emptyStateMessage(view: MeetingView) {
  if (view === "mine") {
    return "No meetings currently owned by you in this workspace.";
  }
  if (view === "digestPending") {
    return "No meetings with pending digests right now.";
  }
  if (view === "locked") {
    return "No locked meetings found.";
  }
  return "No meetings yet. Create a new meeting to begin capturing records.";
}

function syncQueryParams(view: MeetingView, sort: MeetingSort) {
  const url = new URL(window.location.href);

  if (view === "all") {
    url.searchParams.delete("view");
  } else if (view === "digestPending") {
    url.searchParams.set("view", "digest-pending");
  } else {
    url.searchParams.set("view", view);
  }

  if (sort === "updated") {
    url.searchParams.delete("sort");
  } else {
    url.searchParams.set("sort", "title");
  }

  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function MeetingCard({
  meeting,
  workspaceSlug,
}: {
  meeting: WorkspaceMeetingRecord;
  workspaceSlug: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{meeting.title}</p>
          <p className="mt-1 text-xs text-slate-600">
            {meeting.id} • {meeting.team} • {meeting.timeLabel} • {meeting.duration}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
          <span className={`rounded-sm border px-2 py-1 ${meetingStateStyle(meeting.state)}`}>
            {meetingStateLabel(meeting.state)}
          </span>
          <span className={`rounded-sm border px-2 py-1 ${digestStyle(meeting.digest)}`}>
            {digestLabel(meeting.digest)}
          </span>
          <span
            className={`rounded-sm border px-2 py-1 ${
              meeting.locked
                ? "border-violet-200 bg-violet-50 text-violet-700"
                : "border-slate-200 bg-slate-100 text-slate-700"
            }`}
          >
            {meeting.locked ? "Locked" : "Editable"}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-700 sm:grid-cols-4">
        <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
          Attendees {meeting.attendees}
        </span>
        <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
          Decisions {meeting.decisions}
        </span>
        <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
          Actions {meeting.actions}
        </span>
        <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
          Questions {meeting.openQuestions}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-600">Owner {meeting.owner}</p>
        <div className="flex items-center gap-2">
          <Link
            href={`/${workspaceSlug}/meetings/${meeting.id}`}
            className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Open record
          </Link>
          <button
            type="button"
            className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Send digest
          </button>
        </div>
      </div>
    </article>
  );
}

export function WorkspaceMeetingsView({
  workspaceSlug,
  workspaceName,
  meetings,
  initialView,
  initialSort,
}: WorkspaceMeetingsViewProps) {
  const [view, setView] = useState<MeetingView>(initialView);
  const [sort, setSort] = useState<MeetingSort>(initialSort);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    setSort(initialSort);
  }, [initialSort]);

  useEffect(() => {
    syncQueryParams(view, sort);
  }, [sort, view]);

  const visibleMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => {
          if (view === "mine") return meeting.isMine;
          if (view === "digestPending") return meeting.digest === "pending";
          if (view === "locked") return meeting.locked;
          return true;
        })
        .sort((a, b) => {
          if (sort === "title") {
            return a.title.localeCompare(b.title) || b.sortTimestamp - a.sortTimestamp;
          }
          return b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id);
        }),
    [meetings, sort, view],
  );

  const upcoming = useMemo(
    () => visibleMeetings.filter((meeting) => meeting.state !== "completed"),
    [visibleMeetings],
  );
  const recent = useMemo(
    () => visibleMeetings.filter((meeting) => meeting.state === "completed"),
    [visibleMeetings],
  );
  const digestPending = useMemo(
    () => meetings.filter((meeting) => meeting.digest === "pending").length,
    [meetings],
  );
  const mineCount = useMemo(
    () => meetings.filter((meeting) => meeting.isMine).length,
    [meetings],
  );
  const lockedCount = useMemo(
    () => meetings.filter((meeting) => meeting.locked).length,
    [meetings],
  );
  const hasCustomFilters = view !== "all" || sort !== "updated";

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Meetings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Capture decisions, actions, open questions, and digest status for every meeting.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${workspaceSlug}/meetings/new`}
              className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
            >
              New meeting
            </Link>
            <button
              type="button"
              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Import calendar (soon)
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryTile
            label="Upcoming / Live"
            value={String(meetings.filter((meeting) => meeting.state !== "completed").length)}
            detail="Scheduled and in-progress"
          />
          <SummaryTile
            label="Completed"
            value={String(meetings.filter((meeting) => meeting.state === "completed").length)}
            detail="Past meetings with records"
          />
          <SummaryTile label="Digest Pending" value={String(digestPending)} detail="Needs send or finalize" />
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={queryChipClass(view === "all")} onClick={() => setView("all")}>
              All Meetings {meetings.length}
            </button>
            <button type="button" className={queryChipClass(view === "mine")} onClick={() => setView("mine")}>
              My Meetings {mineCount}
            </button>
            <button
              type="button"
              className={queryChipClass(view === "digestPending")}
              onClick={() => setView("digestPending")}
            >
              Digest Pending {digestPending}
            </button>
            <button type="button" className={queryChipClass(view === "locked")} onClick={() => setView("locked")}>
              Locked {lockedCount}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-[0.08em] text-slate-500">SORT</span>
            <button
              type="button"
              className={queryChipClass(sort === "updated")}
              onClick={() => setSort("updated")}
            >
              Latest
            </button>
            <button type="button" className={queryChipClass(sort === "title")} onClick={() => setSort("title")}>
              Title A-Z
            </button>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {view === "all" ? "Meeting Records" : "Filtered Meeting Records"}
          </h2>
          <span className="text-sm text-slate-600">{visibleMeetings.length} meetings</span>
        </div>

        {visibleMeetings.length === 0 ? (
          <div className="space-y-3">
            <p className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {emptyStateMessage(view)}
            </p>
            {hasCustomFilters ? (
              <button
                type="button"
                onClick={() => {
                  setView("all");
                  setSort("updated");
                }}
                className="inline-flex rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                  Upcoming and In Progress
                </h3>
                <span className="text-sm text-slate-600">{upcoming.length} meetings</span>
              </div>
              <div className="space-y-3">
                {upcoming.map((meeting) => (
                  <MeetingCard
                    key={`upcoming-${meeting.id}`}
                    meeting={meeting}
                    workspaceSlug={workspaceSlug}
                  />
                ))}
                {upcoming.length === 0 ? (
                  <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    No upcoming or in-progress meetings match this filter.
                  </p>
                ) : null}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                  Completed Meeting Records
                </h3>
                <span className="text-sm text-slate-600">{recent.length} meetings</span>
              </div>
              <div className="space-y-3">
                {recent.map((meeting) => (
                  <MeetingCard
                    key={`recent-${meeting.id}`}
                    meeting={meeting}
                    workspaceSlug={workspaceSlug}
                  />
                ))}
                {recent.length === 0 ? (
                  <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                    No completed meetings match this filter.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        )}
      </WorkspacePanel>
    </main>
  );
}
