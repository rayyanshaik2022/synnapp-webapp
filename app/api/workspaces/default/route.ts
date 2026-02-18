import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";

type UpdateDefaultWorkspaceBody = {
  workspaceSlug?: string;
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

export async function PATCH(request: NextRequest) {
  try {
    const uid = await authenticateUid(request);
    const body = (await request.json()) as UpdateDefaultWorkspaceBody;
    const workspaceSlug = normalizeText(body.workspaceSlug);

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Workspace slug is required." }, { status: 400 });
    }

    const workspace = await resolveWorkspaceBySlug(workspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const memberSnapshot = await adminDb
      .collection("workspaces")
      .doc(workspace.workspaceId)
      .collection("members")
      .doc(uid)
      .get();

    if (!memberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    await adminDb.collection("users").doc(uid).set(
      {
        defaultWorkspaceId: workspace.workspaceId,
        workspaceSlugs: FieldValue.arrayUnion(workspace.workspaceSlug),
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );

    return NextResponse.json({
      ok: true,
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update workspace.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
