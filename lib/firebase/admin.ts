import "server-only";

import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type AdminConfig = {
  projectId: string;
  clientEmail: string | null;
  privateKey: string | null;
  storageBucket?: string;
  emulatorMode: boolean;
  hasServiceAccountCredential: boolean;
};

function getAdminConfig(): AdminConfig {
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
  const hasServiceAccountCredential = Boolean(clientEmail && privateKey);

  const missing: string[] = [];

  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!emulatorMode && clientEmail && !privateKey) missing.push("FIREBASE_PRIVATE_KEY");
  if (!emulatorMode && privateKey && !clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");

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
    hasServiceAccountCredential,
  };
}

export function getFirebaseAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const config = getAdminConfig();

  if (config.emulatorMode) {
    return initializeApp({
      projectId: config.projectId,
      storageBucket: config.storageBucket,
    });
  }

  if (config.hasServiceAccountCredential) {
    return initializeApp({
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail!,
        privateKey: config.privateKey!,
      }),
      projectId: config.projectId,
      storageBucket: config.storageBucket,
    });
  }

  // On Firebase App Hosting / Cloud Run, initialize without explicit credentials
  // to use the runtime service account via Application Default Credentials (ADC).
  return initializeApp({
    projectId: config.projectId,
    storageBucket: config.storageBucket,
  });
}

export const adminAuth = getAuth(getFirebaseAdminApp());
export const adminDb = getFirestore(getFirebaseAdminApp());
