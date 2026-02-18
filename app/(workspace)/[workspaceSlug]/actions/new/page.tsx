import { ActionEditor, type ActionEditorValues } from "@/components/workspace/action-editor";
import { WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";

type NewActionPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function NewActionPage({ params }: NewActionPageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";

  const initialValues: ActionEditorValues = {
    title: "",
    description: "",
    owner: access.user.displayName || "",
    status: "open",
    priority: "medium",
    project: workspaceName,
    dueDate: "",
    dueLabel: "",
    meetingId: "",
    decisionId: "",
    blockedReason: "",
    notes: "",
    mentionUids: [],
  };

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">New Action</h1>
        <p className="mt-2 text-sm text-slate-600">
          Create a canonical action with clear ownership, status, and origin links.
        </p>
      </WorkspacePanel>

      <WorkspacePanel>
        <ActionEditor
          workspaceSlug={workspaceSlugForNav}
          mode="create"
          initialValues={initialValues}
        />
      </WorkspacePanel>
    </main>
  );
}
