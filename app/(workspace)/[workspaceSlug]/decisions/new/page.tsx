import { DecisionEditor, type DecisionEditorValues } from "@/components/workspace/decision-editor";
import { WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";

type NewDecisionPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function NewDecisionPage({ params }: NewDecisionPageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";

  const initialValues: DecisionEditorValues = {
    title: "",
    statement: "",
    rationale: "",
    owner: access.user.displayName || "",
    status: "proposed",
    visibility: "workspace",
    teamLabel: "",
    tags: [],
    meetingId: "",
    supersedesDecisionId: "",
    supersededByDecisionId: "",
    mentionUids: [],
  };

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">New Decision</h1>
        <p className="mt-2 text-sm text-slate-600">
          Create a canonical decision record with clear context, ownership, and visibility.
        </p>
      </WorkspacePanel>

      <WorkspacePanel>
        <DecisionEditor
          workspaceSlug={workspaceSlugForNav}
          mode="create"
          initialValues={initialValues}
        />
      </WorkspacePanel>
    </main>
  );
}
