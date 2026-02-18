"use client";

import { ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getFirebaseClientAuth } from "@/lib/firebase/client";

type SignOutButtonProps = {
  className?: string;
  children?: ReactNode;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Failed to sign out. Please try again.";
}

export function SignOutButton({ className, children }: SignOutButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearServerSession() {
    const response = await fetch("/api/auth/session", { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(body?.error ?? "Failed to clear server session.");
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true);
    setError(null);

    const firebaseSignOut = (async () => {
      const auth = getFirebaseClientAuth();
      await signOut(auth);
    })();

    const [, sessionResult] = await Promise.allSettled([
      firebaseSignOut,
      clearServerSession(),
    ]);

    if (sessionResult.status === "rejected") {
      setError(getErrorMessage(sessionResult.reason));
      setIsSubmitting(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSubmitting}
        className={className}
      >
        {isSubmitting ? "Signing out..." : (children ?? "Sign out")}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </>
  );
}
