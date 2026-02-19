import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type NotificationAction = "mark_read" | "mark_all_read";
type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
type NotificationType = "workspace_invite" | "mention";
type MentionEntityType = "decision" | "action";

type NotificationPatchBody = {
  action?: NotificationAction;
  notificationType?: NotificationType;
  token?: string;
  notificationId?: string;
};

type InviteNotification = {
  id: string;
  type: "workspace_invite";
  token: string;
  inviteUrl: string;
  workspaceSlug: string;
  workspaceName: string;
  role: string;
  invitedByName: string;
  status: InviteStatus;
  createdAt: string;
  expiresAt: string;
  isRead: boolean;
  readAt: string;
};

type MentionNotification = {
  id: string;
  type: "mention";
  notificationId: string;
  workspaceSlug: string;
  workspaceName: string;
  entityType: MentionEntityType;
  entityId: string;
  entityTitle: string;
  entityPath: string;
  mentionedByName: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  isRead: boolean;
  readAt: string;
};

type NotificationItem = InviteNotification | MentionNotification;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizePath(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
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
  if (rawStatus === "accepted" || rawStatus === "revoked" || rawStatus === "expired") {
    return rawStatus;
  }

  if (expiresAt && expiresAt.getTime() < Date.now()) {
    return "expired";
  }

  return "pending";
}

function formatRoleLabel(role: string) {
  const normalizedRole = normalizeText(role).toLowerCase();
  if (!normalizedRole) return "Member";
  return normalizedRole[0]?.toUpperCase() + normalizedRole.slice(1);
}

function parseNotificationAction(value: unknown): NotificationAction | "" {
  const action = normalizeText(value).toLowerCase();
  if (action === "mark_read" || action === "mark_all_read") {
    return action;
  }
  return "";
}

function parseNotificationType(value: unknown): NotificationType | "" {
  const type = normalizeText(value).toLowerCase();
  if (type === "workspace_invite" || type === "mention") {
    return type;
  }
  return "";
}

function parseMentionEntityType(value: unknown): MentionEntityType {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "action") return "action";
  return "decision";
}

function readTokenMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return { ...(value as Record<string, unknown>) };
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function resolveActorEmail(uid: string) {
  const userRecord = await adminAuth.getUser(uid);
  return normalizeEmail(userRecord.email);
}

async function listPendingInviteNotificationsByEmail(
  actorEmail: string,
  readInviteTokens: Record<string, unknown>,
): Promise<InviteNotification[]> {
  if (!actorEmail) {
    return [];
  }

  const tokenSnapshots = await adminDb
    .collection("workspaceInviteTokens")
    .where("email", "==", actorEmail)
    .limit(100)
    .get();

  const notifications: InviteNotification[] = [];

  for (const snapshot of tokenSnapshots.docs) {
    const data = snapshot.data() as Record<string, unknown>;
    const token = normalizeText(data.token || snapshot.id);
    if (!token) continue;

    const expiresAt = parseDate(data.expiresAt);
    const rawStatus = normalizeText(data.status).toLowerCase();
    const status = formatInviteStatus(rawStatus, expiresAt);
    if (status !== "pending") {
      continue;
    }

    const createdAt = parseDate(data.createdAt);
    const readAt = parseDate(readInviteTokens[token]);

    notifications.push({
      id: token,
      type: "workspace_invite",
      token,
      inviteUrl: `/invite/${encodeURIComponent(token)}`,
      workspaceSlug: normalizeText(data.workspaceSlug),
      workspaceName: normalizeText(data.workspaceName) || "Workspace",
      role: formatRoleLabel(normalizeText(data.role)),
      invitedByName: normalizeText(data.invitedByName) || "Workspace Admin",
      status,
      createdAt: createdAt?.toISOString() ?? "",
      expiresAt: expiresAt?.toISOString() ?? "",
      isRead: readAt !== null,
      readAt: readAt?.toISOString() ?? "",
    });
  }

  notifications.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  return notifications;
}

async function markInviteTokensRead(
  uid: string,
  actorEmail: string,
  tokens: string[],
) {
  const uniqueTokens = Array.from(
    new Set(
      tokens
        .map((token) => normalizeText(token))
        .filter(Boolean),
    ),
  );
  if (uniqueTokens.length === 0) {
    return 0;
  }

  const userRef = adminDb.collection("users").doc(uid);
  const userSnapshot = await userRef.get();
  const existingReadTokens = readTokenMap(
    userSnapshot.get("notificationState.readInviteTokens"),
  );
  const existingCreatedAt = userSnapshot.get("createdAt");
  const now = Timestamp.now();

  for (const token of uniqueTokens) {
    existingReadTokens[token] = now;
  }

  await userRef.set(
    {
      uid,
      email: actorEmail,
      notificationState: {
        readInviteTokens: existingReadTokens,
        updatedAt: now,
      },
      updatedAt: now,
      createdAt: existingCreatedAt ?? now,
    },
    { merge: true },
  );

  return uniqueTokens.length;
}

function mapMentionSnapshotToNotification(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>,
): MentionNotification | null {
  const data = snapshot.data() as Record<string, unknown>;
  const type = normalizeText(data.type).toLowerCase();
  if (type !== "mention") {
    return null;
  }

  const readAt = parseDate(data.readAt);
  const isRead = readAt !== null || normalizeText(data.status).toLowerCase() === "read";
  const workspaceSlug = normalizeText(data.workspaceSlug);
  const entityType = parseMentionEntityType(data.entityType);
  const entityId = normalizeText(data.entityId);
  const fallbackPath =
    workspaceSlug && entityId
      ? `/${workspaceSlug}/${entityType === "decision" ? "decisions" : "actions"}/${entityId}`
      : "";
  const createdAt = parseDate(data.createdAt);
  const updatedAt = parseDate(data.updatedAt);

  return {
    id: snapshot.id,
    type: "mention",
    notificationId: snapshot.id,
    workspaceSlug,
    workspaceName: normalizeText(data.workspaceName) || "Workspace",
    entityType,
    entityId,
    entityTitle: normalizeText(data.entityTitle) || `${entityType} ${entityId}`,
    entityPath: normalizePath(data.entityPath) || fallbackPath,
    mentionedByName: normalizeText(data.mentionedByName) || "Workspace User",
    preview: normalizeText(data.preview),
    createdAt: createdAt?.toISOString() ?? "",
    updatedAt: updatedAt?.toISOString() ?? createdAt?.toISOString() ?? "",
    isRead,
    readAt: readAt?.toISOString() ?? "",
  };
}

async function listMentionNotifications(uid: string): Promise<MentionNotification[]> {
  const notificationsSnapshot = await adminDb
    .collection("users")
    .doc(uid)
    .collection("notifications")
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();

  const notifications: MentionNotification[] = [];
  for (const snapshot of notificationsSnapshot.docs) {
    const notification = mapMentionSnapshotToNotification(snapshot);
    if (notification) {
      notifications.push(notification);
    }
  }

  return notifications;
}

async function markMentionNotificationRead(uid: string, notificationId: string) {
  const normalizedId = normalizeText(notificationId);
  if (!normalizedId) {
    return 0;
  }

  const notificationRef = adminDb
    .collection("users")
    .doc(uid)
    .collection("notifications")
    .doc(normalizedId);
  const notificationSnapshot = await notificationRef.get();

  if (!notificationSnapshot.exists) {
    return 0;
  }

  const notificationType = normalizeText(notificationSnapshot.get("type")).toLowerCase();
  if (notificationType !== "mention") {
    return 0;
  }

  const now = Timestamp.now();
  await notificationRef.set(
    {
      status: "read",
      readAt: now,
      updatedAt: now,
    },
    { merge: true },
  );

  return 1;
}

async function markAllMentionNotificationsRead(uid: string) {
  const notificationsSnapshot = await adminDb
    .collection("users")
    .doc(uid)
    .collection("notifications")
    .get();

  if (notificationsSnapshot.empty) {
    return 0;
  }

  const now = Timestamp.now();
  let updatedCount = 0;
  let batch = adminDb.batch();
  let batchWrites = 0;

  for (const snapshot of notificationsSnapshot.docs) {
    const data = snapshot.data() as Record<string, unknown>;
    if (normalizeText(data.type).toLowerCase() !== "mention") {
      continue;
    }

    const isRead =
      parseDate(data.readAt) !== null || normalizeText(data.status).toLowerCase() === "read";
    if (isRead) {
      continue;
    }

    batch.set(
      snapshot.ref,
      {
        status: "read",
        readAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    updatedCount += 1;
    batchWrites += 1;

    if (batchWrites >= 400) {
      await batch.commit();
      batch = adminDb.batch();
      batchWrites = 0;
    }
  }

  if (batchWrites > 0) {
    await batch.commit();
  }

  return updatedCount;
}

function notificationSortTime(notification: NotificationItem) {
  if (notification.type === "mention") {
    return notification.updatedAt || notification.createdAt;
  }
  return notification.createdAt;
}

function toEpoch(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function GET(request: NextRequest) {
  try {
    const uid = await authenticateUid(request);
    const actorEmail = await resolveActorEmail(uid);

    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const readInviteTokens = readTokenMap(userSnapshot.get("notificationState.readInviteTokens"));
    const [inviteNotifications, mentionNotifications] = await Promise.all([
      listPendingInviteNotificationsByEmail(actorEmail, readInviteTokens),
      listMentionNotifications(uid),
    ]);
    const notifications = [...inviteNotifications, ...mentionNotifications].sort((a, b) => {
      const aTime = toEpoch(notificationSortTime(a));
      const bTime = toEpoch(notificationSortTime(b));
      return bTime - aTime;
    });
    const unreadCount = notifications.reduce((count, notification) => {
      return notification.isRead ? count : count + 1;
    }, 0);

    return NextResponse.json({
      ok: true,
      unreadCount,
      notifications,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load notifications.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function patchHandler(request: NextRequest) {
  try {
    const uid = await authenticateUid(request);
    const actorEmail = await resolveActorEmail(uid);
    const body = (await request.json()) as NotificationPatchBody;
    const action = parseNotificationAction(body.action);
    const notificationType = parseNotificationType(body.notificationType);

    if (!action) {
      return NextResponse.json(
        { error: "Valid notification action is required." },
        { status: 400 },
      );
    }

    if (action === "mark_read") {
      if (notificationType === "mention" || normalizeText(body.notificationId)) {
        const notificationId = normalizeText(body.notificationId);
        if (!notificationId) {
          return NextResponse.json(
            { error: "Notification ID is required for mention mark_read." },
            { status: 400 },
          );
        }

        const mentionUpdatedCount = await markMentionNotificationRead(uid, notificationId);
        if (mentionUpdatedCount === 0) {
          return NextResponse.json(
            { error: "Mention notification not found." },
            { status: 404 },
          );
        }

        return NextResponse.json({
          ok: true,
          updatedCount: mentionUpdatedCount,
        });
      }

      const token = normalizeText(body.token);
      if (!token) {
        return NextResponse.json(
          { error: "Invite token is required for mark_read." },
          { status: 400 },
        );
      }

      const tokenSnapshot = await adminDb.collection("workspaceInviteTokens").doc(token).get();
      if (!tokenSnapshot.exists) {
        return NextResponse.json({ error: "Invite notification not found." }, { status: 404 });
      }

      const tokenEmail = normalizeEmail(tokenSnapshot.get("email"));
      if (!actorEmail || tokenEmail !== actorEmail) {
        return NextResponse.json(
          { error: "You do not have access to this invite notification." },
          { status: 403 },
        );
      }

      const updatedCount = await markInviteTokensRead(uid, actorEmail, [token]);
      return NextResponse.json({
        ok: true,
        updatedCount,
      });
    }

    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const readInviteTokens = readTokenMap(userSnapshot.get("notificationState.readInviteTokens"));
    const inviteNotifications = await listPendingInviteNotificationsByEmail(actorEmail, readInviteTokens);
    const unreadTokens = inviteNotifications
      .filter((notification) => !notification.isRead)
      .map((notification) => notification.token);
    const [updatedInvitesCount, updatedMentionsCount] = await Promise.all([
      markInviteTokensRead(uid, actorEmail, unreadTokens),
      markAllMentionNotificationsRead(uid),
    ]);

    return NextResponse.json({
      ok: true,
      updatedCount: updatedInvitesCount + updatedMentionsCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update notifications.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const PATCH = withWriteGuardrails(
  {
    routeId: "notifications.update",
    rateLimit: {
      maxRequests: 150,
      windowSeconds: 60,
    },
  },
  patchHandler,
);
