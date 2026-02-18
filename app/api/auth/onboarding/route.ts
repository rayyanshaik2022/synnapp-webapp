import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

type OnboardingRequestBody = {
  fullName?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  role?: string;
  teamSize?: string;
};

function sanitizeValue(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeWorkspaceSlug(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "my-workspace";
}

export async function POST(request: NextRequest) {
  try {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return NextResponse.json(
        { error: "Missing session. Sign in again and retry onboarding." },
        { status: 401 },
      );
    }

    const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
    const uid = decodedSession.uid;

    const body = (await request.json()) as OnboardingRequestBody;
    const fullName = sanitizeValue(body.fullName);
    const workspaceName = sanitizeValue(body.workspaceName);
    const workspaceSlug = normalizeWorkspaceSlug(sanitizeValue(body.workspaceSlug));
    const role = sanitizeValue(body.role);
    const teamSize = sanitizeValue(body.teamSize);

    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }

    if (!workspaceName) {
      return NextResponse.json(
        { error: "Workspace name is required." },
        { status: 400 },
      );
    }

    const userRecord = await adminAuth.getUser(uid);

    if ((userRecord.displayName ?? "") !== fullName) {
      await adminAuth.updateUser(uid, { displayName: fullName });
    }

    const usersCollection = adminDb.collection("users");
    const workspacesCollection = adminDb.collection("workspaces");
    const workspaceSlugsCollection = adminDb.collection("workspaceSlugs");

    let resolvedWorkspaceId = "";

    await adminDb.runTransaction(async (transaction) => {
      const now = Timestamp.now();

      const slugRef = workspaceSlugsCollection.doc(workspaceSlug);
      const slugSnapshot = await transaction.get(slugRef);

      let workspaceRef;

      if (slugSnapshot.exists) {
        const slugData = slugSnapshot.data() as
          | { workspaceId?: string; createdBy?: string }
          | undefined;

        if (!slugData?.workspaceId) {
          throw new Error("Workspace slug mapping is invalid.");
        }

        if (slugData.createdBy && slugData.createdBy !== uid) {
          throw new Error("Workspace slug is already taken.");
        }

        workspaceRef = workspacesCollection.doc(slugData.workspaceId);
      } else {
        workspaceRef = workspacesCollection.doc();
        transaction.set(slugRef, {
          slug: workspaceSlug,
          workspaceId: workspaceRef.id,
          createdBy: uid,
          createdAt: now,
        });
      }

      resolvedWorkspaceId = workspaceRef.id;

      const userRef = usersCollection.doc(uid);
      const memberRef = workspaceRef.collection("members").doc(uid);

      transaction.set(
        workspaceRef,
        {
          name: workspaceName,
          slug: workspaceSlug,
          createdBy: uid,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      );

      transaction.set(
        memberRef,
        {
          uid,
          role: "owner",
          displayName: fullName,
          email: userRecord.email ?? "",
          joinedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      transaction.set(
        userRef,
        {
          uid,
          email: userRecord.email ?? "",
          displayName: fullName,
          onboardingCompleted: true,
          defaultWorkspaceId: workspaceRef.id,
          role,
          teamSize,
          workspaceSlugs: FieldValue.arrayUnion(workspaceSlug),
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      );
    });

    return NextResponse.json({
      ok: true,
      workspaceSlug,
      workspaceId: resolvedWorkspaceId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to complete onboarding.";
    const isConflict = message === "Workspace slug is already taken.";

    return NextResponse.json(
      { error: message },
      { status: isConflict ? 409 : 500 },
    );
  }
}
