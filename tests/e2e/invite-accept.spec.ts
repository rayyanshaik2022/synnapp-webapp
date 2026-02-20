import { expect, test } from "@playwright/test";
import {
  loginWithEmail,
  signOutFromWorkspace,
  signUpAndOnboard,
  uniqueSuffix,
} from "./support/auth-helpers";
import { getUserByEmail, seedWorkspaceInvite } from "./support/firebase";

test("invite accept flow from invited account", async ({ page }) => {
  const suffix = uniqueSuffix("invite");
  const inviterEmail = `inviter-${suffix}@example.com`;
  const invitedEmail = `invitee-${suffix}@example.com`;
  const password = "Password123!";
  const workspaceSlug = `invites-${suffix}`;

  await signUpAndOnboard(page, {
    fullName: "Inviter User",
    email: inviterEmail,
    password,
    workspaceName: "Invite Workspace",
    workspaceSlug,
  });

  const inviter = await getUserByEmail(inviterEmail);
  const { token } = await seedWorkspaceInvite({
    workspaceSlug,
    workspaceName: "Invite Workspace",
    invitedEmail,
    invitedByUid: inviter.uid,
    invitedByName: "Inviter User",
    role: "member",
  });

  await signOutFromWorkspace(page);

  await page.goto(`/signup?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.getByLabel("Full name").fill("Invitee User");
  await page.getByLabel("Email").fill(invitedEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator('input[name="terms"]').check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(new RegExp(`/invite/${token}(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: /Join Invite Workspace/ })).toBeVisible();
  await page.getByRole("button", { name: "Accept Invite" }).click();
  await expect(
    page.getByText(/Invite accepted\. You can open the workspace now\./),
  ).toBeVisible();
  await expect(page.getByText("Invite is no longer active.")).toHaveCount(0);

  await page.getByRole("link", { name: "Open Workspace" }).click();
  await page.waitForURL(new RegExp(`/${workspaceSlug}/my-work(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
});

test("invite reject flow is reflected in workspace invite manager", async ({ page }) => {
  const suffix = uniqueSuffix("invite-reject");
  const inviterEmail = `inviter-${suffix}@example.com`;
  const invitedEmail = `invitee-${suffix}@example.com`;
  const password = "Password123!";
  const workspaceSlug = `invites-${suffix}`;

  await signUpAndOnboard(page, {
    fullName: "Inviter User",
    email: inviterEmail,
    password,
    workspaceName: "Invite Workspace",
    workspaceSlug,
  });

  const inviter = await getUserByEmail(inviterEmail);
  const { token } = await seedWorkspaceInvite({
    workspaceSlug,
    workspaceName: "Invite Workspace",
    invitedEmail,
    invitedByUid: inviter.uid,
    invitedByName: "Inviter User",
    role: "member",
  });

  await signOutFromWorkspace(page);

  await page.goto(`/signup?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.getByLabel("Full name").fill("Invitee User");
  await page.getByLabel("Email").fill(invitedEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator('input[name="terms"]').check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(new RegExp(`/invite/${token}(?:\\?|$)`));
  await page.getByRole("button", { name: "Reject Invite" }).click();
  await expect(page.getByText("Invite rejected.")).toBeVisible();

  await page.request.delete("/api/auth/session");
  await loginWithEmail(page, inviterEmail, password);
  await page.waitForURL(new RegExp(`/${workspaceSlug}/my-work(?:\\?|$)`));

  await page.goto(`/${workspaceSlug}/settings`);
  const inviteRow = page.locator("article").filter({ hasText: invitedEmail }).first();
  await expect(inviteRow).toBeVisible();
  await expect(inviteRow.getByText("REJECTED", { exact: true })).toBeVisible();
  await expect(inviteRow.getByText(/Rejected by/i)).toBeVisible();
});
