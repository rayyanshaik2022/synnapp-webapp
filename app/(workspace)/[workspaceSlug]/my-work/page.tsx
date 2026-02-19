import Link from "next/link";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceMyWorkPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

type ActionPriority = "high" | "medium" | "low";
type DecisionStatus = "accepted" | "proposed" | "superseded";

type MyActionRecord = {
  id: string;
  title: string;
  project: string;
  priority: ActionPriority;
  dueLabel: string;
  dueAtEpoch: number | null;
  dueSoon: boolean;
  overdue: boolean;
  meetingId: string;
  decisionId: string;
  updatedLabel: string;
};

type MyDecisionRecord = {
  id: string;
  title: string;
  owner: string;
  status: DecisionStatus;
  updatedLabel: string;
  updatedAtEpoch: number;
};

type MyMeetingRecord = {
  id: string;
  title: string;
  team: string;
  timeLabel: string;
  decisions: number;
  actions: number;
  openQuestions: number;
  updatedLabel: string;
  updatedAtEpoch: number;
};

type MentionRecord = {
  id: string;
  entityType: "decision" | "action";
  entityId: string;
  entityTitle: string;
  entityPath: string;
  preview: string;
  mentionedByName: string;
  updatedLabel: string;
  isRead: boolean;
  updatedAtEpoch: number;
};

type MyWorkActionListProps = {
  title: string;
  eyebrow: string;
  emptyText: string;
  actions: MyActionRecord[];
  workspaceSlug: string;
  accent: "dueSoon" | "overdue";
};

const quickActions = [
  {
    title: "New Meeting",
    description: "Capture agenda, notes, and attendees.",
    href: "meetings/new",
  },
  {
    title: "New Decision",
    description: "Record rationale and expected impact.",
    href: "decisions/new",
  },
  {
    title: "New Action",
    description: "Assign ownership with due date and source.",
    href: "actions/new",
  },
];

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

function parseActionPriority(value: unknown): ActionPriority {
  const normalized = normalizeText(value);
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function parseDecisionStatus(value: unknown): DecisionStatus {
  const status = normalizeText(value);
  if (status === "accepted" || status === "proposed" || status === "superseded") {
    return status;
  }
  if (status === "rejected") {
    return "superseded";
  }
  return "proposed";
}

function titleCase(value: string) {
  if (!value) return "";
  return value[0].toUpperCase() + value.slice(1);
}

function parseEntityType(value: unknown): "decision" | "action" {
  return normalizeText(value).toLowerCase() === "action" ? "action" : "decision";
}

function formatUpdatedLabel(value: Date | null) {
  if (!value) return "Updated recently";
  return value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

function isDueSoonDate(value: Date, nowEpoch: number) {
  const diff = value.getTime() - nowEpoch;
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return diff >= 0 && diff <= twoDaysMs;
}

function toEpoch(value: Date | null) {
  return value ? value.getTime() : 0;
}

function parseListCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function priorityChipClass(priority: ActionPriority) {
  if (priority === "high") return "border-rose-300 bg-white text-rose-700";
  if (priority === "medium") return "border-amber-300 bg-white text-amber-700";
  return "border-slate-300 bg-white text-slate-700";
}

function dueChipClass(action: MyActionRecord) {
  if (action.overdue) return "border-rose-300 bg-white text-rose-700";
  if (action.dueSoon) return "border-amber-300 bg-white text-amber-700";
  return "border-slate-300 bg-white text-slate-700";
}

function decisionChipClass(status: DecisionStatus) {
  if (status === "accepted") return "border-sky-300 bg-white text-sky-700";
  if (status === "proposed") return "border-slate-300 bg-white text-slate-700";
  return "border-violet-300 bg-white text-violet-700";
}

function dueCategoryAccentClass(category: "dueSoon" | "overdue") {
  return category === "overdue"
    ? "border-slate-300 border-l-4 border-l-rose-400"
    : "border-slate-300 border-l-4 border-l-amber-400";
}

function dueCategoryDotClass(category: "dueSoon" | "overdue") {
  return category === "overdue" ? "bg-rose-500" : "bg-amber-500";
}

function actionCardAccentClass(action: MyActionRecord) {
  if (action.overdue) return "border-l-rose-400";
  if (action.dueSoon) return "border-l-amber-400";
  return "border-l-sky-400";
}

function decisionCardAccentClass(status: DecisionStatus) {
  if (status === "accepted") return "border-l-sky-400";
  if (status === "proposed") return "border-l-slate-400";
  return "border-l-violet-400";
}

function quickActionToneDotClass(title: string) {
  if (title.toLowerCase().includes("meeting")) return "border-sky-300 bg-sky-50 text-sky-700";
  if (title.toLowerCase().includes("decision")) return "border-violet-300 bg-violet-50 text-violet-700";
  return "border-emerald-300 bg-emerald-50 text-emerald-700";
}

function quickActionToneCtaClass(title: string) {
  if (title.toLowerCase().includes("meeting")) {
    return "border-sky-300 text-sky-700 group-hover:border-sky-500 group-hover:bg-sky-50";
  }
  if (title.toLowerCase().includes("decision")) {
    return "border-violet-300 text-violet-700 group-hover:border-violet-500 group-hover:bg-violet-50";
  }
  return "border-emerald-300 text-emerald-700 group-hover:border-emerald-500 group-hover:bg-emerald-50";
}

function quickActionCtaLabel(title: string) {
  if (title.toLowerCase().includes("meeting")) return "Create meeting";
  if (title.toLowerCase().includes("decision")) return "Create decision";
  return "Create action";
}

function normalizePath(path: string) {
  if (!path) return "";
  if (path.startsWith("/")) return path;
  return `/${path}`;
}

function MyWorkActionList({
  title,
  eyebrow,
  emptyText,
  actions,
  workspaceSlug,
  accent,
}: MyWorkActionListProps) {
  return (
    <WorkspacePanel className={dueCategoryAccentClass(accent)}>
      <div className="border-b border-slate-200 pb-3">
        <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          <span className={`h-2 w-2 rounded-full ${dueCategoryDotClass(accent)}`} aria-hidden />
          {title}
        </h2>
      </div>

      {actions.length === 0 ? (
        <p className="mt-4 rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
          {emptyText}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {actions.slice(0, 6).map((action) => (
            <article
              key={`${title}-${action.id}`}
              className={`rounded-lg border border-slate-300 border-l-4 bg-white px-4 py-3 shadow-sm ${actionCardAccentClass(action)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{action.title}</p>
                  <p className="mt-1 text-xs text-slate-700">
                    {action.project} • {action.dueLabel}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                  <span className={`rounded-sm border px-2 py-1 ${priorityChipClass(action.priority)}`}>
                    {titleCase(action.priority)}
                  </span>
                  <Link
                    href={`/${workspaceSlug}/actions/${action.id}`}
                    className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                  >
                    Open
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </WorkspacePanel>
  );
}

export default async function WorkspaceMyWorkPage({ params }: WorkspaceMyWorkPageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceRef = adminDb.collection("workspaces").doc(access.workspaceId);
  const myDisplayName = normalizeText(access.user.displayName).toLowerCase();
  const myEmail = normalizeText(access.user.email).toLowerCase();

  const actionsRef = workspaceRef.collection("actions");
  let actionSnapshots;
  try {
    actionSnapshots = await actionsRef.orderBy("updatedAt", "desc").limit(280).get();
  } catch {
    actionSnapshots = await actionsRef.limit(280).get();
  }

  const myOpenActions: MyActionRecord[] = [];
  const nowEpoch = parseDate(actionSnapshots.readTime)?.getTime() ?? 0;

  for (const snapshot of actionSnapshots.docs) {
    const data = snapshot.data() as Record<string, unknown>;
    if (data.archived === true) continue;
    if (normalizeText(data.status) !== "open") continue;

    const ownerUid = normalizeText(data.ownerUid);
    const ownerLabel = normalizeText(data.owner).toLowerCase();
    const assignedToMe =
      ownerUid === access.uid ||
      (ownerLabel && (ownerLabel === myDisplayName || ownerLabel === myEmail));
    if (!assignedToMe) continue;

    const dueAt = parseDate(data.dueAt);
    const dueAtEpoch = dueAt?.getTime() ?? null;
    const dueLabel =
      normalizeText(data.dueLabel) || (dueAt ? formatDueLabelFromDate(dueAt) : "No due date");
    const dueSoonFlag = data.dueSoon === true;
    const dueSoon = dueSoonFlag || (dueAt ? isDueSoonDate(dueAt, nowEpoch) : isDueSoonLabel(dueLabel));
    const overdue = dueAtEpoch !== null && dueAtEpoch < nowEpoch;
    const updatedAt =
      parseDate(data.updatedAt) ?? parseDate(data.completedAt) ?? parseDate(data.createdAt);

    myOpenActions.push({
      id: snapshot.id,
      title: normalizeText(data.title) || normalizeText(data.description) || `Action ${snapshot.id}`,
      project:
        normalizeText(data.project) ||
        normalizeText(data.teamLabel) ||
        normalizeText(data.team) ||
        "Workspace",
      priority: parseActionPriority(data.priority),
      dueLabel,
      dueAtEpoch,
      dueSoon,
      overdue,
      meetingId: normalizeText(data.meetingId),
      decisionId: normalizeText(data.decisionId),
      updatedLabel: formatUpdatedLabel(updatedAt),
    });
  }

  myOpenActions.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueSoon !== b.dueSoon) return a.dueSoon ? -1 : 1;
    if (a.dueAtEpoch !== null && b.dueAtEpoch !== null) return a.dueAtEpoch - b.dueAtEpoch;
    if (a.dueAtEpoch !== null) return -1;
    if (b.dueAtEpoch !== null) return 1;
    return a.id.localeCompare(b.id);
  });

  const decisionsRef = workspaceRef.collection("decisions");
  let decisionSnapshots;
  try {
    decisionSnapshots = await decisionsRef.orderBy("updatedAt", "desc").limit(140).get();
  } catch {
    decisionSnapshots = await decisionsRef.limit(140).get();
  }

  const recentDecisions = decisionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      if (data.archived === true) return null;

      const title = normalizeText(data.title);
      if (!title) return null;

      const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);

      return {
        id: snapshot.id,
        title,
        owner: normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned",
        status: parseDecisionStatus(data.status),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAtEpoch: toEpoch(updatedAt),
      } satisfies MyDecisionRecord;
    })
    .filter((item): item is MyDecisionRecord => item !== null)
    .sort((a, b) => b.updatedAtEpoch - a.updatedAtEpoch || a.id.localeCompare(b.id))
    .slice(0, 5);

  const meetingsRef = workspaceRef.collection("meetings");
  let meetingSnapshots;
  try {
    meetingSnapshots = await meetingsRef.orderBy("updatedAt", "desc").limit(120).get();
  } catch {
    meetingSnapshots = await meetingsRef.limit(120).get();
  }

  const recentMeetings = meetingSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);

      return {
        id: snapshot.id,
        title: normalizeText(data.title) || `Meeting ${snapshot.id}`,
        team: normalizeText(data.team) || "Workspace",
        timeLabel: normalizeText(data.timeLabel) || "Date TBD",
        decisions: parseListCount(data.decisions),
        actions: parseListCount(data.actions),
        openQuestions: parseListCount(data.openQuestions),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAtEpoch: toEpoch(updatedAt),
      } satisfies MyMeetingRecord;
    })
    .sort((a, b) => b.updatedAtEpoch - a.updatedAtEpoch || a.id.localeCompare(b.id))
    .slice(0, 4);

  const notificationsRef = adminDb
    .collection("users")
    .doc(access.uid)
    .collection("notifications");
  let mentionSnapshots;
  try {
    mentionSnapshots = await notificationsRef.orderBy("updatedAt", "desc").limit(200).get();
  } catch {
    mentionSnapshots = await notificationsRef.limit(200).get();
  }

  const mentionItems = mentionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      if (normalizeText(data.type).toLowerCase() !== "mention") return null;

      const workspaceId = normalizeText(data.workspaceId);
      const notificationWorkspaceSlug = normalizeText(data.workspaceSlug);
      const belongsToWorkspace =
        workspaceId === access.workspaceId ||
        notificationWorkspaceSlug === access.workspaceSlug;
      if (!belongsToWorkspace) return null;

      const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);
      const readAt = parseDate(data.readAt);
      const entityType = parseEntityType(data.entityType);
      const entityId = normalizeText(data.entityId);
      const fallbackPath = entityId
        ? `/${access.workspaceSlug}/${entityType === "decision" ? "decisions" : "actions"}/${entityId}`
        : `/${access.workspaceSlug}/my-work`;
      const entityPath = normalizePath(normalizeText(data.entityPath)) || fallbackPath;

      return {
        id: snapshot.id,
        entityType,
        entityId,
        entityTitle: normalizeText(data.entityTitle) || `${titleCase(entityType)} ${entityId}`,
        entityPath,
        preview: normalizeText(data.preview),
        mentionedByName: normalizeText(data.mentionedByName) || "Workspace User",
        updatedLabel: formatUpdatedLabel(updatedAt),
        isRead: readAt !== null || normalizeText(data.status).toLowerCase() === "read",
        updatedAtEpoch: toEpoch(updatedAt),
      } satisfies MentionRecord;
    })
    .filter((item): item is MentionRecord => item !== null)
    .sort((a, b) => b.updatedAtEpoch - a.updatedAtEpoch || a.id.localeCompare(b.id))
    .slice(0, 8);

  const dueSoonCount = myOpenActions.filter((action) => action.dueSoon && !action.overdue).length;
  const overdueCount = myOpenActions.filter((action) => action.overdue).length;
  const unreadMentionsCount = mentionItems.filter((mention) => !mention.isRead).length;
  const dueSoonActions = myOpenActions.filter((action) => action.dueSoon && !action.overdue);
  const overdueActions = myOpenActions.filter((action) => action.overdue);

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">
              {access.workspaceName}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              My Work
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Per-workspace focus view for your assigned work and mentions.
            </p>
          </div>
          <span className="rounded-sm border border-[color:var(--accent-soft)] bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-[color:var(--accent-strong)]">
            {access.workspaceSlug.toUpperCase()}
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <SummaryTile
            label="Open Assigned"
            value={String(myOpenActions.length)}
            detail="Open actions assigned to you"
            className="border-slate-300 border-l-4 border-l-sky-400"
          />
          <SummaryTile
            label="Due Soon"
            value={String(dueSoonCount)}
            detail="Next 48 hours"
            className="border-slate-300 border-l-4 border-l-amber-400"
          />
          <SummaryTile
            label="Overdue"
            value={String(overdueCount)}
            detail="Needs attention now"
            className="border-slate-300 border-l-4 border-l-rose-400"
          />
          <SummaryTile
            label="Unread Mentions"
            value={String(unreadMentionsCount)}
            detail="Recent mention activity"
            className="border-slate-300 border-l-4 border-l-violet-400"
          />
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="flex items-end justify-between border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">QUICK ACTIONS</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              Planning quick actions
            </h2>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {quickActions.map((action) => (
            <Link
              key={action.title}
              href={`/${access.workspaceSlug}/${action.href}`}
              className="group flex min-h-[96px] items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-3 transition hover:border-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-soft)]"
            >
              <span
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-base font-semibold ${quickActionToneDotClass(action.title)}`}
                aria-hidden
              >
                +
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-950">{action.title}</p>
                <p className="mt-0.5 text-xs text-slate-700">{action.description}</p>
              </div>

              <span
                className={`inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] transition ${quickActionToneCtaClass(action.title)}`}
              >
                {quickActionCtaLabel(action.title)}
              </span>
            </Link>
          ))}
        </div>
      </WorkspacePanel>

      <div className="grid gap-6 xl:grid-cols-2">
        <MyWorkActionList
          eyebrow="DUE SOON"
          title="Assigned Actions Due Soon"
          emptyText="No due-soon actions assigned to you in this workspace."
          actions={dueSoonActions}
          workspaceSlug={access.workspaceSlug}
          accent="dueSoon"
        />
        <MyWorkActionList
          eyebrow="OVERDUE"
          title="Assigned Actions Overdue"
          emptyText="No overdue actions assigned to you in this workspace."
          actions={overdueActions}
          workspaceSlug={access.workspaceSlug}
          accent="overdue"
        />
      </div>

      <WorkspacePanel>
        <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">
              ASSIGNED ACTIONS
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden />
              Open Actions Assigned To Me
            </h2>
          </div>
          <Link
            href={`/${access.workspaceSlug}/actions`}
            className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            View all actions
          </Link>
        </div>

        {myOpenActions.length === 0 ? (
          <p className="mt-4 rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            No open actions assigned to you in this workspace.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {myOpenActions.map((action) => (
              <article
                key={action.id}
                className={`rounded-lg border border-slate-300 border-l-4 bg-white px-4 py-3 shadow-sm ${actionCardAccentClass(action)}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{action.title}</p>
                    <p className="mt-1 text-xs text-slate-700">
                      {action.id} • {action.project}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                    <span className={`rounded-sm border px-2 py-1 ${priorityChipClass(action.priority)}`}>
                      Priority {titleCase(action.priority)}
                    </span>
                    <span className={`rounded-sm border px-2 py-1 ${dueChipClass(action)}`}>
                      {action.overdue ? "Overdue" : action.dueSoon ? "Due Soon" : "Open"} •{" "}
                      {action.dueLabel}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
                  <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                    {action.updatedLabel}
                  </span>
                  {action.meetingId ? (
                    <Link
                      href={`/${access.workspaceSlug}/meetings/${action.meetingId}`}
                      className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 transition hover:border-slate-500 hover:bg-white hover:text-slate-900"
                    >
                      Meeting {action.meetingId}
                    </Link>
                  ) : null}
                  {action.decisionId ? (
                    <Link
                      href={`/${access.workspaceSlug}/decisions/${action.decisionId}`}
                      className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1 transition hover:border-slate-500 hover:bg-white hover:text-slate-900"
                    >
                      Decision {action.decisionId}
                    </Link>
                  ) : null}
                  <Link
                    href={`/${access.workspaceSlug}/actions/${action.id}`}
                    className="rounded-sm border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                  >
                    Open action
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </WorkspacePanel>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <WorkspacePanel>
          <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden />
              Recent Decisions
            </h2>
            <Link
              href={`/${access.workspaceSlug}/decisions`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              View all
            </Link>
          </div>

          {recentDecisions.length === 0 ? (
            <p className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              No decisions in this workspace yet.
            </p>
          ) : (
            <div className="space-y-3">
              {recentDecisions.map((decision) => (
                <article
                  key={decision.id}
                  className={`rounded-lg border border-slate-300 border-l-4 bg-white px-4 py-3 shadow-sm ${decisionCardAccentClass(decision.status)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">{decision.title}</p>
                    <span
                      className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${decisionChipClass(decision.status)}`}
                    >
                      {titleCase(decision.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-700">
                    {decision.id} • Owner {decision.owner}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
                    <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                      {decision.updatedLabel}
                    </span>
                    <Link
                      href={`/${access.workspaceSlug}/decisions/${decision.id}`}
                      className="rounded-sm border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                    >
                      Open decision
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel>
          <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3">
            <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden />
              Recent Meetings
            </h2>
            <Link
              href={`/${access.workspaceSlug}/meetings`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              View all
            </Link>
          </div>

          {recentMeetings.length === 0 ? (
            <p className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              No meetings found yet.
            </p>
          ) : (
            <div className="space-y-3">
              {recentMeetings.map((meeting) => (
                <article
                  key={meeting.id}
                  className="rounded-lg border border-slate-300 border-l-4 border-l-indigo-400 bg-white px-4 py-3 shadow-sm"
                >
                  <p className="text-sm font-semibold text-slate-950">{meeting.title}</p>
                  <p className="mt-1 text-xs text-slate-700">
                    {meeting.id} • {meeting.team} • {meeting.timeLabel}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
                    <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                      Decisions {meeting.decisions}
                    </span>
                    <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                      Actions {meeting.actions}
                    </span>
                    <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                      Questions {meeting.openQuestions}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
                    <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                      {meeting.updatedLabel}
                    </span>
                    <Link
                      href={`/${access.workspaceSlug}/meetings/${meeting.id}`}
                      className="rounded-sm border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                    >
                      Open meeting
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </WorkspacePanel>
      </div>

      <WorkspacePanel>
        <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-slate-500">MENTIONS</p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden />
              Recently Mentioned Items
            </h2>
          </div>
        </div>

        {mentionItems.length === 0 ? (
          <p className="mt-4 rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            No recent mentions in this workspace.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {mentionItems.map((mention) => (
              <article
                key={mention.id}
                className={`rounded-lg border border-slate-300 border-l-4 bg-white px-4 py-3 shadow-sm ${
                  mention.isRead ? "border-l-slate-400" : "border-l-violet-400"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">{mention.entityTitle}</p>
                    <p className="mt-1 text-xs text-slate-700">
                      Mentioned by {mention.mentionedByName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                    <span className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-slate-700">
                      {titleCase(mention.entityType)}
                    </span>
                    <span
                      className={`rounded-sm border px-2 py-1 ${
                        mention.isRead
                          ? "border-slate-300 bg-white text-slate-700"
                          : "border-violet-300 bg-white text-violet-700"
                      }`}
                    >
                      {mention.isRead ? "Read" : "New"}
                    </span>
                  </div>
                </div>

                {mention.preview ? (
                  <p className="mt-2 text-sm text-slate-800">{mention.preview}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
                  <span className="rounded-sm border border-slate-300 bg-slate-50 px-2 py-1">
                    {mention.updatedLabel}
                  </span>
                  <Link
                    href={mention.entityPath}
                    className="rounded-sm border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                  >
                    Open {mention.entityType}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </WorkspacePanel>
    </main>
  );
}
