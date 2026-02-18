import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function normalizeWorkspaceSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function authenticateUid(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  const decodedSession = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decodedSession.uid;
}

export async function GET(request: NextRequest) {
  try {
    const uid = await authenticateUid(request);
    const rawSlug = normalizeText(request.nextUrl.searchParams.get("slug"));
    const workspaceSlug = normalizeWorkspaceSlug(rawSlug);

    if (!workspaceSlug) {
      return NextResponse.json({ error: "Workspace slug is required." }, { status: 400 });
    }

    const slugRef = adminDb.collection("workspaceSlugs").doc(workspaceSlug);
    const slugSnapshot = await slugRef.get();

    if (slugSnapshot.exists) {
      const createdBy = normalizeText(slugSnapshot.get("createdBy"));
      const workspaceId = normalizeText(slugSnapshot.get("workspaceId"));

      if (createdBy && createdBy === uid) {
        return NextResponse.json({
          slug: workspaceSlug,
          available: true,
          reason: "Slug already belongs to your workspace.",
        });
      }

      return NextResponse.json({
        slug: workspaceSlug,
        available: false,
        reason: workspaceId
          ? "Workspace slug is already taken."
          : "Workspace slug mapping is invalid. Choose another slug.",
      });
    }

    const workspaceQuerySnapshot = await adminDb
      .collection("workspaces")
      .where("slug", "==", workspaceSlug)
      .limit(1)
      .get();

    if (!workspaceQuerySnapshot.empty) {
      const workspaceSnapshot = workspaceQuerySnapshot.docs[0]!;
      const createdBy = normalizeText(workspaceSnapshot.get("createdBy"));
      if (createdBy && createdBy === uid) {
        return NextResponse.json({
          slug: workspaceSlug,
          available: true,
          reason: "Slug already belongs to your workspace.",
        });
      }

      return NextResponse.json({
        slug: workspaceSlug,
        available: false,
        reason: "Workspace slug is already taken.",
      });
    }

    return NextResponse.json({
      slug: workspaceSlug,
      available: true,
      reason: "Slug is available.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to validate workspace slug.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
