import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentReference } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import { canUpdateWorkspaceSlug, parseWorkspaceMemberRole } from "@/lib/auth/permissions";

type UpdateWorkspaceSlugBody = {
  slug?: string;
};

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
  }>;
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function normalizeSlug(value: string | undefined | null) {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug;
}

function parseSlugList(value: unknown) {
  if (!Array.isArray(value)) return [];

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeText(entry);
    if (!normalized) continue;
    unique.add(normalized);
  }

  return Array.from(unique);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
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
    const { workspaceSlug: requestedWorkspaceSlug } = await context.params;
    const body = (await request.json()) as UpdateWorkspaceSlugBody;
    const nextWorkspaceSlug = normalizeSlug(body.slug);

    if (!nextWorkspaceSlug) {
      return NextResponse.json(
        { error: "Workspace slug is required." },
        { status: 400 },
      );
    }

    const workspace = await resolveWorkspaceBySlug(requestedWorkspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
    const memberRef = workspaceRef.collection("members").doc(uid);
    const memberSnapshot = await memberRef.get();

    if (!memberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const membershipRole = parseWorkspaceMemberRole(memberSnapshot.get("role"));
    if (!canUpdateWorkspaceSlug(membershipRole)) {
      return NextResponse.json(
        { error: "Only owners and admins can update the workspace slug." },
        { status: 403 },
      );
    }

    const now = Timestamp.now();
    const newSlugRef = adminDb.collection("workspaceSlugs").doc(nextWorkspaceSlug);
    let previousWorkspaceSlug = workspace.workspaceSlug;
    let createdBy = uid;
    let updated = false;

    await adminDb.runTransaction(async (transaction) => {
      const workspaceSnapshot = await transaction.get(workspaceRef);
      if (!workspaceSnapshot.exists) {
        throw new Error("WORKSPACE_NOT_FOUND");
      }

      const currentWorkspaceSlug = normalizeSlug(workspaceSnapshot.get("slug"));
      if (currentWorkspaceSlug) {
        previousWorkspaceSlug = currentWorkspaceSlug;
      }

      const previousSlugRef = adminDb
        .collection("workspaceSlugs")
        .doc(previousWorkspaceSlug);
      const [newSlugSnapshot, previousSlugSnapshot] = await Promise.all([
        transaction.get(newSlugRef),
        transaction.get(previousSlugRef),
      ]);

      if (newSlugSnapshot.exists) {
        const mappedWorkspaceId = normalizeText(newSlugSnapshot.get("workspaceId"));
        if (mappedWorkspaceId && mappedWorkspaceId !== workspace.workspaceId) {
          throw new Error("SLUG_ALREADY_TAKEN");
        }
      }

      const existingCreatedBy = normalizeText(previousSlugSnapshot.get("createdBy"));
      if (existingCreatedBy) {
        createdBy = existingCreatedBy;
      }

      if (previousWorkspaceSlug === nextWorkspaceSlug) {
        return;
      }

      updated = true;

      transaction.set(
        workspaceRef,
        {
          slug: nextWorkspaceSlug,
          updatedAt: now,
        },
        { merge: true },
      );

      transaction.set(
        newSlugRef,
        {
          slug: nextWorkspaceSlug,
          workspaceId: workspace.workspaceId,
          createdBy,
          createdAt: previousSlugSnapshot.get("createdAt") ?? now,
          updatedAt: now,
        },
        { merge: true },
      );

      if (previousWorkspaceSlug !== nextWorkspaceSlug && previousSlugSnapshot.exists) {
        const mappedWorkspaceId = normalizeText(previousSlugSnapshot.get("workspaceId"));
        if (!mappedWorkspaceId || mappedWorkspaceId === workspace.workspaceId) {
          transaction.delete(previousSlugRef);
        }
      }
    });

    if (updated) {
      const memberSnapshots = await workspaceRef.collection("members").get();
      if (!memberSnapshots.empty) {
        const userRefs = memberSnapshots.docs
          .map((memberSnapshot) => {
            const memberUid =
              normalizeText(memberSnapshot.get("uid")) || memberSnapshot.id;
            if (!memberUid) return null;
            return adminDb.collection("users").doc(memberUid);
          })
          .filter((userRef): userRef is DocumentReference => Boolean(userRef));

        if (userRefs.length > 0) {
          const userSnapshots = await adminDb.getAll(...userRefs);
          const batch = adminDb.batch();

          userSnapshots.forEach((userSnapshot) => {
            const existingSlugs = parseSlugList(userSnapshot.get("workspaceSlugs"));
            const withoutPrevious = existingSlugs.filter(
              (workspaceSlug) => workspaceSlug !== previousWorkspaceSlug,
            );
            const nextSlugs = Array.from(
              new Set([...withoutPrevious, nextWorkspaceSlug]),
            );

            batch.set(
              userSnapshot.ref,
              {
                workspaceSlugs: nextSlugs,
                updatedAt: now,
              },
              { merge: true },
            );
          });

          await batch.commit();
        }
      }
    }

    return NextResponse.json({
      ok: true,
      updated,
      workspaceId: workspace.workspaceId,
      previousWorkspaceSlug,
      workspaceSlug: nextWorkspaceSlug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update workspace slug.";

    if (message === "WORKSPACE_NOT_FOUND") {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    if (message === "SLUG_ALREADY_TAKEN") {
      return NextResponse.json(
        { error: "Workspace slug is already taken." },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
