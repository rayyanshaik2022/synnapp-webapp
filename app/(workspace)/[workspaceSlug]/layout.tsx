import { WorkspaceNav } from "@/components/workspace/workspace-nav";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";

type WorkspaceLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}>;

const navItems = [
  { href: "my-work", label: "My Work" },
  { href: "meetings", label: "Meetings" },
  { href: "decisions", label: "Decisions" },
  { href: "actions", label: "Actions" },
  { href: "search", label: "Search" },
  { href: "profile", label: "Workspace Profile" },
  { href: "settings", label: "Workspace Settings" },
];

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceName = access.workspaceName;
  const userName = access.user.displayName;
  const userInitials = access.user.initials;
  const userRole = access.user.roleLabel;
  const workspaceSlugForNav = access.workspaceSlug;
  const accessibleWorkspaces = access.accessibleWorkspaces;

  return (
    <div className="min-h-screen bg-[linear-gradient(158deg,#e8edf4_0%,#d8e1ed_50%,#e8edf4_100%)]">
      <div className="mx-auto w-full max-w-[1420px] px-4 py-4 sm:px-6 lg:px-8">
        <WorkspaceSwitcher
          currentWorkspaceSlug={workspaceSlugForNav}
          workspaces={accessibleWorkspaces}
          userName={userName}
          userRole={userRole}
          userInitials={userInitials}
        />

        <div className="mt-4 flex gap-4">
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="sticky top-4 space-y-4">
              <section className="rounded-2xl border border-slate-700 bg-[linear-gradient(165deg,#0f172a_0%,#1e293b_100%)] px-5 py-6 text-white shadow-[0_18px_36px_rgba(15,23,42,0.25)]">
                <p className="text-xs font-semibold tracking-[0.2em] text-slate-300">
                  SYNNAPP OPERATIONS
                </p>
                <h1 className="mt-3 text-lg font-semibold tracking-tight">{workspaceName}</h1>
                <p className="mt-1 text-xs text-slate-300">
                  Access level: {access.membershipRoleLabel}
                </p>
              </section>

              <nav className="rounded-2xl border border-slate-200 bg-[color:var(--surface)] p-2 shadow-sm">
                <WorkspaceNav items={navItems} workspaceSlug={workspaceSlugForNav} />
              </nav>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="mb-4 overflow-x-auto rounded-xl border border-slate-200 bg-[color:var(--surface)] p-2 lg:hidden">
              <div className="flex min-w-max items-center gap-2">
                <WorkspaceNav items={navItems} workspaceSlug={workspaceSlugForNav} mobile />
              </div>
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
