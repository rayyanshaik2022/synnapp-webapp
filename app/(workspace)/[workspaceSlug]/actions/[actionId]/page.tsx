import Link from "next/link";
import { ActionEditor, type ActionEditorValues } from "@/components/workspace/action-editor";
import {
  EntityHistoryPanel,
  type EntityHistoryItem,
} from "@/components/workspace/entity-history-panel";
import { WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";
import {
  type CanonicalHistoryEventType,
  type CanonicalHistorySource,
} from "@/lib/workspace/history-types";
import {
  canArchiveRestoreActions,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";

type ActionDetailPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string; actionId: string }>;
}>;

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

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  value.forEach((entry) => {
    const normalized = normalizeText(entry);
    if (normalized) {
      unique.add(normalized);
    }
  });

  return Array.from(unique);
}

function parseDate(value: unknown) {
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

function parseActionStatus(value: unknown): ActionEditorValues["status"] {
  const status = normalizeText(value);
  if (status === "open" || status === "blocked" || status === "done") {
    return status;
  }
  return "open";
}

function parseActionPriority(value: unknown): ActionEditorValues["priority"] {
  const priority = normalizeText(value);
  if (priority === "high" || priority === "medium" || priority === "low") {
    return priority;
  }
  return "medium";
}

function formatDateInput(value: Date | null) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function parseHistoryEventType(value: unknown): CanonicalHistoryEventType {
  const normalized = normalizeText(value);
  if (
    normalized === "created" ||
    normalized === "updated" ||
    normalized === "archived" ||
    normalized === "restored"
  ) {
    return normalized;
  }
  return "updated";
}

function parseHistorySource(value: unknown): CanonicalHistorySource {
  const normalized = normalizeText(value);
  if (normalized === "meetingSync" || normalized === "manual") {
    return normalized;
  }
  return "manual";
}

function formatHistoryTimestamp(value: unknown) {
  const date = parseDate(value);
  if (!date) return "Unknown time";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ActionDetailPage({ params }: ActionDetailPageProps) {
  const { workspaceSlug, actionId } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";
  const canArchiveRestore = canArchiveRestoreActions(
    parseWorkspaceMemberRole(access.membershipRole),
  );

  const actionRef = adminDb
    .collection("workspaces")
    .doc(access.workspaceId)
    .collection("actions")
    .doc(actionId);

  const actionSnapshot = await actionRef.get();

  let initialValues: ActionEditorValues | null = null;
  let isArchived = false;
  let archivedAtLabel = "";
  let historyEntries: EntityHistoryItem[] = [];

  if (actionSnapshot.exists) {
    const data = actionSnapshot.data() as Record<string, unknown>;
    const dueAt = parseDate(data.dueAt);
    isArchived = data.archived === true;
    archivedAtLabel =
      parseDate(data.archivedAt)?.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) ?? "";

    initialValues = {
      title: normalizeText(data.title) || normalizeText(data.description) || `Action ${actionId}`,
      description: normalizeText(data.description),
      owner: normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned",
      status: parseActionStatus(data.status),
      priority: parseActionPriority(data.priority),
      project: normalizeText(data.project) || normalizeText(data.teamLabel) || "Workspace",
      dueDate: formatDateInput(dueAt),
      dueLabel: normalizeText(data.dueLabel),
      meetingId: normalizeText(data.meetingId),
      decisionId: normalizeText(data.decisionId),
      blockedReason: normalizeText(data.blockedReason),
      notes: normalizeText(data.notes),
      mentionUids: normalizeStringArray(data.mentionUids),
    };

    const historySnapshot = await actionRef
      .collection("history")
      .orderBy("at", "desc")
      .limit(12)
      .get();

    historyEntries = historySnapshot.docs.map((entry) => {
      const event = entry.data() as Record<string, unknown>;

      return {
        id: entry.id,
        actorName: normalizeText(event.actorName) || "Workspace User",
        message:
          normalizeText(event.message) ||
          `Updated action ${actionId}.`,
        eventType: parseHistoryEventType(event.eventType),
        source: parseHistorySource(event.source),
        atLabel: formatHistoryTimestamp(event.at),
      };
    });
  }

  if (!initialValues) {
    return (
      <main className="space-y-6">
        <WorkspacePanel>
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Action {actionId}</h1>
          <p className="mt-2 text-sm text-slate-600">
            This action was not found in your workspace.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link
              href={`/${workspaceSlugForNav}/actions`}
              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Back to actions
            </Link>
            <Link
              href={`/${workspaceSlugForNav}/actions/new`}
              className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
            >
              Create action
            </Link>
          </div>
        </WorkspacePanel>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Action {actionId}</h1>
        <p className="mt-2 text-sm text-slate-600">
          Edit the canonical action record.
        </p>
        {isArchived ? (
          <p className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            This action is archived{archivedAtLabel ? ` (since ${archivedAtLabel})` : ""}.
          </p>
        ) : null}
      </WorkspacePanel>

      <WorkspacePanel>
        <ActionEditor
          workspaceSlug={workspaceSlugForNav}
          mode="edit"
          actionId={actionId}
          initialValues={initialValues}
          isArchived={isArchived}
          canArchiveRestore={canArchiveRestore}
          actorRoleLabel={access.membershipRoleLabel}
        />
      </WorkspacePanel>

      <EntityHistoryPanel
        title="Action Activity"
        emptyLabel="No activity captured yet."
        entity="action"
        entityId={actionId}
        entries={historyEntries}
      />
    </main>
  );
}
