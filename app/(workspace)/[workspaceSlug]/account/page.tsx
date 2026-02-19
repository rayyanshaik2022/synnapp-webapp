import Link from "next/link";
import { ProfileEditor } from "@/components/workspace/profile-editor";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";

type AccountSettingsPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

export default async function AccountSettingsPage({ params }: AccountSettingsPageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);

  const initialProfile = {
    fullName: access.user.displayName,
    email: access.user.email,
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
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Account Settings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Personal profile details that apply across all workspaces.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-sky-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-sky-700">
              ACCOUNT-LEVEL
            </span>
            <Link
              href={`/${access.workspaceSlug}/profile`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Open Workspace Profile
            </Link>
            <Link
              href={`/${access.workspaceSlug}/settings`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Open Workspace Settings
            </Link>
          </div>
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

      <WorkspacePanel>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Account Profile</h2>
          <p className="mt-1 text-sm text-slate-600">
            These updates are saved to your account only. Workspace-specific profile and
            notification preferences are managed in Workspace Profile.
          </p>
        </div>
        <ProfileEditor initialProfile={initialProfile} />
      </WorkspacePanel>
    </main>
  );
}
