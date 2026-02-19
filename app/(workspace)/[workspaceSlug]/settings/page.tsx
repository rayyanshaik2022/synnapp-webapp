import Link from "next/link";
import { FilterChip, WorkspacePanel } from "@/components/workspace/primitives";
import { WorkspaceProfileSettings } from "@/components/workspace/workspace-profile-settings";
import { WorkspaceInvitesManager } from "@/components/workspace/workspace-invites-manager";
import { WorkspaceMembersManager } from "@/components/workspace/workspace-members-manager";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  canManageWorkspaceMembers,
  canUpdateWorkspaceSlug,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";

type WorkspaceSettingsPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

const settingsAnchors = [
  { label: "General", href: "#general" },
  { label: "Members", href: "#members" },
  { label: "Invites", href: "#invites" },
] as const;

export default async function WorkspaceSettingsPage({ params }: WorkspaceSettingsPageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceName = access.workspaceName;
  const resolvedWorkspaceSlug = access.workspaceSlug;
  const memberRole = parseWorkspaceMemberRole(access.membershipRole);
  const canManageSlug = canUpdateWorkspaceSlug(memberRole);
  const canManageMembers = canManageWorkspaceMembers(memberRole);

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Workspace Settings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Configure workspace-level settings: general, members, and invites.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-violet-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-violet-700">
              WORKSPACE-LEVEL
            </span>
            <Link
              href={`/${resolvedWorkspaceSlug}/account`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Open Account Settings
            </Link>
          </div>
        </div>

        <nav
          aria-label="Settings quick jump"
          className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-3"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-800">
            Quick Jump
          </p>
          <p className="mt-1 text-xs text-slate-700">
            Jump directly to a settings section.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Personal account updates are in Account Settings.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {settingsAnchors.map((anchor) => (
              <FilterChip key={anchor.href} label={anchor.label} href={anchor.href} />
            ))}
          </div>
        </nav>
      </WorkspacePanel>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section id="general" className="scroll-mt-24">
          <WorkspacePanel>
            <WorkspaceProfileSettings
              workspaceName={workspaceName}
              workspaceSlug={resolvedWorkspaceSlug}
              canManageSlug={canManageSlug}
              roleLabel={access.membershipRoleLabel}
            />
          </WorkspacePanel>
        </section>
      </section>

      <section id="members" className="scroll-mt-24">
        <WorkspacePanel>
          <WorkspaceMembersManager
            workspaceSlug={resolvedWorkspaceSlug}
            canManageMembers={canManageMembers}
            actorRoleLabel={access.membershipRoleLabel}
          />
        </WorkspacePanel>
      </section>

      <section id="invites" className="scroll-mt-24">
        <WorkspacePanel>
          <WorkspaceInvitesManager
            workspaceSlug={resolvedWorkspaceSlug}
            actorRole={memberRole}
            actorRoleLabel={access.membershipRoleLabel}
            canManageInvites={canManageMembers}
          />
        </WorkspacePanel>
      </section>
    </main>
  );
}
