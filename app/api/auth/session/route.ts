import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

type SessionRequestBody = {
  idToken?: string;
};

export async function POST(request: NextRequest) {
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

export async function DELETE() {
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
