import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { parseWorkspaceMemberRole } from "@/lib/auth/permissions";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
  }>;
};

type NotificationValues = {
  meetingDigests: boolean;
  actionReminders: boolean;
  weeklySummary: boolean;
  productAnnouncements: boolean;
};

type PatchWorkspaceProfileBody = {
  displayName?: string;
  jobTitle?: string;
  notifications?: Partial<NotificationValues>;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDisplayName(value: unknown) {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, 80);
}

function normalizeJobTitle(value: unknown) {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, 120);
}

function normalizeNotifications(
  value: Partial<NotificationValues> | undefined,
  fallback?: Partial<NotificationValues>,
): NotificationValues {
  return {
    meetingDigests:
      value?.meetingDigests ?? fallback?.meetingDigests ?? true,
    actionReminders:
      value?.actionReminders ?? fallback?.actionReminders ?? true,
    weeklySummary:
      value?.weeklySummary ?? fallback?.weeklySummary ?? false,
    productAnnouncements:
      value?.productAnnouncements ?? fallback?.productAnnouncements ?? true,
  };
}

function hasNotificationChanges(a: NotificationValues, b: NotificationValues) {
  return (
    a.meetingDigests !== b.meetingDigests ||
    a.actionReminders !== b.actionReminders ||
    a.weeklySummary !== b.weeklySummary ||
    a.productAnnouncements !== b.productAnnouncements
  );
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function patchHandler(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspaceBySlug(workspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
    const memberRef = workspaceRef.collection("members").doc(uid);
    const memberSnapshot = await memberRef.get();
    if (!memberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const body = (await request.json()) as PatchWorkspaceProfileBody;
    const nextDisplayName = normalizeDisplayName(body.displayName);
    const nextJobTitle = normalizeJobTitle(body.jobTitle);
    if (!nextDisplayName) {
      return NextResponse.json(
        { error: "Workspace display name is required." },
        { status: 400 },
      );
    }

    const currentDisplayName = normalizeDisplayName(memberSnapshot.get("displayName"));
    const currentJobTitle = normalizeJobTitle(memberSnapshot.get("jobTitle"));
    const currentNotifications = normalizeNotifications(
      memberSnapshot.get("notifications") as Partial<NotificationValues> | undefined,
    );
    const nextNotifications = normalizeNotifications(
      body.notifications,
      currentNotifications,
    );
    const email = normalizeText(memberSnapshot.get("email"));
    const role = parseWorkspaceMemberRole(memberSnapshot.get("role"));
    const status = normalizeText(memberSnapshot.get("status")) || "active";
    const updated =
      currentDisplayName !== nextDisplayName ||
      currentJobTitle !== nextJobTitle ||
      hasNotificationChanges(currentNotifications, nextNotifications);

    if (updated) {
      await memberRef.set(
        {
          displayName: nextDisplayName,
          jobTitle: nextJobTitle,
          notifications: nextNotifications,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    }

    return NextResponse.json({
      ok: true,
      updated,
      profile: {
        displayName: nextDisplayName,
        jobTitle: nextJobTitle,
        notifications: nextNotifications,
        email,
        role,
        status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update workspace profile.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const PATCH = withWriteGuardrails(
  {
    routeId: "workspace.profile.update",
  },
  patchHandler,
);
