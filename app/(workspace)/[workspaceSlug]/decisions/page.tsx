import {
  WorkspaceDecisionsView,
  type DecisionView,
  type WorkspaceDecisionRecord,
} from "@/components/workspace/workspace-decisions-view";
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

function formatUpdatedLabel(date: Date | null) {
  if (!date) return "Updated recently";
  return `Updated ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export default async function WorkspaceDecisionsPage({
  params,
  searchParams,
}: WorkspaceDecisionsPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const initialView = parseDecisionView(resolvedSearchParams.view);

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
      } satisfies WorkspaceDecisionRecord;
    })
    .sort((a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id));

  return (
    <WorkspaceDecisionsView
      workspaceSlug={workspaceSlugForNav}
      workspaceName={workspaceName}
      decisions={decisions}
      initialView={initialView}
    />
  );
}
