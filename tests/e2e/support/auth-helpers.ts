import { expect, type Page } from "@playwright/test";

export type UserSignupInput = {
  fullName: string;
  email: string;
  password: string;
  workspaceName: string;
  workspaceSlug: string;
  redirectPath?: string;
};

export function uniqueSuffix(prefix = "e2e") {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, "0");
  return `${prefix}-${timestamp}-${random}`;
}

export async function signUpAndOnboard(page: Page, input: UserSignupInput) {
  const signupUrl = input.redirectPath
    ? `/signup?redirect=${encodeURIComponent(input.redirectPath)}`
    : "/signup";
  await page.goto(signupUrl);

  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();

  await page.getByLabel("Full name").fill(input.fullName);
  await page.getByLabel("Email").fill(input.email);
  await page.locator('input[name="password"]').fill(input.password);
  await page.locator('input[name="confirmPassword"]').fill(input.password);
  await page.locator('input[name="terms"]').check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/onboarding(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();

  await page.getByLabel("Full name").fill(input.fullName);
  await page.getByLabel("Workspace name").fill(input.workspaceName);
  await page.getByLabel("Workspace slug").fill(input.workspaceSlug);
  await page.getByRole("button", { name: "Complete setup" }).click();

  await page.waitForURL(new RegExp(`/${input.workspaceSlug}/my-work(?:\\?|$)`));
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
}

export async function loginWithEmail(page: Page, email: string, password: string) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOutFromWorkspace(page: Page) {
  await page.getByRole("button", { name: /^Sign out$/ }).click();
  await page.waitForURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}
