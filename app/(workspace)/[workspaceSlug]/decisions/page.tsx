import Link from "next/link";
import { ArchiveRestoreButton } from "@/components/workspace/archive-restore-button";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceDecisionsPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    view?: string | string[];
  }>;
}>;

type DecisionStatus = "proposed" | "accepted" | "superseded" | "rejected";
type DecisionVisibility = "workspace" | "team" | "private";
type DecisionView = "active" | "archived" | "all";

type DecisionRecord = {
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
  return null;
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function parseDecisionStatus(value: unknown): DecisionStatus {
  const status = normalizeText(value);
  if (
    status === "proposed" ||
    status === "accepted" ||
    status === "superseded" ||
    status === "rejected"
  ) {
    return status;
  }
  return "proposed";
}

function parseDecisionVisibility(value: unknown): DecisionVisibility {
  const visibility = normalizeText(value);
  if (visibility === "workspace" || visibility === "team" || visibility === "private") {
    return visibility;
  }
  return "workspace";
}

function parseDecisionView(value: string | string[] | undefined): DecisionView {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate);

  if (normalized === "archived" || normalized === "all") {
    return normalized;
  }

  return "active";
}

function viewHref(workspaceSlug: string, view: DecisionView) {
  if (view === "active") {
    return `/${workspaceSlug}/decisions`;
  }

  return `/${workspaceSlug}/decisions?view=${view}`;
}

function viewChipClass(active: boolean) {
  return active
    ? "rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
    : "rounded-sm border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-600 transition hover:border-slate-300 hover:text-slate-800";
}

function formatUpdatedLabel(date: Date | null) {
  if (!date) return "Updated recently";
  return `Updated ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function statusStyle(status: DecisionStatus) {
  if (status === "accepted") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (status === "proposed") return "border-slate-200 bg-slate-100 text-slate-700";
  if (status === "superseded") return "border-violet-200 bg-violet-50 text-violet-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function visibilityStyle(visibility: DecisionVisibility) {
  if (visibility === "workspace") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (visibility === "team") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function statusLabel(status: DecisionStatus) {
  return status[0].toUpperCase() + status.slice(1);
}

function visibilityLabel(decision: DecisionRecord) {
  if (decision.visibility === "team" && decision.teamLabel) {
    return `Team: ${decision.teamLabel}`;
  }

  return decision.visibility[0].toUpperCase() + decision.visibility.slice(1);
}

export default async function WorkspaceDecisionsPage({
  params,
  searchParams,
}: WorkspaceDecisionsPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const view = parseDecisionView(resolvedSearchParams.view);

  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";

  const workspaceRef = adminDb.collection("workspaces").doc(access.workspaceId);
  const decisionsRef = workspaceRef.collection("decisions");

  let topLevelDecisionSnapshots;
  try {
    topLevelDecisionSnapshots = await decisionsRef.orderBy("updatedAt", "desc").limit(240).get();
  } catch {
    topLevelDecisionSnapshots = await decisionsRef.limit(240).get();
  }

  const decisions = topLevelDecisionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);
      const visibility = parseDecisionVisibility(data.visibility);
      const allowedTeamIds = parseStringArray(data.allowedTeamIds);

      return {
        id: snapshot.id,
        title: normalizeText(data.title) || `Decision ${snapshot.id}`,
        statement:
          normalizeText(data.statement) ||
          normalizeText(data.rationale) ||
          "Decision statement pending.",
        owner: normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned",
        status: parseDecisionStatus(data.status),
        visibility,
        teamLabel:
          visibility === "team"
            ? normalizeText(data.teamLabel) || allowedTeamIds[0] || undefined
            : undefined,
        tags: parseStringArray(data.tags),
        updatedLabel: formatUpdatedLabel(updatedAt),
        meetingId: normalizeText(data.meetingId) || undefined,
        supersedesDecisionId: normalizeText(data.supersedesDecisionId) || undefined,
        supersededByDecisionId: normalizeText(data.supersededByDecisionId) || undefined,
        sortTimestamp: updatedAt?.getTime() ?? 0,
        archived: data.archived === true,
      } as DecisionRecord;
    })
    .sort((a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id));

  const activeDecisions = decisions.filter((decision) => !decision.archived);
  const archivedDecisions = decisions.filter((decision) => decision.archived);

  const visibleDecisions =
    view === "archived"
      ? archivedDecisions
      : view === "all"
        ? decisions
        : activeDecisions;

  const acceptedCount = activeDecisions.filter((item) => item.status === "accepted").length;
  const proposedCount = activeDecisions.filter((item) => item.status === "proposed").length;
  const supersededCount = activeDecisions.filter((item) => item.status === "superseded").length;

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
              href={`/${workspaceSlugForNav}/decisions/new`}
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
          <SummaryTile label="Accepted" value={String(acceptedCount)} detail="Active decisions in force" />
          <SummaryTile label="Proposed" value={String(proposedCount)} detail="Awaiting final decision" />
          <SummaryTile label="Superseded" value={String(supersededCount)} detail="Historical decision trail" />
          <SummaryTile label="Archived" value={String(archivedDecisions.length)} detail="Hidden from default views" />
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

      <WorkspacePanel>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {view === "archived" ? "Archived Decisions" : view === "all" ? "All Decisions" : "Decision Records"}
          </h2>
          <span className="text-sm text-slate-600">{visibleDecisions.length} total</span>
        </div>

        <div className="space-y-3">
          {visibleDecisions.map((decision) => (
            <article
              key={decision.id}
              className="rounded-lg border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{decision.title}</p>
                  <p className="mt-1 text-sm text-slate-700">{decision.statement}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                  <span className={`rounded-sm border px-2 py-1 ${statusStyle(decision.status)}`}>
                    {statusLabel(decision.status)}
                  </span>
                  <span className={`rounded-sm border px-2 py-1 ${visibilityStyle(decision.visibility)}`}>
                    {visibilityLabel(decision)}
                  </span>
                  {decision.archived ? (
                    <span className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                      Archived
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  {decision.id}
                </span>
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  Owner {decision.owner}
                </span>
                {decision.meetingId ? (
                  <Link
                    href={`/${workspaceSlugForNav}/meetings/${decision.meetingId}`}
                    className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 transition hover:border-slate-400"
                  >
                    Meeting {decision.meetingId}
                  </Link>
                ) : null}
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  {decision.updatedLabel}
                </span>
                {decision.supersedesDecisionId ? (
                  <span className="rounded-sm border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700">
                    Supersedes {decision.supersedesDecisionId}
                  </span>
                ) : null}
                {decision.supersededByDecisionId ? (
                  <span className="rounded-sm border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700">
                    Superseded by {decision.supersededByDecisionId}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {decision.tags.map((tag) => (
                  <span
                    key={`${decision.id}-${tag}`}
                    className="rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Link
                  href={`/${workspaceSlugForNav}/decisions/${decision.id}`}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                >
                  Open decision
                </Link>
                {decision.archived ? (
                  <ArchiveRestoreButton
                    workspaceSlug={workspaceSlugForNav}
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
