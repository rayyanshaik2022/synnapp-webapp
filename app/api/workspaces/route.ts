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
  parseWorkspaceSlugs,
} from "@/lib/workspace/limits";

type CreateWorkspaceBody = {
  workspaceName?: string;
  workspaceSlug?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeWorkspaceSlug(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return normalized || "my-workspace";
}

function deriveNameFromEmail(email: string) {
  const handle = email.split("@")[0]?.trim() ?? "";
  if (!handle) return "";

  return handle
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function postHandler(request: NextRequest) {
  try {
    const uid = await authenticateUid(request);
    const body = (await request.json()) as CreateWorkspaceBody;
    const workspaceName = normalizeText(body.workspaceName);
    const workspaceSlug = normalizeWorkspaceSlug(normalizeText(body.workspaceSlug));

    if (!workspaceName) {
      return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
    }

    const userRecord = await adminAuth.getUser(uid);
    const userEmail = normalizeEmail(userRecord.email);

    const usersCollection = adminDb.collection("users");
    const workspacesCollection = adminDb.collection("workspaces");
    const workspaceSlugsCollection = adminDb.collection("workspaceSlugs");

    let resolvedWorkspaceId = "";

    await adminDb.runTransaction(async (transaction) => {
      const now = Timestamp.now();
      const userRef = usersCollection.doc(uid);
      const slugRef = workspaceSlugsCollection.doc(workspaceSlug);
      const ownedWorkspacesQuery = workspacesCollection.where("createdBy", "==", uid);
      const slugCollisionQuery = workspacesCollection.where("slug", "==", workspaceSlug).limit(1);

      const [userSnapshot, slugSnapshot, ownedWorkspacesSnapshot, slugCollisionSnapshot] =
        await Promise.all([
          transaction.get(userRef),
          transaction.get(slugRef),
          transaction.get(ownedWorkspacesQuery),
          transaction.get(slugCollisionQuery),
        ]);

      if (slugSnapshot.exists || !slugCollisionSnapshot.empty) {
        throw new Error("WORKSPACE_SLUG_TAKEN");
      }

      const userWorkspaceSlugs = parseWorkspaceSlugs(userSnapshot.get("workspaceSlugs"));
      if (
        !userWorkspaceSlugs.includes(workspaceSlug) &&
        userWorkspaceSlugs.length >= MAX_WORKSPACE_MEMBERSHIPS
      ) {
        throw new Error("WORKSPACE_MEMBERSHIP_LIMIT_REACHED");
      }

      const ownedBasicWorkspaceCount = ownedWorkspacesSnapshot.docs.filter((snapshot) =>
        isBasicPlanTier(snapshot.get("planTier")),
      ).length;
      if (ownedBasicWorkspaceCount >= MAX_OWNED_BASIC_WORKSPACES) {
        throw new Error("OWNED_WORKSPACE_LIMIT_REACHED");
      }

      const workspaceRef = workspacesCollection.doc();
      const memberRef = workspaceRef.collection("members").doc(uid);
      const userDisplayName =
        normalizeText(userSnapshot.get("displayName")) ||
        normalizeText(userRecord.displayName) ||
        deriveNameFromEmail(userEmail) ||
        "Workspace User";

      transaction.set(slugRef, {
        slug: workspaceSlug,
        workspaceId: workspaceRef.id,
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(
        workspaceRef,
        {
          name: workspaceName,
          slug: workspaceSlug,
          createdBy: uid,
          planTier: DEFAULT_WORKSPACE_PLAN_TIER,
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
          status: "active",
          displayName: userDisplayName,
          email: userEmail,
          joinedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      transaction.set(
        userRef,
        {
          uid,
          email: userEmail,
          displayName: userDisplayName,
          onboardingCompleted: true,
          defaultWorkspaceId: workspaceRef.id,
          workspaceSlugs: FieldValue.arrayUnion(workspaceSlug),
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      );

      resolvedWorkspaceId = workspaceRef.id;
    });

    return NextResponse.json({
      ok: true,
      workspaceId: resolvedWorkspaceId,
      workspaceSlug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create workspace.";
    const isConflict = message === "WORKSPACE_SLUG_TAKEN";
    const isLimitReached =
      message === "OWNED_WORKSPACE_LIMIT_REACHED" ||
      message === "WORKSPACE_MEMBERSHIP_LIMIT_REACHED";
    const status = message === "UNAUTHORIZED" ? 401 : isConflict ? 409 : isLimitReached ? 403 : 500;
    const errorMessage =
      message === "WORKSPACE_SLUG_TAKEN"
        ? "Workspace slug is already taken."
        : message === "OWNED_WORKSPACE_LIMIT_REACHED"
          ? `You can own up to ${MAX_OWNED_BASIC_WORKSPACES} basic workspaces.`
          : message === "WORKSPACE_MEMBERSHIP_LIMIT_REACHED"
            ? `You can be a member of up to ${MAX_WORKSPACE_MEMBERSHIPS} workspaces.`
            : message;

    return NextResponse.json({ error: errorMessage }, { status });
  }
}

export const POST = withWriteGuardrails(
  {
    routeId: "workspaces.create",
    rateLimit: {
      maxRequests: 20,
      windowSeconds: 60,
    },
  },
  postHandler,
);
