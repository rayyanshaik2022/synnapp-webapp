#!/usr/bin/env node

import nextEnv from "@next/env";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const { loadEnvConfig } = nextEnv;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNotifications(input, fallback = undefined) {
  return {
    meetingDigests: input?.meetingDigests ?? fallback?.meetingDigests ?? true,
    actionReminders: input?.actionReminders ?? fallback?.actionReminders ?? true,
    weeklySummary: input?.weeklySummary ?? fallback?.weeklySummary ?? false,
    productAnnouncements:
      input?.productAnnouncements ?? fallback?.productAnnouncements ?? true,
  };
}

function getAdminConfig() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GCLOUD_PROJECT ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? null;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") ?? null;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const emulatorMode =
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

  const missing = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!emulatorMode && !clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!emulatorMode && !privateKey) missing.push("FIREBASE_PRIVATE_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase Admin env vars: ${missing.join(", ")}. Add them to webapp/.env.local.`,
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey,
    storageBucket,
    emulatorMode,
  };
}

function getAdminDb() {
  if (getApps().length === 0) {
    const config = getAdminConfig();

    if (config.emulatorMode) {
      initializeApp({
        projectId: config.projectId,
        storageBucket: config.storageBucket,
      });
    } else {
      initializeApp({
        credential: cert({
          projectId: config.projectId,
          clientEmail: config.clientEmail,
          privateKey: config.privateKey,
        }),
        projectId: config.projectId,
        storageBucket: config.storageBucket,
      });
    }
  }

  return getFirestore();
}

function createMemberPatch(memberData, userData) {
  const existingJobTitle = normalizeText(memberData?.jobTitle);
  const userJobTitle = normalizeText(userData?.jobTitle);
  const existingNotifications = normalizeNotifications(
    memberData?.notifications,
    undefined,
  );
  const userNotifications = normalizeNotifications(userData?.notifications, undefined);
  const nextNotifications = normalizeNotifications(existingNotifications, userNotifications);

  const patch = {};
  let changed = false;

  if (!existingJobTitle && userJobTitle) {
    patch.jobTitle = userJobTitle;
    changed = true;
  }

  const notificationsChanged =
    memberData?.notifications == null ||
    existingNotifications.meetingDigests !== nextNotifications.meetingDigests ||
    existingNotifications.actionReminders !== nextNotifications.actionReminders ||
    existingNotifications.weeklySummary !== nextNotifications.weeklySummary ||
    existingNotifications.productAnnouncements !== nextNotifications.productAnnouncements;

  if (notificationsChanged) {
    patch.notifications = nextNotifications;
    changed = true;
  }

  return { changed, patch };
}

function shouldUseDryRun(argv) {
  return argv.includes("--dry-run");
}

function logSummary(summary) {
  console.log("");
  console.log("Migration summary:");
  console.log(`- Member docs scanned: ${summary.memberDocsScanned}`);
  console.log(`- Workspace member docs updated: ${summary.memberDocsUpdated}`);
  console.log(`- Workspace member docs unchanged: ${summary.memberDocsUnchanged}`);
  console.log(`- Unique users loaded: ${summary.usersLoaded}`);
  console.log(`- Missing user docs: ${summary.missingUsers}`);
  console.log(`- Batch commits: ${summary.batchCommits}`);
  console.log(`- Mode: ${summary.dryRun ? "dry-run" : "execute"}`);
}

async function main() {
  const appRoot = process.cwd();
  loadEnvConfig(appRoot);

  const dryRun = shouldUseDryRun(process.argv.slice(2));
  const db = getAdminDb();
  const memberSnapshots = await db.collectionGroup("members").get();

  const userCache = new Map();
  const now = Timestamp.now();
  const summary = {
    dryRun,
    memberDocsScanned: memberSnapshots.size,
    memberDocsUpdated: 0,
    memberDocsUnchanged: 0,
    missingUsers: 0,
    usersLoaded: 0,
    batchCommits: 0,
  };

  let batch = db.batch();
  let pendingWrites = 0;
  const BATCH_LIMIT = 400;

  async function flushBatch() {
    if (pendingWrites === 0 || dryRun) {
      pendingWrites = 0;
      batch = db.batch();
      return;
    }

    await batch.commit();
    summary.batchCommits += 1;
    pendingWrites = 0;
    batch = db.batch();
  }

  for (const memberSnapshot of memberSnapshots.docs) {
    const memberData = memberSnapshot.data() ?? {};
    const uid = normalizeText(memberData.uid) || normalizeText(memberSnapshot.id);

    if (!uid) {
      summary.memberDocsUnchanged += 1;
      continue;
    }

    let userData = userCache.get(uid);
    if (userData === undefined) {
      const userSnapshot = await db.collection("users").doc(uid).get();
      if (!userSnapshot.exists) {
        userCache.set(uid, null);
        summary.missingUsers += 1;
        summary.memberDocsUnchanged += 1;
        continue;
      }
      userData = userSnapshot.data() ?? {};
      userCache.set(uid, userData);
      summary.usersLoaded += 1;
    }

    if (!userData) {
      summary.memberDocsUnchanged += 1;
      continue;
    }

    const { changed, patch } = createMemberPatch(memberData, userData);
    if (!changed) {
      summary.memberDocsUnchanged += 1;
      continue;
    }

    summary.memberDocsUpdated += 1;

    if (!dryRun) {
      batch.set(
        memberSnapshot.ref,
        {
          ...patch,
          updatedAt: now,
        },
        { merge: true },
      );
      pendingWrites += 1;

      if (pendingWrites >= BATCH_LIMIT) {
        await flushBatch();
      }
    }
  }

  await flushBatch();
  logSummary(summary);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("Migration failed.");
  console.error(message);
  process.exit(1);
});
