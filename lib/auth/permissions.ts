export const WORKSPACE_MEMBER_ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;

export type WorkspaceMemberRole = (typeof WORKSPACE_MEMBER_ROLES)[number];

const WORKSPACE_MEMBER_ROLE_SET = new Set<WorkspaceMemberRole>(WORKSPACE_MEMBER_ROLES);
const MANAGER_ROLE_SET = new Set<WorkspaceMemberRole>(["owner", "admin"]);

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isWorkspaceMemberRole(value: unknown): value is WorkspaceMemberRole {
  const normalized = normalizeText(value).toLowerCase();
  return WORKSPACE_MEMBER_ROLE_SET.has(normalized as WorkspaceMemberRole);
}

export function parseWorkspaceMemberRole(
  value: unknown,
  fallback: WorkspaceMemberRole = "member",
): WorkspaceMemberRole {
  if (isWorkspaceMemberRole(value)) {
    return normalizeText(value).toLowerCase() as WorkspaceMemberRole;
  }
  return fallback;
}

export function isWorkspaceManagerRole(role: WorkspaceMemberRole) {
  return MANAGER_ROLE_SET.has(role);
}

export function canManageWorkspaceMembers(role: WorkspaceMemberRole) {
  return isWorkspaceManagerRole(role);
}

export function canUpdateWorkspaceSlug(role: WorkspaceMemberRole) {
  return isWorkspaceManagerRole(role);
}

export function canEditMeetings(role: WorkspaceMemberRole) {
  return role !== "viewer";
}

export function canRestoreMeetingRevisions(role: WorkspaceMemberRole) {
  return isWorkspaceManagerRole(role);
}

export function canEditDecisions(role: WorkspaceMemberRole) {
  return role !== "viewer";
}

export function canArchiveRestoreDecisions(role: WorkspaceMemberRole) {
  return isWorkspaceManagerRole(role);
}

export function canEditActions(role: WorkspaceMemberRole) {
  return role !== "viewer";
}

export function canArchiveRestoreActions(role: WorkspaceMemberRole) {
  return isWorkspaceManagerRole(role);
}
