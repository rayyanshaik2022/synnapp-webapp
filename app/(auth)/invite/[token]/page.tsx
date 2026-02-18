import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { InviteAcceptCard } from "@/components/auth/invite-accept-card";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth } from "@/lib/firebase/admin";

type InvitePageProps = Readonly<{
  params: Promise<{
    token: string;
  }>;
}>;

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function buildLoginPath(token: string) {
  const redirectPath = `/invite/${token}`;
  return `/login?redirect=${encodeURIComponent(redirectPath)}`;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const normalizedToken = normalizeText(token);

  if (!normalizedToken) {
    redirect("/login");
  }

  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    redirect(buildLoginPath(normalizedToken));
  }

  try {
    await adminAuth.verifySessionCookie(sessionCookie, true);
  } catch {
    redirect(buildLoginPath(normalizedToken));
  }

  return <InviteAcceptCard token={normalizedToken} />;
}
