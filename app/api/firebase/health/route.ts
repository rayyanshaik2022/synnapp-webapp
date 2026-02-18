import { NextResponse } from "next/server";

import { adminDb, getFirebaseAdminApp } from "@/lib/firebase/admin";

const clientEnvKeys = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

export async function GET() {
  const missingClientEnv = clientEnvKeys.filter((key) => !process.env[key]);

  try {
    const adminApp = getFirebaseAdminApp();

    // Lightweight check that the admin credentials can reach Firestore.
    await adminDb.listCollections();

    return NextResponse.json({
      ok: true,
      projectId: adminApp.options.projectId ?? null,
      missingClientEnv,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Unknown Firebase error",
        missingClientEnv,
      },
      { status: 500 },
    );
  }
}
