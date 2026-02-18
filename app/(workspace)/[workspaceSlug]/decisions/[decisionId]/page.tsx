import Link from "next/link";
import { DecisionEditor, type DecisionEditorValues } from "@/components/workspace/decision-editor";
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
  canArchiveRestoreDecisions,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";

type DecisionDetailPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string; decisionId: string }>;
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

function parseDecisionStatus(value: unknown): DecisionEditorValues["status"] {
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

function parseDecisionVisibility(value: unknown): DecisionEditorValues["visibility"] {
  const visibility = normalizeText(value);
  if (visibility === "workspace" || visibility === "team" || visibility === "private") {
    return visibility;
  }
  return "workspace";
}

export default async function DecisionDetailPage({ params }: DecisionDetailPageProps) {
  const { workspaceSlug, decisionId } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";
  const canArchiveRestore = canArchiveRestoreDecisions(
    parseWorkspaceMemberRole(access.membershipRole),
  );

  const decisionRef = adminDb
    .collection("workspaces")
    .doc(access.workspaceId)
    .collection("decisions")
    .doc(decisionId);

  const decisionSnapshot = await decisionRef.get();

  let initialValues: DecisionEditorValues | null = null;
  let isArchived = false;
  let archivedAtLabel = "";
  let historyEntries: EntityHistoryItem[] = [];

  if (decisionSnapshot.exists) {
    const data = decisionSnapshot.data() as Record<string, unknown>;
    isArchived = data.archived === true;
    archivedAtLabel =
      parseDate(data.archivedAt)?.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) ?? "";
    initialValues = {
      title: normalizeText(data.title) || `Decision ${decisionId}`,
      statement: normalizeText(data.statement),
      rationale: normalizeText(data.rationale),
      owner: normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned",
      status: parseDecisionStatus(data.status),
      visibility: parseDecisionVisibility(data.visibility),
      teamLabel: normalizeText(data.teamLabel),
      tags: normalizeStringArray(data.tags),
      meetingId: normalizeText(data.meetingId),
      supersedesDecisionId: normalizeText(data.supersedesDecisionId),
      supersededByDecisionId: normalizeText(data.supersededByDecisionId),
      mentionUids: normalizeStringArray(data.mentionUids),
    };

    const historySnapshot = await decisionRef
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
          `Updated decision ${decisionId}.`,
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
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            Decision {decisionId}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            This decision was not found in your workspace.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link
              href={`/${workspaceSlugForNav}/decisions`}
              className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Back to decisions
            </Link>
            <Link
              href={`/${workspaceSlugForNav}/decisions/new`}
              className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
            >
              Create decision
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
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          Decision {decisionId}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Edit the canonical decision record.
        </p>
        {isArchived ? (
          <p className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            This decision is archived{archivedAtLabel ? ` (since ${archivedAtLabel})` : ""}.
          </p>
        ) : null}
      </WorkspacePanel>

      <WorkspacePanel>
        <DecisionEditor
          workspaceSlug={workspaceSlugForNav}
          mode="edit"
          decisionId={decisionId}
          initialValues={initialValues}
          isArchived={isArchived}
          canArchiveRestore={canArchiveRestore}
          actorRoleLabel={access.membershipRoleLabel}
        />
      </WorkspacePanel>

      <EntityHistoryPanel
        title="Decision Activity"
        emptyLabel="No activity captured yet."
        entity="decision"
        entityId={decisionId}
        entries={historyEntries}
      />
    </main>
  );
}
