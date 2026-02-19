import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type ProfileRequestBody = {
  fullName?: string;
  phone?: string;
  timezone?: string;
  bio?: string;
};

function normalizeText(value: string | undefined) {
  return value?.trim() ?? "";
}

async function patchHandler(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return NextResponse.json({ error: "Missing session." }, { status: 401 });
  }

  let uid = "";

  try {
    const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
    uid = decodedSession.uid;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid session.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ProfileRequestBody;
    const fullName = normalizeText(body.fullName);
    const phone = normalizeText(body.phone);
    const timezone = normalizeText(body.timezone);
    const bio = normalizeText(body.bio);

    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }

    if (!timezone) {
      return NextResponse.json({ error: "Timezone is required." }, { status: 400 });
    }

    const userRecord = await adminAuth.getUser(uid);
    const now = Timestamp.now();

    if (normalizeText(userRecord.displayName) !== fullName) {
      await adminAuth.updateUser(uid, { displayName: fullName });
    }

    await adminDb
      .collection("users")
      .doc(uid)
      .set(
        {
          uid,
          email: userRecord.email ?? "",
          displayName: fullName,
          phone,
          timezone,
          bio,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      );

    return NextResponse.json({
      ok: true,
      profile: {
        fullName,
        email: userRecord.email ?? "",
        phone,
        timezone,
        bio,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const PATCH = withWriteGuardrails(
  {
    routeId: "profile.update",
  },
  patchHandler,
);
