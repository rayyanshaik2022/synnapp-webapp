import Link from "next/link";
import { ArchiveRestoreButton } from "@/components/workspace/archive-restore-button";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceActionsPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    view?: string | string[];
  }>;
}>;

type ActionStatus = "open" | "done" | "blocked";
type ActionPriority = "high" | "medium" | "low";
type ActionView = "active" | "archived" | "all";

type ActionRecord = {
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

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
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

function parseActionStatus(value: unknown): ActionStatus {
  const status = normalizeText(value);
  if (status === "open" || status === "done" || status === "blocked") {
    return status;
  }
  return "open";
}

function parseActionPriority(value: unknown): ActionPriority {
  const priority = normalizeText(value);
  if (priority === "high" || priority === "medium" || priority === "low") {
    return priority;
  }
  return "medium";
}

function parseActionView(value: string | string[] | undefined): ActionView {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate);

  if (normalized === "archived" || normalized === "all") {
    return normalized;
  }

  return "active";
}

function viewHref(workspaceSlug: string, view: ActionView) {
  if (view === "active") {
    return `/${workspaceSlug}/actions`;
  }

  return `/${workspaceSlug}/actions?view=${view}`;
}

function viewChipClass(active: boolean) {
  return active
    ? "rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
    : "rounded-sm border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-600 transition hover:border-slate-300 hover:text-slate-800";
}

function formatDueLabelFromDate(value: Date) {
  const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;
  if (hasTime) {
    return value.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function isDueSoonLabel(value: string) {
  const normalized = value.toLowerCase();
  return normalized.includes("today") || normalized.includes("tomorrow");
}

function isDueSoonDate(value: Date) {
  const now = Date.now();
  const diff = value.getTime() - now;
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return diff >= 0 && diff <= twoDaysMs;
}

function formatUpdatedLabel(date: Date | null, status: ActionStatus) {
  const prefix = status === "done" ? "Completed" : "Updated";
  if (!date) return `${prefix} recently`;

  return `${prefix} ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function statusStyle(status: ActionStatus) {
  if (status === "open") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function priorityStyle(priority: ActionPriority) {
  if (priority === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (priority === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function titleCase(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

function ActionCard({
  action,
  workspaceSlug,
  showRestore,
}: {
  action: ActionRecord;
  workspaceSlug: string;
  showRestore: boolean;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{action.title}</p>
          <p className="mt-1 text-xs text-slate-600">
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
            <span className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
              Archived
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
        <span
          className={`rounded-sm border px-2 py-1 ${
            action.dueSoon
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-slate-100 text-slate-700"
          }`}
        >
          Due {action.dueLabel}
        </span>
        <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
          {action.updatedLabel}
        </span>
        {action.meetingId ? (
          <Link
            href={`/${workspaceSlug}/meetings/${action.meetingId}`}
            className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 transition hover:border-slate-400"
          >
            Meeting {action.meetingId}
          </Link>
        ) : null}
        {action.decisionId ? (
          <Link
            href={`/${workspaceSlug}/decisions/${action.decisionId}`}
            className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 transition hover:border-slate-400"
          >
            Decision {action.decisionId}
          </Link>
        ) : null}
      </div>

      {action.blockedReason ? (
        <p className="mt-3 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
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

export default async function WorkspaceActionsPage({ params, searchParams }: WorkspaceActionsPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const view = parseActionView(resolvedSearchParams.view);

  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";

  const workspaceRef = adminDb.collection("workspaces").doc(access.workspaceId);
  const actionsRef = workspaceRef.collection("actions");

  let topLevelActionSnapshots;
  try {
    topLevelActionSnapshots = await actionsRef.orderBy("updatedAt", "desc").limit(240).get();
  } catch {
    topLevelActionSnapshots = await actionsRef.limit(240).get();
  }

  const actions = topLevelActionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      const status = parseActionStatus(data.status);
      const dueAt = parseDate(data.dueAt);
      const updatedAt =
        parseDate(data.updatedAt) ?? parseDate(data.completedAt) ?? parseDate(data.createdAt);
      const dueLabel =
        normalizeText(data.dueLabel) || (dueAt ? formatDueLabelFromDate(dueAt) : "No due date");
      const dueSoonFlag = data.dueSoon === true;

      return {
        id: snapshot.id,
        title: normalizeText(data.title) || normalizeText(data.description) || `Action ${snapshot.id}`,
        owner:
          normalizeText(data.owner) ||
          normalizeText(data.ownerName) ||
          normalizeText(data.ownerUid) ||
          "Unassigned",
        project:
          normalizeText(data.project) ||
          normalizeText(data.teamLabel) ||
          normalizeText(data.team) ||
          "Workspace",
        dueLabel,
        dueSoon:
          status === "open" &&
          (dueSoonFlag || (dueAt ? isDueSoonDate(dueAt) : isDueSoonLabel(dueLabel))),
        status,
        priority: parseActionPriority(data.priority),
        updatedLabel: formatUpdatedLabel(updatedAt, status),
        meetingId: normalizeText(data.meetingId) || undefined,
        decisionId: normalizeText(data.decisionId) || undefined,
        blockedReason:
          status === "blocked" ? normalizeText(data.blockedReason) || undefined : undefined,
        sortTimestamp: updatedAt?.getTime() ?? dueAt?.getTime() ?? 0,
        archived: data.archived === true,
      } as ActionRecord;
    })
    .sort((a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id));

  const activeActions = actions.filter((action) => !action.archived);
  const archivedActions = actions.filter((action) => action.archived);

  const openCount = activeActions.filter((item) => item.status === "open").length;
  const doneCount = activeActions.filter((item) => item.status === "done").length;
  const blockedCount = activeActions.filter((item) => item.status === "blocked").length;
  const dueSoonCount = activeActions.filter((item) => item.status === "open" && item.dueSoon).length;

  const active = activeActions.filter((item) => item.status !== "done");
  const completed = activeActions.filter((item) => item.status === "done");

  const visibleActions =
    view === "archived" ? archivedActions : view === "all" ? actions : activeActions;

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
              href={`/${workspaceSlugForNav}/actions/new`}
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
          <SummaryTile label="Open" value={String(openCount)} detail="Needs progress" />
          <SummaryTile label="Due Soon" value={String(dueSoonCount)} detail="Attention this week" />
          <SummaryTile label="Blocked" value={String(blockedCount)} detail="Dependency blocked" />
          <SummaryTile label="Done" value={String(doneCount)} detail="Recently completed" />
          <SummaryTile label="Archived" value={String(archivedActions.length)} detail="Hidden from default views" />
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={viewHref(workspaceSlugForNav, "active")} className={viewChipClass(view === "active")}>
            Active
          </Link>
          <Link href={viewHref(workspaceSlugForNav, "archived")} className={viewChipClass(view === "archived")}>
            Archived
          </Link>
          <Link href={viewHref(workspaceSlugForNav, "all")} className={viewChipClass(view === "all")}>
            All
          </Link>
        </div>
      </WorkspacePanel>

      {view === "active" ? (
        <>
          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">Active Actions</h2>
              <span className="text-sm text-slate-600">{active.length} actions</span>
            </div>

            <div className="space-y-3">
              {active.map((action) => (
                <ActionCard key={action.id} action={action} workspaceSlug={workspaceSlugForNav} showRestore={false} />
              ))}
              {active.length === 0 ? (
                <p className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  No active canonical actions yet. Create an action or save a meeting record to sync one.
                </p>
              ) : null}
            </div>
          </WorkspacePanel>

          <WorkspacePanel>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">Recently Completed</h2>
              <span className="text-sm text-slate-600">{completed.length} actions</span>
            </div>

            <div className="space-y-3">
              {completed.map((action) => (
                <ActionCard key={action.id} action={action} workspaceSlug={workspaceSlugForNav} showRestore={false} />
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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              {view === "archived" ? "Archived Actions" : "All Actions"}
            </h2>
            <span className="text-sm text-slate-600">{visibleActions.length} actions</span>
          </div>

          <div className="space-y-3">
            {visibleActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                workspaceSlug={workspaceSlugForNav}
                showRestore={view !== "active"}
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
