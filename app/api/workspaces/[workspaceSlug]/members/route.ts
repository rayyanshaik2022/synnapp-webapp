import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import {
  canManageWorkspaceMembers,
  isWorkspaceMemberRole,
  type WorkspaceMemberRole,
} from "@/lib/auth/permissions";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
  }>;
};

type CreateMemberBody = {
  email?: string;
  role?: WorkspaceMemberRole;
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function normalizeRole(value: string | undefined | null): WorkspaceMemberRole | "" {
  const role = normalizeText(value).toLowerCase();
  if (isWorkspaceMemberRole(role)) {
    return role;
  }
  return "";
}

function normalizeEmail(value: string | undefined | null) {
  return normalizeText(value).toLowerCase();
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

function parseDate(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspaceBySlug(workspaceSlug);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
    const actorMemberSnapshot = await workspaceRef.collection("members").doc(uid).get();
    if (!actorMemberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const actorRole = normalizeRole(actorMemberSnapshot.get("role")) || "member";
    const memberSnapshots = await workspaceRef.collection("members").get();

    const members = memberSnapshots.docs
      .map((memberSnapshot) => {
        const memberUid = normalizeText(memberSnapshot.get("uid")) || memberSnapshot.id;
        const role = normalizeRole(memberSnapshot.get("role")) || "member";
        const displayName = normalizeText(memberSnapshot.get("displayName"));
        const email = normalizeEmail(memberSnapshot.get("email"));
        const status = normalizeText(memberSnapshot.get("status")) || "active";

        return {
          uid: memberUid,
          displayName: displayName || email || "Workspace Member",
          email,
          role,
          status,
          joinedAt: parseDate(memberSnapshot.get("joinedAt")),
          updatedAt: parseDate(memberSnapshot.get("updatedAt")),
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({
      workspaceId: workspace.workspaceId,
      workspaceSlug: workspace.workspaceSlug,
      actorUid: uid,
      actorRole,
      canManageMembers: canManageWorkspaceMembers(actorRole),
      members,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load members.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspaceBySlug(workspaceSlug);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
    const actorMemberSnapshot = await workspaceRef.collection("members").doc(uid).get();
    if (!actorMemberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const actorRole = normalizeRole(actorMemberSnapshot.get("role")) || "member";
    if (!canManageWorkspaceMembers(actorRole)) {
      return NextResponse.json(
        { error: "Only owners and admins can manage members." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CreateMemberBody;
    const email = normalizeEmail(body.email);
    const role = normalizeRole(body.role) || "member";

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    if (role === "owner" && actorRole !== "owner") {
      return NextResponse.json(
        { error: "Only owners can add another owner." },
        { status: 403 },
      );
    }

    let targetUser;
    try {
      targetUser = await adminAuth.getUserByEmail(email);
    } catch (error) {
      const message = error instanceof Error ? error.message : "User not found.";
      return NextResponse.json(
        { error: `User not found for ${email}. Ask them to sign up first.` },
        { status: message.includes("user-not-found") ? 404 : 500 },
      );
    }

    const targetUid = targetUser.uid;
    const targetDisplayName =
      normalizeText(targetUser.displayName) || normalizeText(email.split("@")[0]);
    const now = Timestamp.now();
    const memberRef = workspaceRef.collection("members").doc(targetUid);
    const userRef = adminDb.collection("users").doc(targetUid);

    let created = false;

    await adminDb.runTransaction(async (transaction) => {
      const memberSnapshot = await transaction.get(memberRef);
      const userSnapshot = await transaction.get(userRef);
      created = !memberSnapshot.exists;

      const joinedAt = memberSnapshot.get("joinedAt") ?? now;

      transaction.set(
        memberRef,
        {
          uid: targetUid,
          role,
          status: "active",
          displayName: targetDisplayName || email,
          email,
          invitedBy: uid,
          joinedAt,
          updatedAt: now,
        },
        { merge: true },
      );

      const defaultWorkspaceId = normalizeText(userSnapshot.get("defaultWorkspaceId"));
      transaction.set(
        userRef,
        {
          uid: targetUid,
          email,
          displayName: targetDisplayName || email,
          workspaceSlugs: FieldValue.arrayUnion(workspace.workspaceSlug),
          defaultWorkspaceId: defaultWorkspaceId || workspace.workspaceId,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true },
      );
    });

    return NextResponse.json({
      ok: true,
      created,
      member: {
        uid: targetUid,
        displayName: targetDisplayName || email,
        email,
        role,
        status: "active",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add member.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
