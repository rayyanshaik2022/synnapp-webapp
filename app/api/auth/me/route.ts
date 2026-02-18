import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  AppUserDocument,
  resolveAccessibleWorkspaceForUser,
} from "@/lib/auth/workspace-data";

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return NextResponse.json({ error: "Missing session." }, { status: 401 });
  }

  let uid = "";

  try {
    const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
    uid = decodedSession.uid;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid session.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const userData = (userSnapshot.data() as AppUserDocument | undefined) ?? {};
    const resolvedWorkspace = await resolveAccessibleWorkspaceForUser(uid, userData);
    const workspaceSlug = resolvedWorkspace?.workspaceSlug ?? null;

    const onboardingCompleted =
      userData.onboardingCompleted === true && workspaceSlug !== null;

    return NextResponse.json({
      uid,
      onboardingCompleted,
      workspaceSlug,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read authenticated user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
