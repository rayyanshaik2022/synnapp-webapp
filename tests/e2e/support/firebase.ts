import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

type WorkspaceSeedInput = {
  workspaceSlug: string;
  workspaceName: string;
  createdByUid?: string;
};

type MembershipSeedInput = {
  workspaceSlug: string;
  workspaceName: string;
  userUid: string;
  userEmail: string;
  userDisplayName: string;
  role?: "owner" | "admin" | "member" | "viewer";
};

type InviteSeedInput = {
  workspaceSlug: string;
  workspaceName: string;
  invitedEmail: string;
  invitedByUid: string;
  invitedByName: string;
  role?: "owner" | "admin" | "member" | "viewer";
  expiresInHours?: number;
};

const DEFAULT_WORKSPACE_PLAN_TIER = "basic";

function resolveProjectId() {
  return (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "synnapp-e2e"
  );
}

function resolveWorkspacePlanTier(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return DEFAULT_WORKSPACE_PLAN_TIER;
}

function getAuthEmulatorHost() {
  return process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
}

function getFirestoreEmulatorHost() {
  return process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
}

function getFirebaseAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  return initializeApp({
    projectId: resolveProjectId(),
  });
}

const adminAuth = getAuth(getFirebaseAdminApp());
const adminDb = getFirestore(getFirebaseAdminApp());

export async function resetEmulators() {
  const projectId = resolveProjectId();
  const [authResponse, firestoreResponse] = await Promise.all([
    fetch(
      `http://${getAuthEmulatorHost()}/emulator/v1/projects/${encodeURIComponent(projectId)}/accounts`,
      { method: "DELETE" },
    ),
    fetch(
      `http://${getFirestoreEmulatorHost()}/emulator/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`,
      { method: "DELETE" },
    ),
  ]);

  if (!authResponse.ok) {
    const body = await authResponse.text();
    throw new Error(`Failed to clear auth emulator: ${authResponse.status} ${body}`);
  }

  if (!firestoreResponse.ok) {
    const body = await firestoreResponse.text();
    throw new Error(
      `Failed to clear firestore emulator: ${firestoreResponse.status} ${body}`,
    );
  }
}

async function ensureWorkspaceSeed({
  workspaceSlug,
  workspaceName,
  createdByUid = "",
}: WorkspaceSeedInput) {
  const slug = workspaceSlug.trim().toLowerCase();
  const now = Timestamp.now();
  const slugRef = adminDb.collection("workspaceSlugs").doc(slug);
  const existingSlugSnapshot = await slugRef.get();

  if (existingSlugSnapshot.exists) {
    const workspaceId = String(existingSlugSnapshot.get("workspaceId") || "").trim();
    if (!workspaceId) {
      throw new Error(`workspaceSlugs/${slug} is missing workspaceId.`);
    }
    const workspaceRef = adminDb.collection("workspaces").doc(workspaceId);
    const workspaceSnapshot = await workspaceRef.get();
    const planTier = resolveWorkspacePlanTier(workspaceSnapshot.get("planTier"));
    await workspaceRef.set(
      {
        slug,
        name: workspaceName,
        planTier,
        updatedAt: now,
      },
      { merge: true },
    );
    return workspaceId;
  }

  const workspaceRef = adminDb.collection("workspaces").doc();
  await Promise.all([
    workspaceRef.set({
      slug,
      name: workspaceName,
      createdBy: createdByUid,
      planTier: DEFAULT_WORKSPACE_PLAN_TIER,
      createdAt: now,
      updatedAt: now,
    }),
    slugRef.set({
      slug,
      workspaceId: workspaceRef.id,
      createdBy: createdByUid,
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return workspaceRef.id;
}

export async function seedWorkspace(input: WorkspaceSeedInput) {
  return ensureWorkspaceSeed(input);
}

export async function seedWorkspaceMembership({
  workspaceSlug,
  workspaceName,
  userUid,
  userEmail,
  userDisplayName,
  role = "member",
}: MembershipSeedInput) {
  const workspaceId = await ensureWorkspaceSeed({
    workspaceSlug,
    workspaceName,
    createdByUid: userUid,
  });
  const now = Timestamp.now();

  await Promise.all([
    adminDb
      .collection("workspaces")
      .doc(workspaceId)
      .collection("members")
      .doc(userUid)
      .set(
        {
          uid: userUid,
          role,
          status: "active",
          displayName: userDisplayName,
          email: userEmail,
          joinedAt: now,
          updatedAt: now,
        },
        { merge: true },
      ),
    adminDb.collection("users").doc(userUid).set(
      {
        uid: userUid,
        email: userEmail,
        displayName: userDisplayName,
        onboardingCompleted: true,
        workspaceSlugs: FieldValue.arrayUnion(workspaceSlug),
        updatedAt: now,
      },
      { merge: true },
    ),
  ]);

  return workspaceId;
}

export async function seedWorkspaceInvite({
  workspaceSlug,
  workspaceName,
  invitedEmail,
  invitedByUid,
  invitedByName,
  role = "member",
  expiresInHours = 72,
}: InviteSeedInput) {
  const workspaceId = await ensureWorkspaceSeed({
    workspaceSlug,
    workspaceName,
    createdByUid: invitedByUid,
  });
  const now = Timestamp.now();
  const token = randomUUID().replace(/-/g, "");
  const inviteId = randomUUID().replace(/-/g, "");
  const expiresAt = Timestamp.fromDate(
    new Date(Date.now() + Math.max(1, expiresInHours) * 60 * 60 * 1000),
  );

  const invitePayload = {
    inviteId,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName,
    email: invitedEmail.toLowerCase(),
    role,
    status: "pending",
    invitedByUid,
    invitedByName,
    createdAt: now,
    updatedAt: now,
    expiresAt,
    acceptedAt: null,
    acceptedByUid: "",
    acceptedByEmail: "",
    targetUserExists: false,
  };

  await Promise.all([
    adminDb
      .collection("workspaces")
      .doc(workspaceId)
      .collection("invites")
      .doc(inviteId)
      .set(invitePayload),
    adminDb.collection("workspaceInviteTokens").doc(token).set(invitePayload),
  ]);

  return {
    token,
    inviteId,
    workspaceId,
  };
}

export async function getUserByEmail(email: string) {
  return adminAuth.getUserByEmail(email.toLowerCase());
}
