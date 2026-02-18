import { expect, test } from "@playwright/test";
import { signUpAndOnboard, uniqueSuffix } from "./support/auth-helpers";
import { getUserByEmail, seedWorkspaceMembership } from "./support/firebase";

test("meeting -> canonical decision/action sync + archive/restore", async ({ page }) => {
  const suffix = uniqueSuffix("meeting");
  const email = `${suffix}@example.com`;
  const password = "Password123!";
  const workspaceSlug = `ops-${suffix}`;
  const decisionTitle = "Adopt weekly operating review cadence";
  const actionTitle = "Prepare next week's scorecard";

  await signUpAndOnboard(page, {
    fullName: "Meeting Flow User",
    email,
    password,
    workspaceName: "Meeting Flow Workspace",
    workspaceSlug,
  });

  const user = await getUserByEmail(email);
  await seedWorkspaceMembership({
    workspaceSlug,
    workspaceName: "Meeting Flow Workspace",
    userUid: user.uid,
    userEmail: email,
    userDisplayName: "Meeting Flow User",
    role: "owner",
  });

  await page.goto(`/${workspaceSlug}/meetings/new`);
  await expect(page.getByRole("heading", { name: "New Meeting" })).toBeVisible();

  await page.getByLabel("Meeting title").fill("Weekly Operating Review");
  await page
    .getByLabel("Objective")
    .fill("Align owners, decisions, and execution plans for the week.");
  await page.getByRole("button", { name: "Create meeting" }).click();

  await page.waitForURL(new RegExp(`/${workspaceSlug}/meetings/[^/]+(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: "Record Overview" })).toBeVisible();

  const decisionInput = page.getByPlaceholder("Decision title");
  await decisionInput.fill(decisionTitle);
  await page.getByPlaceholder("Short rationale").fill("Improves owner visibility.");
  await page.getByRole("button", { name: "Add decision" }).click();
  await expect(page.getByText(/Added decision D-/)).toBeVisible();

  const actionInput = page.getByPlaceholder("Action title");
  await actionInput.fill(actionTitle);
  await page.getByPlaceholder("Due label").first().fill("Friday");
  await page.getByRole("button", { name: "Add action" }).click();
  await expect(page.getByText(/Added action A-/)).toBeVisible();

  await expect(page.getByText(/Saved at/)).toBeVisible({ timeout: 15_000 });

  await page.goto(`/${workspaceSlug}/decisions`);
  const decisionCard = page.locator("article").filter({ hasText: decisionTitle }).first();
  await expect(decisionCard).toBeVisible({ timeout: 20_000 });
  await decisionCard.getByRole("link", { name: "Open decision" }).click();
  await page.waitForURL(new RegExp(`/${workspaceSlug}/decisions/[^/]+(?:\\?|$)`));
  const archiveDecisionButton = page.getByRole("button", { name: "Archive" }).first();
  await expect(archiveDecisionButton).toBeVisible();
  await expect(archiveDecisionButton).toBeEnabled();

  page.once("dialog", (dialog) => dialog.accept());
  await archiveDecisionButton.click();
  await expect(page.getByText("Decision archived.")).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Decision restored.")).toBeVisible();

  await page.goto(`/${workspaceSlug}/actions`);
  const actionCard = page.locator("article").filter({ hasText: actionTitle }).first();
  await expect(actionCard).toBeVisible({ timeout: 20_000 });
  await actionCard.getByRole("link", { name: "Open action" }).click();
  await page.waitForURL(new RegExp(`/${workspaceSlug}/actions/[^/]+(?:\\?|$)`));
  const archiveActionButton = page.getByRole("button", { name: "Archive" }).first();
  await expect(archiveActionButton).toBeVisible();
  await expect(archiveActionButton).toBeEnabled();

  page.once("dialog", (dialog) => dialog.accept());
  await archiveActionButton.click();
  await expect(page.getByText("Action archived.")).toBeVisible();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Action restored.")).toBeVisible();
});
