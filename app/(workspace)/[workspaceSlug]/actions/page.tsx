import {
  WorkspaceActionsView,
  type ActionView,
  type WorkspaceActionRecord,
} from "@/components/workspace/workspace-actions-view";
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

export default async function WorkspaceActionsPage({ params, searchParams }: WorkspaceActionsPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const initialView = parseActionView(resolvedSearchParams.view);

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
      } satisfies WorkspaceActionRecord;
    })
    .sort((a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id));

  return (
    <WorkspaceActionsView
      workspaceSlug={workspaceSlugForNav}
      workspaceName={workspaceName}
      actions={actions}
      initialView={initialView}
    />
  );
}
