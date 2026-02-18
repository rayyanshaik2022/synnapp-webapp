import test from "node:test";
import assert from "node:assert/strict";
import {
  canArchiveRestoreActions,
  canArchiveRestoreDecisions,
  canEditActions,
  canEditDecisions,
  canEditMeetings,
  isWorkspaceMemberRole,
  canManageWorkspaceMembers,
  canRestoreMeetingRevisions,
  canUpdateWorkspaceSlug,
  parseWorkspaceMemberRole,
  WORKSPACE_MEMBER_ROLES,
  type WorkspaceMemberRole,
} from "../../lib/auth/permissions.ts";

const MANAGER_ROLES = new Set<WorkspaceMemberRole>(["owner", "admin"]);

test("parseWorkspaceMemberRole normalizes known roles", () => {
  assert.equal(parseWorkspaceMemberRole("owner"), "owner");
  assert.equal(parseWorkspaceMemberRole("admin"), "admin");
  assert.equal(parseWorkspaceMemberRole("member"), "member");
  assert.equal(parseWorkspaceMemberRole("viewer"), "viewer");
  assert.equal(parseWorkspaceMemberRole(" ADMIN "), "admin");
});

test("parseWorkspaceMemberRole falls back for unknown values", () => {
  assert.equal(parseWorkspaceMemberRole(""), "member");
  assert.equal(parseWorkspaceMemberRole("invalid-role"), "member");
  assert.equal(parseWorkspaceMemberRole(undefined), "member");
  assert.equal(parseWorkspaceMemberRole("not-a-role", "viewer"), "viewer");
});

test("isWorkspaceMemberRole detects valid role strings", () => {
  assert.equal(isWorkspaceMemberRole("owner"), true);
  assert.equal(isWorkspaceMemberRole("viewer"), true);
  assert.equal(isWorkspaceMemberRole(" Owner "), true);
  assert.equal(isWorkspaceMemberRole("invalid"), false);
  assert.equal(isWorkspaceMemberRole(null), false);
});

test("manager-only capabilities are restricted to owner/admin", () => {
  for (const role of WORKSPACE_MEMBER_ROLES) {
    const expected = MANAGER_ROLES.has(role);
    assert.equal(canManageWorkspaceMembers(role), expected);
    assert.equal(canUpdateWorkspaceSlug(role), expected);
    assert.equal(canRestoreMeetingRevisions(role), expected);
    assert.equal(canArchiveRestoreDecisions(role), expected);
    assert.equal(canArchiveRestoreActions(role), expected);
  }
});

test("edit capabilities allow owner/admin/member and block viewer", () => {
  for (const role of WORKSPACE_MEMBER_ROLES) {
    const expected = role !== "viewer";
    assert.equal(canEditMeetings(role), expected);
    assert.equal(canEditDecisions(role), expected);
    assert.equal(canEditActions(role), expected);
  }
});
