import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { parseWorkspaceMemberRole } from "@/lib/auth/permissions";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";
import {
  MAX_WORKSPACE_MEMBERSHIPS,
  parseWorkspaceSlugs,
} from "@/lib/workspace/limits";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

type InviteStatus = "pending" | "accepted" | "rejected" | "revoked" | "expired";

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function parseDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function formatInviteStatus(rawStatus: string, expiresAt: Date | null): InviteStatus {
  if (
    rawStatus === "accepted" ||
    rawStatus === "rejected" ||
    rawStatus === "revoked" ||
    rawStatus === "expired"
  ) {
    return rawStatus;
  }

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return "expired";
  }

  return "pending";
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function markInviteAsExpired(
  tokenRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  inviteRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData> | null,
) {
  const now = Timestamp.now();

  const batch = adminDb.batch();
  batch.set(
    tokenRef,
    {
      status: "expired",
      updatedAt: now,
    },
    { merge: true },
  );

  if (inviteRef) {
    batch.set(
      inviteRef,
      {
        status: "expired",
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await batch.commit();
}

function parseInviteAction(value: unknown): "reject" | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "reject") {
    return normalized;
  }
  return "";
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { token } = await context.params;
    const normalizedToken = normalizeText(token);

    if (!normalizedToken) {
      return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
    }

    const userRef = adminDb.collection("users").doc(uid);
    const [userRecord, tokenSnapshot, userSnapshot] = await Promise.all([
      adminAuth.getUser(uid),
      adminDb.collection("workspaceInviteTokens").doc(normalizedToken).get(),
      userRef.get(),
    ]);

    if (!tokenSnapshot.exists) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }

    const tokenData = tokenSnapshot.data() as Record<string, unknown>;
    const workspaceId = normalizeText(tokenData.workspaceId);
    const inviteId = normalizeText(tokenData.inviteId);

    if (!workspaceId || !inviteId) {
      return NextResponse.json(
        { error: "Invite is invalid. Ask for a new invite link." },
        { status: 400 },
      );
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspaceId);
    const inviteRef = workspaceRef.collection("invites").doc(inviteId);
    const memberRef = workspaceRef.collection("members").doc(uid);

    const [workspaceSnapshot, inviteSnapshot, memberSnapshot] = await Promise.all([
      workspaceRef.get(),
      inviteRef.get(),
      memberRef.get(),
    ]);

    if (!workspaceSnapshot.exists || !inviteSnapshot.exists) {
      return NextResponse.json(
        { error: "Invite no longer exists." },
        { status: 404 },
      );
    }

    const workspaceData = workspaceSnapshot.data() as Record<string, unknown>;
    const inviteData = inviteSnapshot.data() as Record<string, unknown>;
    const workspaceSlug = normalizeText(workspaceData.slug) || normalizeText(tokenData.workspaceSlug);
    const workspaceName =
      normalizeText(workspaceData.name) ||
      normalizeText(tokenData.workspaceName) ||
      workspaceSlug ||
      "Workspace";

    const inviteEmail = normalizeEmail(inviteData.email) || normalizeEmail(tokenData.email);
    const actorEmail = normalizeEmail(userRecord.email);
    const role = parseWorkspaceMemberRole(inviteData.role || tokenData.role);
    const expiresAt = parseDate(inviteData.expiresAt) ?? parseDate(tokenData.expiresAt);
    const rawStatus = normalizeText(inviteData.status || tokenData.status).toLowerCase();
    const status = formatInviteStatus(rawStatus, expiresAt);
    const userWorkspaceSlugs = parseWorkspaceSlugs(userSnapshot.get("workspaceSlugs"));

    if (status === "expired" && rawStatus !== "expired") {
      await markInviteAsExpired(tokenSnapshot.ref, inviteRef);
    }

    const alreadyMember = memberSnapshot.exists;
    const emailMismatch = Boolean(inviteEmail) && Boolean(actorEmail) && actorEmail !== inviteEmail;
    const missingEmail = !actorEmail;
    const atMembershipLimit =
      !alreadyMember &&
      !userWorkspaceSlugs.includes(workspaceSlug) &&
      userWorkspaceSlugs.length >= MAX_WORKSPACE_MEMBERSHIPS;
    const canAccept =
      status === "pending" &&
      !alreadyMember &&
      !emailMismatch &&
      !missingEmail &&
      !atMembershipLimit;

    let reason = "";
    if (alreadyMember) {
      reason = "You are already a member of this workspace.";
    } else if (status === "rejected") {
      reason = "This invite has been rejected.";
    } else if (emailMismatch) {
      reason = `This invite is for ${inviteEmail}, but you are signed in as ${actorEmail}.`;
    } else if (missingEmail) {
      reason = "Your account does not have a verified email address.";
    } else if (atMembershipLimit) {
      reason = `You can be a member of up to ${MAX_WORKSPACE_MEMBERSHIPS} workspaces.`;
    }

    return NextResponse.json({
      ok: true,
      invite: {
        token: normalizedToken,
        inviteId,
        workspaceId,
        workspaceSlug,
        workspaceName,
        email: inviteEmail,
        role,
        status,
        invitedByName: normalizeText(inviteData.invitedByName) || "Workspace Admin",
        invitedByUid: normalizeText(inviteData.invitedByUid),
        expiresAt: expiresAt?.toISOString() ?? "",
        createdAt: parseDate(inviteData.createdAt)?.toISOString() ?? "",
        updatedAt: parseDate(inviteData.updatedAt)?.toISOString() ?? "",
        acceptedAt: parseDate(inviteData.acceptedAt)?.toISOString() ?? "",
        rejectedAt: parseDate(inviteData.rejectedAt)?.toISOString() ?? "",
      },
      actor: {
        uid,
        email: actorEmail,
        displayName: normalizeText(userRecord.displayName) || actorEmail || "Workspace User",
      },
      canAccept,
      alreadyMember,
      reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load invite.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function postHandler(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { token } = await context.params;
    const normalizedToken = normalizeText(token);

    if (!normalizedToken) {
      return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
    }

    const userRecord = await adminAuth.getUser(uid);
    const actorEmail = normalizeEmail(userRecord.email);
    const actorDisplayName = normalizeText(userRecord.displayName) || actorEmail || "Workspace User";

    if (!actorEmail) {
      return NextResponse.json(
        { error: "Account email is required to accept an invite." },
        { status: 400 },
      );
    }

    const tokenRef = adminDb.collection("workspaceInviteTokens").doc(normalizedToken);
    let resolvedWorkspaceSlug = "";
    let resolvedWorkspaceName = "";
    let resolvedRole = parseWorkspaceMemberRole("member");
    let alreadyMember = false;

    await adminDb.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenSnapshot.exists) {
        throw new Error("INVITE_NOT_FOUND");
      }

      const tokenData = tokenSnapshot.data() as Record<string, unknown>;
      const workspaceId = normalizeText(tokenData.workspaceId);
      const inviteId = normalizeText(tokenData.inviteId);
      if (!workspaceId || !inviteId) {
        throw new Error("INVITE_INVALID");
      }

      const workspaceRef = adminDb.collection("workspaces").doc(workspaceId);
      const inviteRef = workspaceRef.collection("invites").doc(inviteId);
      const memberRef = workspaceRef.collection("members").doc(uid);
      const userRef = adminDb.collection("users").doc(uid);

      const [workspaceSnapshot, inviteSnapshot, memberSnapshot, userSnapshot] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(inviteRef),
        transaction.get(memberRef),
        transaction.get(userRef),
      ]);

      if (!workspaceSnapshot.exists || !inviteSnapshot.exists) {
        throw new Error("INVITE_NOT_FOUND");
      }

      const workspaceData = workspaceSnapshot.data() as Record<string, unknown>;
      const inviteData = inviteSnapshot.data() as Record<string, unknown>;
      const workspaceSlug =
        normalizeText(workspaceData.slug) || normalizeText(tokenData.workspaceSlug);
      const workspaceName =
        normalizeText(workspaceData.name) ||
        normalizeText(tokenData.workspaceName) ||
        workspaceSlug ||
        "Workspace";
      if (!workspaceSlug) {
        throw new Error("INVITE_INVALID");
      }
      const inviteEmail = normalizeEmail(inviteData.email) || normalizeEmail(tokenData.email);
      const role = parseWorkspaceMemberRole(inviteData.role || tokenData.role);
      const expiresAt = parseDate(inviteData.expiresAt) ?? parseDate(tokenData.expiresAt);
      const rawStatus = normalizeText(inviteData.status || tokenData.status).toLowerCase();
      const status = formatInviteStatus(rawStatus, expiresAt);

      if (status === "expired") {
        const now = Timestamp.now();
        transaction.set(
          inviteRef,
          {
            status: "expired",
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          tokenRef,
          {
            status: "expired",
            updatedAt: now,
          },
          { merge: true },
        );
        throw new Error("INVITE_EXPIRED");
      }

      if (status !== "pending") {
        throw new Error("INVITE_NOT_ACTIVE");
      }

      if (inviteEmail && inviteEmail !== actorEmail) {
        throw new Error("INVITE_EMAIL_MISMATCH");
      }

      resolvedWorkspaceSlug = workspaceSlug;
      resolvedWorkspaceName = workspaceName;
      resolvedRole = role;
      alreadyMember = memberSnapshot.exists;
      const userWorkspaceSlugs = parseWorkspaceSlugs(userSnapshot.get("workspaceSlugs"));
      const isNewMembership =
        !memberSnapshot.exists && !userWorkspaceSlugs.includes(workspaceSlug);

      if (isNewMembership && userWorkspaceSlugs.length >= MAX_WORKSPACE_MEMBERSHIPS) {
        throw new Error("WORKSPACE_MEMBERSHIP_LIMIT_REACHED");
      }

      const now = Timestamp.now();
      if (!memberSnapshot.exists) {
        transaction.set(
          memberRef,
          {
            uid,
            role,
            status: "active",
            displayName: actorDisplayName,
            email: actorEmail,
            joinedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      const currentDefaultWorkspaceId = normalizeText(userSnapshot.get("defaultWorkspaceId"));
      const userPayload: Record<string, unknown> = {
        uid,
        email: actorEmail,
        displayName: actorDisplayName,
        workspaceSlugs: FieldValue.arrayUnion(workspaceSlug),
        onboardingCompleted: true,
        updatedAt: now,
        createdAt: now,
      };
      if (!currentDefaultWorkspaceId) {
        userPayload.defaultWorkspaceId = workspaceId;
      }

      transaction.set(userRef, userPayload, { merge: true });

      transaction.set(
        inviteRef,
        {
          status: "accepted",
          targetUserExists: true,
          acceptedAt: now,
          acceptedByUid: uid,
          acceptedByEmail: actorEmail,
          rejectedAt: null,
          rejectedByUid: "",
          rejectedByEmail: "",
          updatedAt: now,
        },
        { merge: true },
      );

      transaction.set(
        tokenRef,
        {
          status: "accepted",
          targetUserExists: true,
          acceptedAt: now,
          acceptedByUid: uid,
          acceptedByEmail: actorEmail,
          rejectedAt: null,
          rejectedByUid: "",
          rejectedByEmail: "",
          updatedAt: now,
        },
        { merge: true },
      );
    });

    return NextResponse.json({
      ok: true,
      workspaceSlug: resolvedWorkspaceSlug,
      workspaceName: resolvedWorkspaceName,
      role: resolvedRole,
      alreadyMember,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept invite.";

    if (message === "INVITE_NOT_FOUND") {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }
    if (message === "INVITE_INVALID") {
      return NextResponse.json(
        { error: "Invite is invalid. Ask for a new link." },
        { status: 400 },
      );
    }
    if (message === "INVITE_EXPIRED") {
      return NextResponse.json({ error: "Invite has expired." }, { status: 410 });
    }
    if (message === "INVITE_NOT_ACTIVE") {
      return NextResponse.json({ error: "Invite is no longer active." }, { status: 409 });
    }
    if (message === "INVITE_EMAIL_MISMATCH") {
      return NextResponse.json(
        { error: "This invite belongs to a different email address." },
        { status: 403 },
      );
    }
    if (message === "WORKSPACE_MEMBERSHIP_LIMIT_REACHED") {
      return NextResponse.json(
        { error: `You can be a member of up to ${MAX_WORKSPACE_MEMBERSHIPS} workspaces.` },
        { status: 403 },
      );
    }

    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function patchHandler(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { token } = await context.params;
    const normalizedToken = normalizeText(token);

    if (!normalizedToken) {
      return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
    }

    const body = (await request.json()) as { action?: string };
    const action = parseInviteAction(body.action);
    if (!action) {
      return NextResponse.json({ error: "Valid invite action is required." }, { status: 400 });
    }

    const userRecord = await adminAuth.getUser(uid);
    const actorEmail = normalizeEmail(userRecord.email);
    if (!actorEmail) {
      return NextResponse.json(
        { error: "Account email is required to reject an invite." },
        { status: 400 },
      );
    }

    const tokenRef = adminDb.collection("workspaceInviteTokens").doc(normalizedToken);
    let resolvedWorkspaceSlug = "";
    let resolvedWorkspaceName = "";

    await adminDb.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenSnapshot.exists) {
        throw new Error("INVITE_NOT_FOUND");
      }

      const tokenData = tokenSnapshot.data() as Record<string, unknown>;
      const workspaceId = normalizeText(tokenData.workspaceId);
      const inviteId = normalizeText(tokenData.inviteId);
      if (!workspaceId || !inviteId) {
        throw new Error("INVITE_INVALID");
      }

      const workspaceRef = adminDb.collection("workspaces").doc(workspaceId);
      const inviteRef = workspaceRef.collection("invites").doc(inviteId);
      const memberRef = workspaceRef.collection("members").doc(uid);

      const [workspaceSnapshot, inviteSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(workspaceRef),
        transaction.get(inviteRef),
        transaction.get(memberRef),
      ]);

      if (!workspaceSnapshot.exists || !inviteSnapshot.exists) {
        throw new Error("INVITE_NOT_FOUND");
      }

      const workspaceData = workspaceSnapshot.data() as Record<string, unknown>;
      const inviteData = inviteSnapshot.data() as Record<string, unknown>;
      const workspaceSlug =
        normalizeText(workspaceData.slug) || normalizeText(tokenData.workspaceSlug);
      const workspaceName =
        normalizeText(workspaceData.name) ||
        normalizeText(tokenData.workspaceName) ||
        workspaceSlug ||
        "Workspace";
      if (!workspaceSlug) {
        throw new Error("INVITE_INVALID");
      }

      const inviteEmail = normalizeEmail(inviteData.email) || normalizeEmail(tokenData.email);
      const expiresAt = parseDate(inviteData.expiresAt) ?? parseDate(tokenData.expiresAt);
      const rawStatus = normalizeText(inviteData.status || tokenData.status).toLowerCase();
      const status = formatInviteStatus(rawStatus, expiresAt);

      if (status === "expired") {
        const now = Timestamp.now();
        transaction.set(
          inviteRef,
          {
            status: "expired",
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(
          tokenRef,
          {
            status: "expired",
            updatedAt: now,
          },
          { merge: true },
        );
        throw new Error("INVITE_EXPIRED");
      }

      if (status !== "pending") {
        throw new Error("INVITE_NOT_ACTIVE");
      }

      if (memberSnapshot.exists) {
        throw new Error("INVITE_ALREADY_MEMBER");
      }

      if (inviteEmail && inviteEmail !== actorEmail) {
        throw new Error("INVITE_EMAIL_MISMATCH");
      }

      const now = Timestamp.now();
      transaction.set(
        inviteRef,
        {
          status: "rejected",
          targetUserExists: true,
          rejectedAt: now,
          rejectedByUid: uid,
          rejectedByEmail: actorEmail,
          updatedAt: now,
        },
        { merge: true },
      );
      transaction.set(
        tokenRef,
        {
          status: "rejected",
          targetUserExists: true,
          rejectedAt: now,
          rejectedByUid: uid,
          rejectedByEmail: actorEmail,
          updatedAt: now,
        },
        { merge: true },
      );

      resolvedWorkspaceSlug = workspaceSlug;
      resolvedWorkspaceName = workspaceName;
    });

    return NextResponse.json({
      ok: true,
      status: "rejected",
      workspaceSlug: resolvedWorkspaceSlug,
      workspaceName: resolvedWorkspaceName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reject invite.";

    if (message === "INVITE_NOT_FOUND") {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }
    if (message === "INVITE_INVALID") {
      return NextResponse.json(
        { error: "Invite is invalid. Ask for a new invite link." },
        { status: 400 },
      );
    }
    if (message === "INVITE_EXPIRED") {
      return NextResponse.json({ error: "Invite has expired." }, { status: 410 });
    }
    if (message === "INVITE_NOT_ACTIVE") {
      return NextResponse.json({ error: "Invite is no longer active." }, { status: 409 });
    }
    if (message === "INVITE_ALREADY_MEMBER") {
      return NextResponse.json(
        { error: "You are already a member of this workspace." },
        { status: 409 },
      );
    }
    if (message === "INVITE_EMAIL_MISMATCH") {
      return NextResponse.json(
        { error: "This invite belongs to a different email address." },
        { status: 403 },
      );
    }

    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const PATCH = withWriteGuardrails(
  {
    routeId: "invites.respond",
    rateLimit: {
      maxRequests: 30,
      windowSeconds: 60,
    },
  },
  patchHandler,
);

export const POST = withWriteGuardrails(
  {
    routeId: "invites.accept",
    rateLimit: {
      maxRequests: 30,
      windowSeconds: 60,
    },
  },
  postHandler,
);
