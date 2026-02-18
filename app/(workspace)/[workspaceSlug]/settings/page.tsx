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

type TeamRecord = {
  name: string;
  members: number;
  visibility: "open" | "restricted";
  lead: string;
};

const teams: TeamRecord[] = [
  { name: "Product Ops", members: 6, visibility: "open", lead: "Priya" },
  { name: "Engineering", members: 9, visibility: "open", lead: "Noah" },
  { name: "Architecture", members: 4, visibility: "restricted", lead: "Avery" },
  { name: "Support", members: 5, visibility: "restricted", lead: "Maya" },
];

function visibilityStyle(visibility: TeamRecord["visibility"]) {
  if (visibility === "open") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function titleCase(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

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
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Settings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Configure workspace profile, membership, permissions, and digest defaults.
            </p>
          </div>
          <span className="rounded-sm border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-cyan-800">
            LIVE ACCESS DATA
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FilterChip label="General" active />
          <FilterChip label="Members" />
          <FilterChip label="Teams" />
          <FilterChip label="Permissions" />
          <FilterChip label="Digest Defaults" />
          <FilterChip label="Security" />
        </div>
      </WorkspacePanel>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <WorkspacePanel>
          <WorkspaceProfileSettings
            workspaceName={workspaceName}
            workspaceSlug={resolvedWorkspaceSlug}
            canManageSlug={canManageSlug}
            roleLabel={access.membershipRoleLabel}
          />
        </WorkspacePanel>

        <WorkspacePanel>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Digest Defaults</h2>

          <div className="mt-4 space-y-3">
            <ToggleRow label="Auto-send digest on meeting finalize" enabled />
            <ToggleRow label="Allow resend when revision changes" enabled />
            <ToggleRow label="Include open questions in digest" enabled />
            <ToggleRow label="Weekly summary digest" />
          </div>

          <div className="mt-4 grid gap-3">
            <SettingField label="Digest Sender" value="decisions@synn.co" />
            <SettingField label="Delivery Channel" value="Email (Slack later)" />
          </div>
        </WorkspacePanel>
      </section>

      <WorkspacePanel>
        <WorkspaceMembersManager
          workspaceSlug={resolvedWorkspaceSlug}
          canManageMembers={canManageMembers}
          actorRoleLabel={access.membershipRoleLabel}
        />
      </WorkspacePanel>

      <WorkspacePanel>
        <WorkspaceInvitesManager
          workspaceSlug={resolvedWorkspaceSlug}
          actorRole={memberRole}
          actorRoleLabel={access.membershipRoleLabel}
          canManageInvites={canManageMembers}
        />
      </WorkspacePanel>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <WorkspacePanel>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Teams</h2>
            <button
              type="button"
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Manage teams
            </button>
          </div>

          <div className="space-y-3">
            {teams.map((team) => (
              <article key={team.name} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{team.name}</p>
                  <span
                    className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${visibilityStyle(team.visibility)}`}
                  >
                    {titleCase(team.visibility)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Lead {team.lead} • {team.members} members
                </p>
              </article>
            ))}
          </div>
        </WorkspacePanel>

        <WorkspacePanel>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Permissions</h2>

          <div className="mt-4 space-y-3">
            <ToggleRow label="Members can create meetings" enabled />
            <ToggleRow label="Members can create decisions" enabled />
            <ToggleRow label="Members can invite users" />
            <ToggleRow label="Allow private decisions" enabled />
            <ToggleRow label="Require owner/admin for digest send" />
          </div>
        </WorkspacePanel>
      </section>

      <WorkspacePanel className="border-rose-200 bg-rose-50/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-rose-800">Danger Zone</h2>
            <p className="mt-2 text-sm text-rose-700">
              Archive or permanently remove this workspace. These actions affect all records.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-sm border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-500"
            >
              Archive workspace
            </button>
            <button
              type="button"
              className="rounded-sm border border-rose-500 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
            >
              Delete workspace
            </button>
          </div>
        </div>
      </WorkspacePanel>
    </main>
  );
}

function SettingField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">{label}</span>
      <input
        value={value}
        readOnly
        className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
      />
    </label>
  );
}

function ToggleRow({ label, enabled = false }: { label: string; enabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-sm text-slate-700">{label}</p>
      <span
        className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${
          enabled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-100 text-slate-700"
        }`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </div>
  );
}
