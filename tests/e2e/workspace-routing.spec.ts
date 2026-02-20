import { expect, test } from "@playwright/test";
import { signUpAndOnboard, uniqueSuffix } from "./support/auth-helpers";
import { getUserByEmail, seedWorkspace, seedWorkspaceMembership } from "./support/firebase";

test("workspace switching + access-denied/not-found routes", async ({ page }) => {
  const suffix = uniqueSuffix("routing");
  const email = `${suffix}@example.com`;
  const password = "Password123!";
  const primarySlug = `primary-${suffix}`;
  const secondarySlug = `secondary-${suffix}`;
  const restrictedSlug = `restricted-${suffix}`;

  await signUpAndOnboard(page, {
    fullName: "Routing User",
    email,
    password,
    workspaceName: "Primary Workspace",
    workspaceSlug: primarySlug,
  });

  const user = await getUserByEmail(email);

  await seedWorkspaceMembership({
    workspaceSlug: secondarySlug,
    workspaceName: "Secondary Workspace",
    userUid: user.uid,
    userEmail: email,
    userDisplayName: "Routing User",
    role: "member",
  });

  await seedWorkspace({
    workspaceSlug: restrictedSlug,
    workspaceName: "Restricted Workspace",
    createdByUid: "another-owner",
  });

  await page.goto(`/${primarySlug}/my-work`);
  const workspaceMenu = page.getByRole("button", { name: /Workspace menu/i });
  await expect(workspaceMenu).toBeVisible();

  await expect
    .poll(
      async () => {
        await workspaceMenu.click();
        const optionVisible = await page
          .getByRole("button", { name: /Secondary Workspace/ })
          .first()
          .isVisible()
          .catch(() => false);
        await page.keyboard.press("Escape");
        return optionVisible;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  await workspaceMenu.click();
  await page.getByRole("button", { name: /Secondary Workspace/ }).first().click();
  await page.waitForURL(new RegExp(`/${secondarySlug}/my-work(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();

  await page.goto(`/${restrictedSlug}/my-work`);
  await page.waitForURL(/\/workspace-access-denied\?/);
  await expect(page.getByRole("heading", { name: "Workspace access denied" })).toBeVisible();

  const unknownSlug = `missing-${suffix}`;
  await page.goto(`/${unknownSlug}/my-work`);
  await page.waitForURL(/\/workspace-not-found\?/);
  await expect(page.getByRole("heading", { name: "Workspace not found" })).toBeVisible();
});
