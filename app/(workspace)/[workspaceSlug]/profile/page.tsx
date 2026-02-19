import Link from "next/link";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";
import { WorkspaceMemberProfileEditor } from "@/components/workspace/workspace-member-profile-editor";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceProfilePageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

type NotificationValues = {
  meetingDigests: boolean;
  actionReminders: boolean;
  weeklySummary: boolean;
  productAnnouncements: boolean;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNotifications(
  value: Partial<NotificationValues> | undefined,
  fallback: NotificationValues,
): NotificationValues {
  return {
    meetingDigests: value?.meetingDigests ?? fallback.meetingDigests,
    actionReminders: value?.actionReminders ?? fallback.actionReminders,
    weeklySummary: value?.weeklySummary ?? fallback.weeklySummary,
    productAnnouncements: value?.productAnnouncements ?? fallback.productAnnouncements,
  };
}

function parseStatusLabel(value: unknown) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "Active";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function WorkspaceProfilePage({ params }: WorkspaceProfilePageProps) {
  const { workspaceSlug } = await params;
  const access = await requireWorkspaceAccess(workspaceSlug);
  const memberSnapshot = await adminDb
    .collection("workspaces")
    .doc(access.workspaceId)
    .collection("members")
    .doc(access.uid)
    .get();
  const memberDisplayName =
    normalizeText(memberSnapshot.get("displayName")) || access.user.displayName;
  const memberJobTitle =
    normalizeText(memberSnapshot.get("jobTitle")) || access.membershipRoleLabel;
  const memberEmail = normalizeText(memberSnapshot.get("email")) || access.user.email;
  const memberStatus = parseStatusLabel(memberSnapshot.get("status"));
  const memberNotifications = normalizeNotifications(
    memberSnapshot.get("notifications") as Partial<NotificationValues> | undefined,
    access.user.notifications,
  );

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">
              {access.workspaceName}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              Workspace Profile
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Your member profile in this workspace. Use a workspace-specific display name
              without changing global account settings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm border border-violet-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-violet-700">
              WORKSPACE-LEVEL
            </span>
            <Link
              href={`/${access.workspaceSlug}/settings`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Open Workspace Settings
            </Link>
            <Link
              href={`/${access.workspaceSlug}/account`}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
            >
              Open Account Settings
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryTile
            label="Workspace"
            value={access.workspaceName}
            detail={access.workspaceSlug}
          />
          <SummaryTile
            label="Access Role"
            value={access.membershipRoleLabel}
            detail="Current workspace membership role"
          />
          <SummaryTile
            label="Membership Status"
            value={memberStatus}
            detail="Current status in this workspace"
          />
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Member Details</h2>
          <p className="mt-1 text-sm text-slate-600">
            Update display name, job title, and notification preferences for this workspace.
          </p>
        </div>
        <WorkspaceMemberProfileEditor
          workspaceSlug={access.workspaceSlug}
          initialDisplayName={memberDisplayName}
          initialJobTitle={memberJobTitle}
          initialNotifications={memberNotifications}
          email={memberEmail}
          roleLabel={access.membershipRoleLabel}
          statusLabel={memberStatus}
        />
      </WorkspacePanel>
    </main>
  );
}
