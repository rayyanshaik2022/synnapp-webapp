import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import {
  canManageWorkspaceMembers,
  isWorkspaceMemberRole,
  parseWorkspaceMemberRole,
  type WorkspaceMemberRole,
} from "@/lib/auth/permissions";
import { sendWorkspaceInviteEmail } from "@/lib/email/invite-email";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
  }>;
};

type InviteStatus = "pending" | "accepted" | "rejected" | "revoked" | "expired";

type CreateInviteBody = {
  email?: string;
  role?: WorkspaceMemberRole;
};

type InviteRecord = {
  id: string;
  email: string;
  role: WorkspaceMemberRole;
  status: InviteStatus;
  targetUserExists: boolean;
  invitedByUid: string;
  invitedByName: string;
  token: string;
  expiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  acceptedAt: Date | null;
  acceptedByUid: string;
  acceptedByEmail: string;
  rejectedAt: Date | null;
  rejectedByUid: string;
  rejectedByEmail: string;
  revokedAt: Date | null;
  revokedByUid: string;
  resendCount: number;
  emailDeliveryStatus: string;
  emailDeliveryProvider: string;
  emailDeliveryMessageId: string;
  emailDeliveryError: string;
  lastEmailDeliveryAt: Date | null;
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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

function createInviteId() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 900 + 100);
  return `I-${timestamp}${random}`;
}

function createInviteToken() {
  return randomBytes(24).toString("base64url");
}

function formatInviteStatus(status: string, expiresAt: Date | null): InviteStatus {
  if (
    status === "accepted" ||
    status === "rejected" ||
    status === "revoked" ||
    status === "expired"
  ) {
    return status;
  }

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return "expired";
  }

  return "pending";
}

function mapInviteSnapshot(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>,
) {
  const data = snapshot.data() as Record<string, unknown>;
  const parsedRole = parseWorkspaceMemberRole(data.role);
  const expiresAt = parseDate(data.expiresAt);
  const createdAt = parseDate(data.createdAt);
  const updatedAt = parseDate(data.updatedAt);
  const acceptedAt = parseDate(data.acceptedAt);
  const rejectedAt = parseDate(data.rejectedAt);
  const revokedAt = parseDate(data.revokedAt);
  const rawStatus = normalizeText(data.status).toLowerCase();
  const status = formatInviteStatus(rawStatus, expiresAt);

  return {
    id: snapshot.id,
    email: normalizeEmail(data.email),
    role: parsedRole,
    status,
    targetUserExists: data.targetUserExists !== false,
    invitedByUid: normalizeText(data.invitedByUid),
    invitedByName: normalizeText(data.invitedByName) || "Workspace Admin",
    token: normalizeText(data.token),
    expiresAt,
    createdAt,
    updatedAt,
    acceptedAt,
    acceptedByUid: normalizeText(data.acceptedByUid),
    acceptedByEmail: normalizeEmail(data.acceptedByEmail),
    rejectedAt,
    rejectedByUid: normalizeText(data.rejectedByUid),
    rejectedByEmail: normalizeEmail(data.rejectedByEmail),
    revokedAt,
    revokedByUid: normalizeText(data.revokedByUid),
    resendCount:
      typeof data.resendCount === "number" && Number.isFinite(data.resendCount)
        ? Math.max(0, Math.floor(data.resendCount))
        : 0,
    emailDeliveryStatus: normalizeText(data.emailDeliveryStatus),
    emailDeliveryProvider: normalizeText(data.emailDeliveryProvider),
    emailDeliveryMessageId: normalizeText(data.emailDeliveryMessageId),
    emailDeliveryError: normalizeText(data.emailDeliveryError),
    lastEmailDeliveryAt: parseDate(data.lastEmailDeliveryAt),
  } satisfies InviteRecord;
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function resolveInviteAccessContext(request: NextRequest, workspaceSlug: string) {
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
  const actorDisplayName =
    normalizeText(memberSnapshot.get("displayName")) || "Workspace Admin";
  const canManageInvites = canManageWorkspaceMembers(actorRole);

  return {
    uid,
    workspace,
    workspaceRef,
    actorRole,
    actorDisplayName,
    canManageInvites,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug } = await context.params;
    const accessContext = await resolveInviteAccessContext(request, workspaceSlug);

    if ("error" in accessContext) {
      return NextResponse.json(
        { error: accessContext.error },
        { status: accessContext.status },
      );
    }

    if (!accessContext.canManageInvites) {
      return NextResponse.json(
        { error: "Only owners and admins can view invites." },
        { status: 403 },
      );
    }

    const inviteSnapshots = await accessContext.workspaceRef
      .collection("invites")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const now = Date.now();
    const invites = inviteSnapshots.docs.map((snapshot) => {
      const invite = mapInviteSnapshot(snapshot);
      const inviteUrl = invite.token
        ? `${request.nextUrl.origin}/invite/${encodeURIComponent(invite.token)}`
        : "";

      return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        targetUserExists: invite.targetUserExists,
        invitedByUid: invite.invitedByUid,
        invitedByName: invite.invitedByName,
        inviteUrl,
        expiresAt: invite.expiresAt?.toISOString() ?? "",
        isExpired:
          invite.status === "pending" &&
          invite.expiresAt !== null &&
          invite.expiresAt.getTime() < now,
        createdAt: invite.createdAt?.toISOString() ?? "",
        updatedAt: invite.updatedAt?.toISOString() ?? "",
        acceptedAt: invite.acceptedAt?.toISOString() ?? "",
        acceptedByUid: invite.acceptedByUid,
        acceptedByEmail: invite.acceptedByEmail,
        rejectedAt: invite.rejectedAt?.toISOString() ?? "",
        rejectedByUid: invite.rejectedByUid,
        rejectedByEmail: invite.rejectedByEmail,
        revokedAt: invite.revokedAt?.toISOString() ?? "",
        revokedByUid: invite.revokedByUid,
        resendCount: invite.resendCount,
        emailDeliveryStatus: invite.emailDeliveryStatus || "queued",
        emailDeliveryProvider: invite.emailDeliveryProvider,
        emailDeliveryMessageId: invite.emailDeliveryMessageId,
        emailDeliveryError: invite.emailDeliveryError,
        lastEmailDeliveryAt: invite.lastEmailDeliveryAt?.toISOString() ?? "",
      };
    });

    return NextResponse.json({
      ok: true,
      workspaceId: accessContext.workspace.workspaceId,
      workspaceSlug: accessContext.workspace.workspaceSlug,
      actorUid: accessContext.uid,
      actorRole: accessContext.actorRole,
      canManageInvites: accessContext.canManageInvites,
      invites,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load invites.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function postHandler(request: NextRequest, context: RouteContext) {
  try {
    const { workspaceSlug } = await context.params;
    const accessContext = await resolveInviteAccessContext(request, workspaceSlug);

    if ("error" in accessContext) {
      return NextResponse.json(
        { error: accessContext.error },
        { status: accessContext.status },
      );
    }

    if (!accessContext.canManageInvites) {
      return NextResponse.json(
        { error: "Only owners and admins can create invites." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CreateInviteBody;
    const email = normalizeEmail(body.email);
    const roleInput = normalizeText(body.role).toLowerCase();
    const role = isWorkspaceMemberRole(roleInput)
      ? roleInput
      : parseWorkspaceMemberRole(body.role);

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 },
      );
    }

    if (role === "owner" && accessContext.actorRole !== "owner") {
      return NextResponse.json(
        { error: "Only owners can invite another owner." },
        { status: 403 },
      );
    }

    const targetUserExists = await resolveTargetUserExists(email);

    const inviteId = createInviteId();
    const token = createInviteToken();
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const inviteRef = accessContext.workspaceRef.collection("invites").doc(inviteId);
    const tokenRef = adminDb.collection("workspaceInviteTokens").doc(token);

    await adminDb.runTransaction(async (transaction) => {
      const existingInvite = await transaction.get(inviteRef);
      if (existingInvite.exists) {
        throw new Error("INVITE_ID_COLLISION");
      }

      transaction.set(inviteRef, {
        inviteId,
        token,
        email,
        role,
        status: "pending",
        targetUserExists,
        invitedByUid: accessContext.uid,
        invitedByName: accessContext.actorDisplayName,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        acceptedAt: null,
        acceptedByUid: "",
        acceptedByEmail: "",
        rejectedAt: null,
        rejectedByUid: "",
        rejectedByEmail: "",
        revokedAt: null,
        revokedByUid: "",
        resendCount: 0,
        emailDeliveryStatus: "queued",
        emailDeliveryProvider: "",
        emailDeliveryMessageId: "",
        emailDeliveryError: "",
        lastEmailDeliveryAt: null,
      });

      transaction.set(tokenRef, {
        token,
        workspaceId: accessContext.workspace.workspaceId,
        workspaceSlug: accessContext.workspace.workspaceSlug,
        workspaceName: accessContext.workspace.workspaceName,
        inviteId,
        email,
        role,
        status: "pending",
        targetUserExists,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        invitedByUid: accessContext.uid,
        invitedByName: accessContext.actorDisplayName,
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
      });
    });

    const inviteUrl = `${request.nextUrl.origin}/invite/${encodeURIComponent(token)}`;
    const emailDelivery = await sendWorkspaceInviteEmail({
      toEmail: email,
      workspaceName: accessContext.workspace.workspaceName,
      workspaceSlug: accessContext.workspace.workspaceSlug,
      inviteUrl,
      invitedByName: accessContext.actorDisplayName,
      role,
      expiresAtIso: expiresAt.toDate().toISOString(),
      targetUserExists,
      action: "created",
    });
    const deliveryAt = Timestamp.now();

    await Promise.all([
      inviteRef.set(
        {
          emailDeliveryStatus: emailDelivery.status,
          emailDeliveryProvider: emailDelivery.provider,
          emailDeliveryMessageId: emailDelivery.messageId,
          emailDeliveryError: emailDelivery.error,
          lastEmailDeliveryAt: deliveryAt,
          updatedAt: deliveryAt,
        },
        { merge: true },
      ),
      tokenRef.set(
        {
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
        email,
        role,
        status: "pending",
        targetUserExists,
        inviteUrl,
        expiresAt: expiresAt.toDate().toISOString(),
        invitedByUid: accessContext.uid,
        invitedByName: accessContext.actorDisplayName,
        emailDelivery,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create invite.";

    if (message === "INVITE_ID_COLLISION") {
      return NextResponse.json(
        { error: "Invite ID collision. Please retry." },
        { status: 409 },
      );
    }

    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withWriteGuardrails(
  {
    routeId: "workspace.invites.create",
  },
  postHandler,
);
