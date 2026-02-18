import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";
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
    memberUid: string;
  }>;
};

type UpdateMemberBody = {
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

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

async function resolveMembershipContext(
  uid: string,
  workspaceSlug: string,
  memberUid: string,
) {
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);
  if (!workspace) {
    return { error: "Workspace not found.", status: 404 as const };
  }

  const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
  const actorMemberRef = workspaceRef.collection("members").doc(uid);
  const targetMemberRef = workspaceRef.collection("members").doc(memberUid);
  const [actorMemberSnapshot, targetMemberSnapshot] = await Promise.all([
    actorMemberRef.get(),
    targetMemberRef.get(),
  ]);

  if (!actorMemberSnapshot.exists) {
    return { error: "Access denied.", status: 403 as const };
  }

  const actorRole = normalizeRole(actorMemberSnapshot.get("role")) || "member";
  if (!canManageWorkspaceMembers(actorRole)) {
    return {
      error: "Only owners and admins can manage members.",
      status: 403 as const,
    };
  }

  if (!targetMemberSnapshot.exists) {
    return { error: "Member not found.", status: 404 as const };
  }

  const targetRole = normalizeRole(targetMemberSnapshot.get("role")) || "member";

  return {
    workspace,
    workspaceRef,
    actorRole,
    targetRole,
    targetMemberRef,
  };
}

async function countWorkspaceOwners(
  workspaceRef: DocumentReference<DocumentData>,
) {
  const ownerSnapshots = await workspaceRef.collection("members").where("role", "==", "owner").get();
  return ownerSnapshots.size;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { workspaceSlug, memberUid } = await context.params;
    const membershipContext = await resolveMembershipContext(uid, workspaceSlug, memberUid);

    if ("error" in membershipContext) {
      return NextResponse.json(
        { error: membershipContext.error },
        { status: membershipContext.status },
      );
    }

    const body = (await request.json()) as UpdateMemberBody;
    const nextRole = normalizeRole(body.role);

    if (!nextRole) {
      return NextResponse.json({ error: "Valid role is required." }, { status: 400 });
    }

    if (membershipContext.targetRole === nextRole) {
      return NextResponse.json({ ok: true, updated: false });
    }

    if (memberUid === uid) {
      return NextResponse.json(
        { error: "You cannot change your own role." },
        { status: 400 },
      );
    }

    if (membershipContext.targetRole === "owner" && membershipContext.actorRole !== "owner") {
      return NextResponse.json(
        { error: "Only owners can modify owner memberships." },
        { status: 403 },
      );
    }

    if (nextRole === "owner" && membershipContext.actorRole !== "owner") {
      return NextResponse.json(
        { error: "Only owners can promote members to owner." },
        { status: 403 },
      );
    }

    if (membershipContext.targetRole === "owner" && nextRole !== "owner") {
      const ownerCount = await countWorkspaceOwners(membershipContext.workspaceRef);
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "Workspace must have at least one owner." },
          { status: 400 },
        );
      }
    }

    const now = Timestamp.now();
    await membershipContext.targetMemberRef.set(
      {
        role: nextRole,
        status: "active",
        updatedAt: now,
      },
      { merge: true },
    );

    const updatedSnapshot = await membershipContext.targetMemberRef.get();
    const updatedDisplayName = normalizeText(updatedSnapshot.get("displayName"));
    const updatedEmail = normalizeEmail(updatedSnapshot.get("email"));

    return NextResponse.json({
      ok: true,
      updated: true,
      member: {
        uid: memberUid,
        displayName: updatedDisplayName || updatedEmail || "Workspace Member",
        email: updatedEmail,
        role: nextRole,
        status: normalizeText(updatedSnapshot.get("status")) || "active",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update member role.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const uid = await authenticateUid(request);
    const { workspaceSlug, memberUid } = await context.params;
    const membershipContext = await resolveMembershipContext(uid, workspaceSlug, memberUid);

    if ("error" in membershipContext) {
      return NextResponse.json(
        { error: membershipContext.error },
        { status: membershipContext.status },
      );
    }

    if (memberUid === uid) {
      return NextResponse.json(
        { error: "You cannot remove your own membership." },
        { status: 400 },
      );
    }

    if (membershipContext.targetRole === "owner") {
      if (membershipContext.actorRole !== "owner") {
        return NextResponse.json(
          { error: "Only owners can remove an owner." },
          { status: 403 },
        );
      }

      const ownerCount = await countWorkspaceOwners(membershipContext.workspaceRef);
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "Workspace must have at least one owner." },
          { status: 400 },
        );
      }
    }

    await membershipContext.targetMemberRef.delete();

    const userRef = adminDb.collection("users").doc(memberUid);
    const userSnapshot = await userRef.get();
    const currentDefaultWorkspaceId = normalizeText(userSnapshot.get("defaultWorkspaceId"));
    const now = Timestamp.now();

    const userUpdate: Record<string, unknown> = {
      workspaceSlugs: FieldValue.arrayRemove(membershipContext.workspace.workspaceSlug),
      updatedAt: now,
    };

    if (currentDefaultWorkspaceId === membershipContext.workspace.workspaceId) {
      let fallbackWorkspaceId = "";

      try {
        const remainingMemberships = await adminDb
          .collectionGroup("members")
          .where("uid", "==", memberUid)
          .get();

        fallbackWorkspaceId =
          remainingMemberships.docs
            .map((memberSnapshot) => memberSnapshot.ref.parent.parent?.id ?? "")
            .map((workspaceId) => normalizeText(workspaceId))
            .find(Boolean) ?? "";
      } catch (error) {
        if (!isFailedPreconditionError(error)) {
          throw error;
        }
      }

      userUpdate.defaultWorkspaceId = fallbackWorkspaceId || FieldValue.delete();
    }

    await userRef.set(userUpdate, { merge: true });

    return NextResponse.json({
      ok: true,
      removed: true,
      memberUid,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove member.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
