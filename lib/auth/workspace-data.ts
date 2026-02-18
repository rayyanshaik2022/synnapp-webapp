import "server-only";

import { adminDb } from "@/lib/firebase/admin";

type WorkspaceSlugMapping = {
  workspaceId?: string;
};

type WorkspaceDocument = {
  slug?: string;
  name?: string;
};

export type AppUserDocument = {
  uid?: string;
  onboardingCompleted?: boolean;
  defaultWorkspaceId?: string;
  workspaceSlugs?: unknown;
  displayName?: string;
  email?: string;
  role?: string;
  jobTitle?: string;
  teamSize?: string;
  phone?: string;
  timezone?: string;
  bio?: string;
  notifications?: {
    meetingDigests?: boolean;
    actionReminders?: boolean;
    weeklySummary?: boolean;
    productAnnouncements?: boolean;
  };
};

export type ResolvedWorkspace = {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
};

type UserWorkspaceMembership = {
  workspaceId: string;
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function parseWorkspaceSlugCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const slug = entry.trim();
    if (!slug) continue;
    unique.add(slug);
  }

  return Array.from(unique);
}

function parseUniqueWorkspaceIds(value: Array<string | undefined | null>) {
  const unique = new Set<string>();

  for (const entry of value) {
    const workspaceId = normalizeText(entry);
    if (!workspaceId) continue;
    unique.add(workspaceId);
  }

  return Array.from(unique);
}

function isFailedPreconditionError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;

  if (code === 9 || code === "FAILED_PRECONDITION" || code === "failed-precondition") {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("FAILED_PRECONDITION") ||
    message.includes("failed-precondition") ||
    message.includes("requires an index")
  );
}

async function listMembershipWorkspaceIdsForUser(uid: string) {
  try {
    const membershipSnapshots = await adminDb
      .collectionGroup("members")
      .where("uid", "==", uid)
      .get();

    const workspaceIds = membershipSnapshots.docs.map(
      (memberSnapshot) => memberSnapshot.ref.parent.parent?.id ?? null,
    );

    return parseUniqueWorkspaceIds(workspaceIds);
  } catch (error) {
    if (isFailedPreconditionError(error)) {
      return [];
    }

    throw error;
  }
}

async function listMembershipsForUser(uid: string): Promise<UserWorkspaceMembership[]> {
  const workspaceIds = await listMembershipWorkspaceIdsForUser(uid);
  return workspaceIds.map((workspaceId) => ({ workspaceId }));
}

async function resolveWorkspaceById(workspaceId: string): Promise<ResolvedWorkspace | null> {
  const normalizedWorkspaceId = normalizeText(workspaceId);
  if (!normalizedWorkspaceId) return null;

  const workspaceSnapshot = await adminDb
    .collection("workspaces")
    .doc(normalizedWorkspaceId)
    .get();

  if (!workspaceSnapshot.exists) return null;

  const workspaceData = workspaceSnapshot.data() as WorkspaceDocument | undefined;
  const workspaceSlug = normalizeText(workspaceData?.slug);
  if (!workspaceSlug) return null;

  const workspaceName =
    normalizeText(workspaceData?.name) || formatWorkspaceName(workspaceSlug) || "Workspace";

  return {
    workspaceId: workspaceSnapshot.id,
    workspaceSlug,
    workspaceName,
  };
}

export async function resolveWorkspaceBySlug(
  workspaceSlug: string,
): Promise<ResolvedWorkspace | null> {
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug);
  if (!normalizedWorkspaceSlug) return null;

  const slugMappingSnapshot = await adminDb
    .collection("workspaceSlugs")
    .doc(normalizedWorkspaceSlug)
    .get();

  if (slugMappingSnapshot.exists) {
    const mappingData = slugMappingSnapshot.data() as WorkspaceSlugMapping | undefined;
    const mappedWorkspaceId = normalizeText(mappingData?.workspaceId);
    if (mappedWorkspaceId) {
      const resolvedFromMapping = await resolveWorkspaceById(mappedWorkspaceId);
      if (resolvedFromMapping) {
        return resolvedFromMapping;
      }
    }
  }

  const workspaceQuerySnapshot = await adminDb
    .collection("workspaces")
    .where("slug", "==", normalizedWorkspaceSlug)
    .limit(1)
    .get();

  const workspaceSnapshot = workspaceQuerySnapshot.docs[0];
  if (!workspaceSnapshot) return null;

  const workspaceData = workspaceSnapshot.data() as WorkspaceDocument | undefined;
  const resolvedSlug = normalizeText(workspaceData?.slug) || normalizedWorkspaceSlug;
  const workspaceName =
    normalizeText(workspaceData?.name) || formatWorkspaceName(resolvedSlug) || "Workspace";

  return {
    workspaceId: workspaceSnapshot.id,
    workspaceSlug: resolvedSlug,
    workspaceName,
  };
}

export async function userCanAccessWorkspace(uid: string, workspaceId: string) {
  const memberSnapshot = await adminDb
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get();

  return memberSnapshot.exists;
}

export async function resolveAccessibleWorkspaceForUser(
  uid: string,
  userData: AppUserDocument,
  options?: {
    excludeSlug?: string;
  },
): Promise<ResolvedWorkspace | null> {
  const accessibleWorkspaces = await listAccessibleWorkspacesForUser(uid, userData, options);
  return accessibleWorkspaces[0] ?? null;
}

export async function listAccessibleWorkspacesForUser(
  uid: string,
  userData: AppUserDocument,
  options?: {
    excludeSlug?: string;
  },
): Promise<ResolvedWorkspace[]> {
  const excludeSlug = normalizeText(options?.excludeSlug);
  const seenWorkspaceIds = new Set<string>();
  const workspaces: ResolvedWorkspace[] = [];

  async function addWorkspaceById(workspaceId: string) {
    const normalizedWorkspaceId = normalizeText(workspaceId);
    if (!normalizedWorkspaceId) return;
    if (seenWorkspaceIds.has(normalizedWorkspaceId)) return;

    const resolvedWorkspace = await resolveWorkspaceById(normalizedWorkspaceId);
    if (!resolvedWorkspace) return;
    if (resolvedWorkspace.workspaceSlug === excludeSlug) return;

    const hasAccess = await userCanAccessWorkspace(uid, resolvedWorkspace.workspaceId);
    if (!hasAccess) return;

    seenWorkspaceIds.add(resolvedWorkspace.workspaceId);
    workspaces.push(resolvedWorkspace);
  }

  const defaultWorkspaceId = normalizeText(userData.defaultWorkspaceId);
  if (defaultWorkspaceId) {
    await addWorkspaceById(defaultWorkspaceId);
  }

  const memberships = await listMembershipsForUser(uid);
  for (const membership of memberships) {
    await addWorkspaceById(membership.workspaceId);
  }

  const candidateSlugs = parseWorkspaceSlugCandidates(userData.workspaceSlugs);

  for (const candidateSlug of candidateSlugs) {
    if (candidateSlug === excludeSlug) continue;

    const resolvedWorkspace = await resolveWorkspaceBySlug(candidateSlug);
    if (!resolvedWorkspace) continue;

    const hasAccess = await userCanAccessWorkspace(uid, resolvedWorkspace.workspaceId);
    if (!hasAccess) continue;
    if (resolvedWorkspace.workspaceSlug === excludeSlug) continue;
    if (seenWorkspaceIds.has(resolvedWorkspace.workspaceId)) continue;

    seenWorkspaceIds.add(resolvedWorkspace.workspaceId);
    workspaces.push(resolvedWorkspace);
  }

  return workspaces;
}
