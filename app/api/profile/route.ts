import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

type NotificationValues = {
  meetingDigests: boolean;
  actionReminders: boolean;
  weeklySummary: boolean;
  productAnnouncements: boolean;
};

type ProfileRequestBody = {
  fullName?: string;
  jobTitle?: string;
  phone?: string;
  timezone?: string;
  bio?: string;
  notifications?: Partial<NotificationValues>;
};

function normalizeText(value: string | undefined) {
  return value?.trim() ?? "";
}

function buildNotificationValues(
  input: Partial<NotificationValues> | undefined,
): NotificationValues {
  return {
    meetingDigests: input?.meetingDigests !== false,
    actionReminders: input?.actionReminders !== false,
    weeklySummary: input?.weeklySummary === true,
    productAnnouncements: input?.productAnnouncements !== false,
  };
}

function isFailedPreconditionError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;

  if (code === 9 || code === "FAILED_PRECONDITION" || code === "failed-precondition") {
    return true;
  }

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("FAILED_PRECONDITION") ||
    message.includes("failed-precondition") ||
    message.includes("requires an index")
  );
}

export async function PATCH(request: NextRequest) {
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
    const jobTitle = normalizeText(body.jobTitle);
    const phone = normalizeText(body.phone);
    const timezone = normalizeText(body.timezone);
    const bio = normalizeText(body.bio);
    const notifications = buildNotificationValues(body.notifications);

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
          jobTitle,
          phone,
          timezone,
          bio,
          notifications,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      );

    try {
      const memberSnapshots = await adminDb
        .collectionGroup("members")
        .where("uid", "==", uid)
        .get();

      if (!memberSnapshots.empty) {
        const batch = adminDb.batch();
        memberSnapshots.docs.forEach((memberSnapshot) => {
          batch.set(
            memberSnapshot.ref,
            {
              displayName: fullName,
              updatedAt: now,
            },
            { merge: true },
          );
        });
        await batch.commit();
      }
    } catch (error) {
      if (!isFailedPreconditionError(error)) {
        throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      profile: {
        fullName,
        email: userRecord.email ?? "",
        jobTitle,
        phone,
        timezone,
        bio,
      },
      notifications,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
