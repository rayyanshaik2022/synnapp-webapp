import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import {
  canManageWorkspaceMembers,
  parseWorkspaceMemberRole,
} from "@/lib/auth/permissions";
import { sendWorkspaceInviteEmail } from "@/lib/email/invite-email";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
    inviteId: string;
  }>;
};

type InviteAction = "revoke" | "resend";

type UpdateInviteBody = {
  action?: InviteAction;
};

const INVITE_TTL_DAYS = 14;

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

function createInviteToken() {
  return randomBytes(24).toString("base64url");
}

function isAuthUserNotFoundError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "auth/user-not-found") {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return message.includes("user-not-found");
}

async function resolveTargetUserExists(email: string) {
  if (!email) return false;

  try {
    await adminAuth.getUserByEmail(email);
    return true;
  } catch (error) {
    if (isAuthUserNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function parseInviteAction(value: unknown): InviteAction | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "revoke" || normalized === "resend") {
    return normalized;
  }
  return "";
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function resolveInviteManagerContext(request: NextRequest, workspaceSlug: string) {
  const uid = await authenticateUid(request);
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    return { error: "Workspace not found.", status: 404 as const };
  }

  const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
  const memberSnapshot = await workspaceRef.collection("members").doc(uid).get();
  if (!memberSnapshot.exists) {
    return { error: "Access denied.", status: 403 as const };
  }

  const actorRole = parseWorkspaceMemberRole(memberSnapshot.get("role"));
  if (!canManageWorkspaceMembers(actorRole)) {
    return {
      error: "Only owners and admins can manage invites.",
      status: 403 as const,
    };
  }

  const actorDisplayName =
    normalizeText(memberSnapshot.get("displayName")) || "Workspace Admin";

  return {
    uid,
    workspace,
    workspaceRef,
    actorDisplayName,
  };
}

async function patchHandler(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug, inviteId } = await context.params;
    const managerContext = await resolveInviteManagerContext(request, workspaceSlug);

    if ("error" in managerContext) {
      return NextResponse.json(
        { error: managerContext.error },
        { status: managerContext.status },
      );
    }

    const body = (await request.json()) as UpdateInviteBody;
    const action = parseInviteAction(body.action);

    if (!action) {
      return NextResponse.json(
        { error: "Valid invite action is required." },
        { status: 400 },
      );
    }

    const inviteRef = managerContext.workspaceRef.collection("invites").doc(inviteId);
    const inviteSnapshot = await inviteRef.get();

    if (!inviteSnapshot.exists) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }

    const inviteData = inviteSnapshot.data() as Record<string, unknown>;
    const inviteStatus = normalizeText(inviteData.status).toLowerCase();
    const inviteToken = normalizeText(inviteData.token);
    const inviteRole = parseWorkspaceMemberRole(inviteData.role);
    const inviteEmail = normalizeEmail(inviteData.email);
    const targetUserExists = await resolveTargetUserExists(inviteEmail);
    const expiresAt = parseDate(inviteData.expiresAt);
    const isExpired =
      inviteStatus === "pending" &&
      expiresAt !== null &&
      expiresAt.getTime() < Date.now();
    const effectiveStatus = isExpired ? "expired" : inviteStatus;

    if (action === "revoke") {
      if (effectiveStatus === "accepted") {
        return NextResponse.json(
          { error: "Accepted invites cannot be revoked." },
          { status: 400 },
        );
      }

      const now = Timestamp.now();
      await adminDb.runTransaction(async (transaction) => {
        transaction.set(
          inviteRef,
          {
            status: "revoked",
            targetUserExists,
            rejectedAt: null,
            rejectedByUid: "",
            rejectedByEmail: "",
            revokedAt: now,
            revokedByUid: managerContext.uid,
            updatedAt: now,
          },
          { merge: true },
        );

        if (inviteToken) {
          const tokenRef = adminDb.collection("workspaceInviteTokens").doc(inviteToken);
          transaction.set(
            tokenRef,
            {
              status: "revoked",
              targetUserExists,
              rejectedAt: null,
              rejectedByUid: "",
              rejectedByEmail: "",
              revokedAt: now,
              revokedByUid: managerContext.uid,
              updatedAt: now,
            },
            { merge: true },
          );
        }
      });

      return NextResponse.json({
        ok: true,
        invite: {
          id: inviteId,
          email: inviteEmail,
          role: inviteRole,
          status: "revoked",
          targetUserExists,
        },
      });
    }

    if (effectiveStatus === "accepted") {
      return NextResponse.json(
        { error: "Accepted invites cannot be resent." },
        { status: 400 },
      );
    }

    const now = Timestamp.now();
    const nextToken = createInviteToken();
    const nextExpiresAt = Timestamp.fromMillis(
      now.toMillis() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const resendCount =
      typeof inviteData.resendCount === "number" && Number.isFinite(inviteData.resendCount)
        ? Math.max(0, Math.floor(inviteData.resendCount))
        : 0;

    await adminDb.runTransaction(async (transaction) => {
      transaction.set(
        inviteRef,
        {
          token: nextToken,
          status: "pending",
          expiresAt: nextExpiresAt,
          updatedAt: now,
          rejectedAt: null,
          rejectedByUid: "",
          rejectedByEmail: "",
          revokedAt: null,
          revokedByUid: "",
          resendCount: resendCount + 1,
        },
        { merge: true },
      );

      const nextTokenRef = adminDb.collection("workspaceInviteTokens").doc(nextToken);
      transaction.set(
        nextTokenRef,
        {
          token: nextToken,
          workspaceId: managerContext.workspace.workspaceId,
          workspaceSlug: managerContext.workspace.workspaceSlug,
          workspaceName: managerContext.workspace.workspaceName,
          inviteId,
          email: inviteEmail,
          role: inviteRole,
          status: "pending",
          targetUserExists,
          invitedByUid: managerContext.uid,
          invitedByName: managerContext.actorDisplayName,
          createdAt: now,
          updatedAt: now,
          expiresAt: nextExpiresAt,
          acceptedAt: null,
          acceptedByUid: "",
          acceptedByEmail: "",
          rejectedAt: null,
          rejectedByUid: "",
          rejectedByEmail: "",
          revokedAt: null,
          revokedByUid: "",
          emailDeliveryStatus: "queued",
          emailDeliveryProvider: "",
          emailDeliveryMessageId: "",
          emailDeliveryError: "",
          lastEmailDeliveryAt: null,
        },
        { merge: true },
      );

      if (inviteToken && inviteToken !== nextToken) {
        const previousTokenRef = adminDb.collection("workspaceInviteTokens").doc(inviteToken);
        transaction.set(
          previousTokenRef,
          {
            status: "revoked",
            revokedAt: now,
            revokedByUid: managerContext.uid,
            updatedAt: now,
            supersededByToken: nextToken,
          },
          { merge: true },
        );
      }
    });

    const inviteUrl = `${request.nextUrl.origin}/invite/${encodeURIComponent(nextToken)}`;
    const emailDelivery = await sendWorkspaceInviteEmail({
      toEmail: inviteEmail,
      workspaceName: managerContext.workspace.workspaceName,
      workspaceSlug: managerContext.workspace.workspaceSlug,
      inviteUrl,
      invitedByName: managerContext.actorDisplayName,
      role: inviteRole,
      expiresAtIso: nextExpiresAt.toDate().toISOString(),
      targetUserExists,
      action: "resent",
    });
    const deliveryAt = Timestamp.now();
    const nextTokenRef = adminDb.collection("workspaceInviteTokens").doc(nextToken);

    await Promise.all([
      inviteRef.set(
        {
          targetUserExists,
          emailDeliveryStatus: emailDelivery.status,
          emailDeliveryProvider: emailDelivery.provider,
          emailDeliveryMessageId: emailDelivery.messageId,
          emailDeliveryError: emailDelivery.error,
          lastEmailDeliveryAt: deliveryAt,
          updatedAt: deliveryAt,
        },
        { merge: true },
      ),
      nextTokenRef.set(
        {
          targetUserExists,
          emailDeliveryStatus: emailDelivery.status,
          emailDeliveryProvider: emailDelivery.provider,
          emailDeliveryMessageId: emailDelivery.messageId,
          emailDeliveryError: emailDelivery.error,
          lastEmailDeliveryAt: deliveryAt,
          updatedAt: deliveryAt,
        },
        { merge: true },
      ),
    ]);

    return NextResponse.json({
      ok: true,
      invite: {
        id: inviteId,
        email: inviteEmail,
        role: inviteRole,
        status: "pending",
        targetUserExists,
        inviteUrl,
        resendCount: resendCount + 1,
        expiresAt: nextExpiresAt.toDate().toISOString(),
        emailDelivery,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update invite.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const PATCH = withWriteGuardrails(
  {
    routeId: "workspace.invites.update",
  },
  patchHandler,
);
