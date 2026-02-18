import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  AppUserDocument,
  resolveAccessibleWorkspaceForUser,
} from "@/lib/auth/workspace-data";

type AuthPageSearchParams = {
  redirect?: string | string[];
};

const authRoots = new Set([
  "",
  "login",
  "signup",
  "onboarding",
  "workspace-not-found",
  "workspace-access-denied",
]);

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return normalizeText(value[0] ?? "");
  return normalizeText(value);
}

function resolveRedirectPath(value: string) {
  if (!value.startsWith("/")) return null;
  return value;
}

function rewriteWorkspacePath(pathname: string, workspaceSlug: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return `/${workspaceSlug}/my-work`;
  }

  const root = segments[0] ?? "";
  if (authRoots.has(root)) {
    return `/${workspaceSlug}/my-work`;
  }
  if (root === "invite") {
    return pathname;
  }

  return `/${workspaceSlug}/${segments.slice(1).join("/")}`;
}

function buildOnboardingPath(redirectPath: string | null) {
  const params = new URLSearchParams();
  params.set("provider", "email");
  if (redirectPath) {
    params.set("redirect", redirectPath);
  }

  return `/onboarding?${params.toString()}`;
}

export async function redirectAuthenticatedAuthPage(
  searchParams: AuthPageSearchParams,
) {
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return;

  let uid = "";
  try {
    const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
    uid = decodedSession.uid;
  } catch {
    return;
  }

  const userSnapshot = await adminDb.collection("users").doc(uid).get();
  const userData = (userSnapshot.data() as AppUserDocument | undefined) ?? {};
  const requestedRedirect = resolveRedirectPath(readSearchParam(searchParams.redirect));
  const resolvedWorkspace = await resolveAccessibleWorkspaceForUser(uid, userData);

  if (requestedRedirect?.startsWith("/invite/")) {
    redirect(requestedRedirect);
  }

  if (userData.onboardingCompleted !== true || !resolvedWorkspace) {
    redirect(buildOnboardingPath(requestedRedirect));
  }

  if (requestedRedirect) {
    redirect(rewriteWorkspacePath(requestedRedirect, resolvedWorkspace.workspaceSlug));
  }

  redirect(`/${resolvedWorkspace.workspaceSlug}/my-work`);
}
