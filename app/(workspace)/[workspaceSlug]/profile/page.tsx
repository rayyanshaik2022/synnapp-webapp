import { ProfileEditor } from "@/components/workspace/profile-editor";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";

type WorkspaceProfilePageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

export default async function WorkspaceProfilePage({ params }: WorkspaceProfilePageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);

  const initialProfile = {
    fullName: access.user.displayName,
    email: access.user.email,
    jobTitle: access.user.jobTitle,
    phone: access.user.phone,
    timezone: access.user.timezone,
    bio: access.user.bio,
  };

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">
              {access.workspaceName}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">My Profile</h1>
            <p className="mt-2 text-sm text-slate-600">
              View and manage your personal account details and notification preferences.
            </p>
          </div>
          <span className="rounded-sm border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-cyan-800">
            LIVE USER DATA
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryTile
            label="Workspace Access"
            value={access.membershipRoleLabel}
            detail={`${access.workspaceName} membership`}
          />
          <SummaryTile
            label="Account Email"
            value={access.user.email || "Not set"}
            detail="Sourced from active authenticated session"
          />
          <SummaryTile
            label="Team Size"
            value={access.user.teamSize}
            detail="Set during onboarding"
          />
        </div>
      </WorkspacePanel>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <WorkspacePanel>
          <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Profile Details</h2>
            <p className="mt-1 text-sm text-slate-600">
              Update your account metadata used across meeting records, decisions, and actions.
            </p>
          </div>
          <ProfileEditor
            initialProfile={initialProfile}
            initialNotifications={access.user.notifications}
          />
        </WorkspacePanel>

        <WorkspacePanel>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Security and Sessions</h2>
          <div className="mt-4 space-y-3">
            <SecurityRow label="Auth Provider" value="Firebase Authentication" />
            <SecurityRow label="Session State" value="Authenticated with server session cookie" />
            <SecurityRow label="Workspace Scope" value={access.workspaceName} />
            <SecurityRow label="Workspace Role" value={access.membershipRoleLabel} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Change password (preview)
            </button>
            <button
              type="button"
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Sign out all sessions (preview)
            </button>
          </div>
        </WorkspacePanel>
      </section>
    </main>
  );
}

function SecurityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-700">{value}</p>
    </div>
  );
}
