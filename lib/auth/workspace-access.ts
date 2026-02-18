import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { DecodedIdToken } from "firebase-admin/auth";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { parseWorkspaceMemberRole, type WorkspaceMemberRole } from "@/lib/auth/permissions";
import {
  AppUserDocument,
  listAccessibleWorkspacesForUser,
  resolveWorkspaceBySlug,
  ResolvedWorkspace,
} from "@/lib/auth/workspace-data";

type WorkspaceMemberDocument = {
  role?: string;
  displayName?: string;
  email?: string;
};

type WorkspaceUserContext = {
  displayName: string;
  email: string;
  initials: string;
  roleLabel: string;
  jobTitle: string;
  phone: string;
  timezone: string;
  bio: string;
  teamSize: string;
  notifications: {
    meetingDigests: boolean;
    actionReminders: boolean;
    weeklySummary: boolean;
    productAnnouncements: boolean;
  };
  photoURL: string | null;
};

export type WorkspaceAccessContext = {
  uid: string;
  requestedPath: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  accessibleWorkspaces: ResolvedWorkspace[];
  membershipRole: WorkspaceMemberRole;
  membershipRoleLabel: string;
  fallbackWorkspaceSlug: string | null;
  user: WorkspaceUserContext;
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function normalizeClaimValue(value: unknown) {
  return typeof value === "string" ? normalizeText(value) : "";
}

function getInitials(displayName: string) {
  const tokens = displayName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (tokens.length === 0) return "U";
  if (tokens.length === 1) return tokens[0]?.slice(0, 2).toUpperCase() ?? "U";
  return `${tokens[0]?.[0] ?? ""}${tokens[1]?.[0] ?? ""}`.toUpperCase();
}

function formatRoleLabel(value: string) {
  if (!value) return "Member";

  if (value.includes("/")) {
    return value
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" / ");
  }

  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildUrl(pathname: string, searchParams: Record<string, string | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function deriveNameFromEmail(email: string) {
  const handle = email.split("@")[0]?.trim() ?? "";
  if (!handle) return "";

  return handle
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function getDisplayName(
  decodedSession: DecodedIdToken,
  userData: AppUserDocument,
  memberData: WorkspaceMemberDocument,
  email: string,
) {
  const fromToken = normalizeClaimValue(decodedSession.name);
  if (fromToken) return fromToken;

  const fromUserData = normalizeText(userData.displayName);
  if (fromUserData) return fromUserData;

  const fromMemberData = normalizeText(memberData.displayName);
  if (fromMemberData) return fromMemberData;

  const fromEmail = deriveNameFromEmail(email);
  if (fromEmail) return fromEmail;

  return "Workspace User";
}

function normalizeNotifications(
  value: AppUserDocument["notifications"],
): WorkspaceUserContext["notifications"] {
  return {
    meetingDigests: value?.meetingDigests !== false,
    actionReminders: value?.actionReminders !== false,
    weeklySummary: value?.weeklySummary === true,
    productAnnouncements: value?.productAnnouncements !== false,
  };
}

const loadWorkspaceAccess = cache(
  async (workspaceSlug: string): Promise<WorkspaceAccessContext> => {
    const resolvedWorkspaceSlug = normalizeText(workspaceSlug);
    const cookieStore = await cookies();
    const headerStore = await headers();
    const requestedPath =
      headerStore.get("x-pathname") ??
      `/${resolvedWorkspaceSlug || "workspace"}/my-work`;
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      redirect(`/login?redirect=${encodeURIComponent(requestedPath)}`);
    }

    let decodedSession: DecodedIdToken;
    try {
      decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
    } catch {
      redirect(`/login?redirect=${encodeURIComponent(requestedPath)}`);
    }

    const uid = decodedSession.uid;
    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const userData = (userSnapshot.data() as AppUserDocument | undefined) ?? {};

    if (userData.onboardingCompleted !== true) {
      redirect(`/onboarding?provider=email&redirect=${encodeURIComponent(requestedPath)}`);
    }

    const accessibleWorkspaces = await listAccessibleWorkspacesForUser(uid, userData);
    const fallbackWorkspace =
      accessibleWorkspaces.find(
        (workspaceCandidate) => workspaceCandidate.workspaceSlug !== resolvedWorkspaceSlug,
      ) ?? null;

    const workspace = await resolveWorkspaceBySlug(resolvedWorkspaceSlug);
    if (!workspace) {
      redirect(
        buildUrl("/workspace-not-found", {
          workspace: resolvedWorkspaceSlug,
          fallback: fallbackWorkspace?.workspaceSlug ?? null,
        }),
      );
    }

    const memberSnapshot = await adminDb
      .collection("workspaces")
      .doc(workspace.workspaceId)
      .collection("members")
      .doc(uid)
      .get();

    if (!memberSnapshot.exists) {
      redirect(
        buildUrl("/workspace-access-denied", {
          workspace: workspace.workspaceSlug,
          fallback: fallbackWorkspace?.workspaceSlug ?? null,
        }),
      );
    }

    const memberData = (memberSnapshot.data() as WorkspaceMemberDocument | undefined) ?? {};
    const email =
      normalizeClaimValue(decodedSession.email) ||
      normalizeText(userData.email) ||
      normalizeText(memberData.email);
    const displayName = getDisplayName(decodedSession, userData, memberData, email);
    const membershipRole = parseWorkspaceMemberRole(memberData.role);
    const roleLabel = formatRoleLabel(normalizeText(userData.role) || membershipRole);
    const jobTitle = normalizeText(userData.jobTitle) || roleLabel;
    const hasCurrentWorkspaceInList = accessibleWorkspaces.some(
      (workspaceCandidate) => workspaceCandidate.workspaceId === workspace.workspaceId,
    );
    const mergedAccessibleWorkspaces = hasCurrentWorkspaceInList
      ? accessibleWorkspaces
      : [workspace, ...accessibleWorkspaces];

    return {
      uid,
      requestedPath,
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
      workspaceName: workspace.workspaceName,
      accessibleWorkspaces: mergedAccessibleWorkspaces,
      membershipRole,
      membershipRoleLabel: formatRoleLabel(membershipRole),
      fallbackWorkspaceSlug: fallbackWorkspace?.workspaceSlug ?? null,
      user: {
        displayName,
        email,
        initials: getInitials(displayName),
        roleLabel,
        jobTitle,
        teamSize: normalizeText(userData.teamSize) || "Not set",
        phone: normalizeText(userData.phone),
        timezone: normalizeText(userData.timezone) || "America/Los_Angeles",
        bio:
          normalizeText(userData.bio) ||
          "Add a short summary about your role and current focus areas.",
        notifications: normalizeNotifications(userData.notifications),
        photoURL: normalizeClaimValue(decodedSession.picture) || null,
      },
    };
  },
);

export async function requireWorkspaceAccess(
  workspaceSlug: string,
): Promise<WorkspaceAccessContext> {
  return loadWorkspaceAccess(normalizeText(workspaceSlug));
}
