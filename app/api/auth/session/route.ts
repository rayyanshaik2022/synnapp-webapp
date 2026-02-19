import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { withWriteGuardrails } from "@/lib/api/write-guardrails";

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

type SessionRequestBody = {
  idToken?: string;
};

async function postHandler(request: NextRequest) {
  try {
    const body = (await request.json()) as SessionRequestBody;
    const idToken = body.idToken?.trim();

    if (!idToken) {
      return NextResponse.json({ error: "Missing idToken." }, { status: 400 });
    }

    await adminAuth.verifyIdToken(idToken);

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionCookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to establish session.";

    return NextResponse.json({ error: message }, { status: 401 });
  }
}

async function deleteHandler() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export const POST = withWriteGuardrails(
  {
    routeId: "auth.session.create",
    rateLimit: {
      maxRequests: 30,
      windowSeconds: 60,
      scope: "ip",
    },
  },
  postHandler,
);

export const DELETE = withWriteGuardrails(
  {
    routeId: "auth.session.delete",
    rateLimit: {
      maxRequests: 60,
      windowSeconds: 60,
    },
  },
  deleteHandler,
);
