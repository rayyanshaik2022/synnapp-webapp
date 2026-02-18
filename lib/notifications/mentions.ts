import { type Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

type MentionEntityType = "decision" | "action";

type EmitMentionNotificationsInput = {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  entityType: MentionEntityType;
  entityId: string;
  entityTitle: string;
  entityPath: string;
  mentionText?: string;
  previousMentionText?: string;
  mentionUids?: string[];
  previousMentionUids?: string[];
  actorUid: string;
  actorName: string;
  now: Timestamp;
};

type WorkspaceMemberIdentity = {
  uid: string;
  email: string;
  displayName: string;
};

type WorkspaceMemberIndex = {
  byEmail: Map<string, WorkspaceMemberIdentity>;
  byUid: Map<string, WorkspaceMemberIdentity>;
};

const MENTION_EMAIL_REGEX =
  /(^|[\s(])@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function normalizeUid(value: unknown) {
  return normalizeText(value);
}

function normalizePath(path: string) {
  if (!path) return "";
  if (path.startsWith("/")) return path;
  return `/${path}`;
}

function buildNotificationId(
  workspaceId: string,
  entityType: MentionEntityType,
  entityId: string,
) {
  const raw = `mention_${workspaceId}_${entityType}_${entityId}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildPreview(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
}

async function loadWorkspaceMemberIndex(workspaceId: string): Promise<WorkspaceMemberIndex> {
  const membersSnapshot = await adminDb
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .get();
  const byEmail = new Map<string, WorkspaceMemberIdentity>();
  const byUid = new Map<string, WorkspaceMemberIdentity>();

  for (const memberSnapshot of membersSnapshot.docs) {
    const memberData = memberSnapshot.data() as Record<string, unknown>;
    const uid = normalizeUid(memberData.uid) || memberSnapshot.id;
    const email = normalizeEmail(memberData.email);
    const displayName = normalizeText(memberData.displayName) || email || "Workspace Member";
    if (!uid) continue;

    const identity = { uid, email, displayName };
    byUid.set(uid, identity);
    if (email) {
      byEmail.set(email, identity);
    }
  }

  return { byEmail, byUid };
}

export function normalizeMentionUids(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  value.forEach((entry) => {
    const uid = normalizeUid(entry);
    if (uid) {
      unique.add(uid);
    }
  });

  return Array.from(unique);
}

export async function resolveWorkspaceMentionUids(
  workspaceId: string,
  mentionUids: string[],
) {
  const normalizedMentionUids = normalizeMentionUids(mentionUids);
  if (normalizedMentionUids.length === 0) {
    return {
      validMentionUids: [] as string[],
      invalidMentionUids: [] as string[],
    };
  }

  const memberIndex = await loadWorkspaceMemberIndex(workspaceId);
  const validMentionUids: string[] = [];
  const invalidMentionUids: string[] = [];

  for (const uid of normalizedMentionUids) {
    if (memberIndex.byUid.has(uid)) {
      validMentionUids.push(uid);
    } else {
      invalidMentionUids.push(uid);
    }
  }

  return {
    validMentionUids,
    invalidMentionUids,
  };
}

export function extractMentionedEmails(text: string) {
  if (!text) return [];

  const unique = new Set<string>();
  const matcher = new RegExp(MENTION_EMAIL_REGEX);
  let match: RegExpExecArray | null = matcher.exec(text);

  while (match !== null) {
    const email = normalizeEmail(match[2] ?? "");
    if (email) {
      unique.add(email);
    }
    match = matcher.exec(text);
  }

  return Array.from(unique);
}

function resolveMentionUidsFromEmails(
  emails: string[],
  memberIndex: WorkspaceMemberIndex,
) {
  const unique = new Set<string>();
  for (const email of emails) {
    const member = memberIndex.byEmail.get(email);
    if (member?.uid) {
      unique.add(member.uid);
    }
  }
  return Array.from(unique);
}

export async function emitMentionNotifications(
  input: EmitMentionNotificationsInput,
) {
  const memberIndex = await loadWorkspaceMemberIndex(input.workspaceId);
  const nextMentionUids =
    input.mentionUids !== undefined
      ? normalizeMentionUids(input.mentionUids).filter((uid) => memberIndex.byUid.has(uid))
      : resolveMentionUidsFromEmails(
          extractMentionedEmails(input.mentionText ?? ""),
          memberIndex,
        );
  if (nextMentionUids.length === 0) {
    return { deliveredCount: 0, mentionedUids: [] as string[] };
  }

  const previousMentionUids =
    input.previousMentionUids !== undefined
      ? normalizeMentionUids(input.previousMentionUids).filter((uid) =>
          memberIndex.byUid.has(uid),
        )
      : resolveMentionUidsFromEmails(
          extractMentionedEmails(input.previousMentionText ?? ""),
          memberIndex,
        );
  const previousMentionSet = new Set(previousMentionUids);
  const newlyMentionedUids = nextMentionUids.filter((uid) => !previousMentionSet.has(uid));

  if (newlyMentionedUids.length === 0) {
    return { deliveredCount: 0, mentionedUids: nextMentionUids };
  }

  const notificationId = buildNotificationId(
    input.workspaceId,
    input.entityType,
    input.entityId,
  );
  const entityPath = normalizePath(input.entityPath);
  const preview = buildPreview(
    normalizeText(input.mentionText) || normalizeText(input.entityTitle),
  );

  let deliveredCount = 0;
  let batch = adminDb.batch();
  let batchWrites = 0;

  for (const uid of newlyMentionedUids) {
    const target = memberIndex.byUid.get(uid);
    if (!target) continue;
    if (target.uid === input.actorUid) continue;

    const notificationRef = adminDb
      .collection("users")
      .doc(target.uid)
      .collection("notifications")
      .doc(notificationId);

    batch.set(
      notificationRef,
      {
        id: notificationId,
        type: "mention",
        status: "unread",
        readAt: null,
        workspaceId: input.workspaceId,
        workspaceSlug: input.workspaceSlug,
        workspaceName: input.workspaceName,
        entityType: input.entityType,
        entityId: input.entityId,
        entityTitle: normalizeText(input.entityTitle) || `${input.entityType} ${input.entityId}`,
        entityPath,
        preview,
        mentionedByUid: input.actorUid,
        mentionedByName: normalizeText(input.actorName) || "Workspace User",
        recipientUid: target.uid,
        recipientEmail: target.email,
        createdAt: input.now,
        updatedAt: input.now,
      },
      { merge: true },
    );

    deliveredCount += 1;
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

  return {
    deliveredCount,
    mentionedUids: nextMentionUids,
  };
}
