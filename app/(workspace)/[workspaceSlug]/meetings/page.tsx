import Link from "next/link";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceMeetingsPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    view?: string | string[];
    sort?: string | string[];
  }>;
}>;

type MeetingState = "scheduled" | "inProgress" | "completed";
type DigestState = "sent" | "pending";
type MeetingView = "all" | "mine" | "digestPending" | "locked";
type MeetingSort = "updated" | "title";

type MeetingRecord = {
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

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

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

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): Date | null {
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

function parseCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function parseMeetingState(value: unknown): MeetingState {
  const state = normalizeText(value);
  if (state === "scheduled" || state === "inProgress" || state === "completed") {
    return state;
  }
  return "scheduled";
}

function parseDigestState(value: unknown): DigestState {
  const state = normalizeText(value);
  if (state === "sent" || state === "pending") {
    return state;
  }
  return "pending";
}

function parseMeetingView(value: string | string[] | undefined): MeetingView {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();

  if (normalized === "mine" || normalized === "my") return "mine";
  if (normalized === "digest-pending" || normalized === "digestpending") {
    return "digestPending";
  }
  if (normalized === "locked") return "locked";
  return "all";
}

function parseMeetingSort(value: string | string[] | undefined): MeetingSort {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();
  if (normalized === "title") return "title";
  return "updated";
}

function meetingsHref(workspaceSlug: string, view: MeetingView, sort: MeetingSort) {
  const query = new URLSearchParams();
  if (view === "mine") query.set("view", "mine");
  if (view === "digestPending") query.set("view", "digest-pending");
  if (view === "locked") query.set("view", "locked");
  if (sort !== "updated") query.set("sort", sort);
  const serialized = query.toString();
  return serialized
    ? `/${workspaceSlug}/meetings?${serialized}`
    : `/${workspaceSlug}/meetings`;
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

function parseMeetingRecord(
  id: string,
  value: unknown,
  uid: string,
  displayName: string,
  email: string,
): MeetingRecord | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const ownerLabel = normalizeText(data.owner) || "Workspace User";
  const ownerUid = normalizeText(data.ownerUid) || normalizeText(data.createdBy);
  const ownerLabelNormalized = ownerLabel.toLowerCase();
  const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);
  const isMine =
    ownerUid === uid ||
    (ownerLabelNormalized !== "" &&
      (ownerLabelNormalized === displayName || ownerLabelNormalized === email));

  return {
    id,
    title: normalizeText(data.title) || `Meeting ${id}`,
    team: normalizeText(data.team) || "Workspace",
    timeLabel: normalizeText(data.timeLabel) || "Date TBD",
    duration: normalizeText(data.duration) || "45 min",
    attendees: parseCount(data.attendees),
    decisions: parseCount(data.decisions),
    actions: parseCount(data.actions),
    openQuestions: parseCount(data.openQuestions),
    state: parseMeetingState(data.state),
    digest: parseDigestState(data.digest),
    locked: data.locked === true,
    owner: ownerLabel,
    isMine,
    sortTimestamp: updatedAt?.getTime() ?? 0,
  };
}

export default async function WorkspaceMeetingsPage({
  params,
  searchParams,
}: WorkspaceMeetingsPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const view = parseMeetingView(resolvedSearchParams.view);
  const sort = parseMeetingSort(resolvedSearchParams.sort);

  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";
  const userDisplayName = normalizeText(access.user.displayName).toLowerCase();
  const userEmail = normalizeText(access.user.email).toLowerCase();
  const meetingSnapshots = await adminDb
    .collection("workspaces")
    .doc(access.workspaceId)
    .collection("meetings")
    .orderBy("updatedAt", "desc")
    .limit(120)
    .get();

  const meetings = meetingSnapshots.docs
    .map((snapshot) =>
      parseMeetingRecord(
        snapshot.id,
        snapshot.data(),
        access.uid,
        userDisplayName,
        userEmail,
      ),
    )
    .filter((meeting): meeting is MeetingRecord => meeting !== null);

  const visibleMeetings = meetings
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
    });

  const upcoming = visibleMeetings.filter((meeting) => meeting.state !== "completed");
  const recent = visibleMeetings.filter((meeting) => meeting.state === "completed");
  const digestPending = meetings.filter((meeting) => meeting.digest === "pending").length;
  const mineCount = meetings.filter((meeting) => meeting.isMine).length;
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
              href={`/${workspaceSlugForNav}/meetings/new`}
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
            <Link
              href={meetingsHref(workspaceSlugForNav, "all", sort)}
              className={queryChipClass(view === "all")}
            >
              All Meetings {meetings.length}
            </Link>
            <Link
              href={meetingsHref(workspaceSlugForNav, "mine", sort)}
              className={queryChipClass(view === "mine")}
            >
              My Meetings {mineCount}
            </Link>
            <Link
              href={meetingsHref(workspaceSlugForNav, "digestPending", sort)}
              className={queryChipClass(view === "digestPending")}
            >
              Digest Pending {digestPending}
            </Link>
            <Link
              href={meetingsHref(workspaceSlugForNav, "locked", sort)}
              className={queryChipClass(view === "locked")}
            >
              Locked {meetings.filter((meeting) => meeting.locked).length}
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-[0.08em] text-slate-500">SORT</span>
            <Link
              href={meetingsHref(workspaceSlugForNav, view, "updated")}
              className={queryChipClass(sort === "updated")}
            >
              Latest
            </Link>
            <Link
              href={meetingsHref(workspaceSlugForNav, view, "title")}
              className={queryChipClass(sort === "title")}
            >
              Title A-Z
            </Link>
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
              <Link
                href={meetingsHref(workspaceSlugForNav, "all", "updated")}
                className="inline-flex rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
              >
                Clear filters
              </Link>
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
                    workspaceSlug={workspaceSlugForNav}
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
                    workspaceSlug={workspaceSlugForNav}
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

function MeetingCard({
  meeting,
  workspaceSlug,
}: {
  meeting: MeetingRecord;
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
