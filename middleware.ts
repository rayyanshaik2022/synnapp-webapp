import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

const publicRoots = new Set(["", "login", "signup", "onboarding"]);

function isProtectedWorkspacePath(pathname: string) {
  if (pathname === "/" || pathname.startsWith("/api")) return false;
  if (pathname.startsWith("/_next")) return false;
  if (pathname === "/favicon.ico") return false;
  if (pathname.includes(".")) return false;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return false;
  if (publicRoots.has(segments[0] ?? "")) return false;

  return true;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isProtectedWorkspacePath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("redirect", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", `${pathname}${search}`);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
