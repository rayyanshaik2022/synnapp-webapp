import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";
import {
  DEFAULT_WORKSPACE_PLAN_TIER,
  MAX_OWNED_BASIC_WORKSPACES,
  MAX_WORKSPACE_MEMBERSHIPS,
  isBasicPlanTier,
  normalizeWorkspacePlanTier,
  parseWorkspaceSlugs,
} from "@/lib/workspace/limits";

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

async function postHandler(request: NextRequest) {
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
      const userRef = usersCollection.doc(uid);
      const ownedWorkspacesQuery = workspacesCollection.where("createdBy", "==", uid);
      const slugCollisionQuery = workspacesCollection.where("slug", "==", workspaceSlug).limit(1);
      const [slugSnapshot, userSnapshot, ownedWorkspacesSnapshot, slugCollisionSnapshot] =
        await Promise.all([
          transaction.get(slugRef),
          transaction.get(userRef),
          transaction.get(ownedWorkspacesQuery),
          transaction.get(slugCollisionQuery),
        ]);
      const userWorkspaceSlugs = parseWorkspaceSlugs(userSnapshot.get("workspaceSlugs"));
      const hasWorkspaceSlugInUserDoc = userWorkspaceSlugs.includes(workspaceSlug);
      const ownedBasicWorkspaceCount = ownedWorkspacesSnapshot.docs.filter((snapshot) =>
        isBasicPlanTier(snapshot.get("planTier")),
      ).length;

      let workspaceRef;
      let workspacePlanTier = DEFAULT_WORKSPACE_PLAN_TIER;
      let shouldCreateSlugMapping = false;
      let createsWorkspace = false;

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
        const workspaceSnapshot = await transaction.get(workspaceRef);
        if (!workspaceSnapshot.exists) {
          throw new Error("Workspace slug mapping is invalid.");
        }

        workspacePlanTier = normalizeWorkspacePlanTier(workspaceSnapshot.get("planTier"));
      } else if (!slugCollisionSnapshot.empty) {
        const existingWorkspaceSnapshot = slugCollisionSnapshot.docs[0]!;
        const createdBy = sanitizeValue(existingWorkspaceSnapshot.get("createdBy"));
        if (createdBy && createdBy !== uid) {
          throw new Error("Workspace slug is already taken.");
        }

        workspaceRef = existingWorkspaceSnapshot.ref;
        workspacePlanTier = normalizeWorkspacePlanTier(existingWorkspaceSnapshot.get("planTier"));
        shouldCreateSlugMapping = true;
      } else {
        workspaceRef = workspacesCollection.doc();
        shouldCreateSlugMapping = true;
        createsWorkspace = true;
      }

      const memberRef = workspaceRef.collection("members").doc(uid);
      const memberSnapshot = await transaction.get(memberRef);
      const addsMembership = !memberSnapshot.exists;

      if (
        addsMembership &&
        !hasWorkspaceSlugInUserDoc &&
        userWorkspaceSlugs.length >= MAX_WORKSPACE_MEMBERSHIPS
      ) {
        throw new Error("WORKSPACE_MEMBERSHIP_LIMIT_REACHED");
      }

      if (
        createsWorkspace &&
        isBasicPlanTier(workspacePlanTier) &&
        ownedBasicWorkspaceCount >= MAX_OWNED_BASIC_WORKSPACES
      ) {
        throw new Error("OWNED_WORKSPACE_LIMIT_REACHED");
      }

      resolvedWorkspaceId = workspaceRef.id;

      if (shouldCreateSlugMapping) {
        transaction.set(slugRef, {
          slug: workspaceSlug,
          workspaceId: workspaceRef.id,
          createdBy: uid,
          createdAt: now,
        });
      }

      transaction.set(
        workspaceRef,
        {
          name: workspaceName,
          slug: workspaceSlug,
          createdBy: uid,
          planTier: workspacePlanTier,
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
    const isLimitReached =
      message === "OWNED_WORKSPACE_LIMIT_REACHED" ||
      message === "WORKSPACE_MEMBERSHIP_LIMIT_REACHED";
    const errorMessage =
      message === "OWNED_WORKSPACE_LIMIT_REACHED"
        ? `You can own up to ${MAX_OWNED_BASIC_WORKSPACES} basic workspaces.`
        : message === "WORKSPACE_MEMBERSHIP_LIMIT_REACHED"
          ? `You can be a member of up to ${MAX_WORKSPACE_MEMBERSHIPS} workspaces.`
          : message;

    return NextResponse.json(
      { error: errorMessage },
      { status: isConflict ? 409 : isLimitReached ? 403 : 500 },
    );
  }
}

export const POST = withWriteGuardrails(
  {
    routeId: "auth.onboarding.create",
    rateLimit: {
      maxRequests: 12,
      windowSeconds: 60,
    },
  },
  postHandler,
);
