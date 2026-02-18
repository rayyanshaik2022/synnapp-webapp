import { test, expect } from "@playwright/test";
import { signUpAndOnboard, uniqueSuffix } from "./support/auth-helpers";

test("email sign-up + onboarding redirects into workspace and blocks /login", async ({
  page,
}) => {
  const suffix = uniqueSuffix("auth");
  const email = `${suffix}@example.com`;
  const password = "Password123!";
  const workspaceSlug = `team-${suffix}`;

  await signUpAndOnboard(page, {
    fullName: "Auth Onboarding User",
    email,
    password,
    workspaceName: "Auth Onboarding Workspace",
    workspaceSlug,
  });

  await page.goto("/login");
  await page.waitForURL(new RegExp(`/${workspaceSlug}/my-work(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
});
