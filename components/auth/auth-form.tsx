"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  type User,
  updateProfile,
} from "firebase/auth";
import { getFirebaseClientAuth } from "@/lib/firebase/client";

type AuthMode = "login" | "signup";
type SubmitMethod = "email" | "google";
type AuthProvider = "email" | "google";

type AuthFormProps = {
  mode: AuthMode;
};

type FormState = {
  error: string | null;
  notice: string | null;
  submittingMethod: SubmitMethod | null;
};

const initialState: FormState = {
  error: null,
  notice: null,
  submittingMethod: null,
};

const fallbackRedirectPath = "/acme-corp/my-work";
const onboardingPath = "/onboarding";

function resolveRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/")) return fallbackRedirectPath;
  return value;
}

function getAuthErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.includes("Missing Firebase client env vars")) {
    return error.message;
  }

  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "An account already exists with this email.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/popup-closed-by-user":
      return "Google sign-in popup was closed before completing sign-in.";
    case "auth/popup-blocked":
      return "Google sign-in popup was blocked by the browser.";
    case "auth/account-exists-with-different-credential":
      return "An account exists with this email using a different sign-in method.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication settings.";
    case "auth/network-request-failed":
      return "Network request failed. Check your internet connection and try again.";
    case "auth/user-disabled":
      return "This account is disabled. Contact your administrator.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a bit and try again.";
    case "auth/missing-password":
      return "Password is required.";
    default:
      if (error instanceof Error) return error.message;
      return "Authentication failed. Please try again.";
  }
}

async function establishServerSession(user: User) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? "Failed to establish authenticated session.");
  }
}

type AuthMeResponse = {
  onboardingCompleted?: boolean;
  workspaceSlug?: string | null;
  error?: string;
};

function rewriteWorkspacePath(pathname: string, workspaceSlug: string) {
  const segments = pathname.split("/").filter(Boolean);
  const root = segments[0] ?? "";
  if (root === "invite") {
    return pathname;
  }

  if (segments.length >= 2) {
    return `/${workspaceSlug}/${segments.slice(1).join("/")}`;
  }

  return `/${workspaceSlug}/my-work`;
}

async function resolvePostAuthDestination(
  provider: AuthProvider,
  redirectPath: string,
) {
  const isInviteRedirect = redirectPath.startsWith("/invite/");
  const response = await fetch("/api/auth/me", { method: "GET" });
  const body = (await response.json().catch(() => null)) as AuthMeResponse | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "Failed to load account onboarding status.");
  }

  const onboardingCompleted = body?.onboardingCompleted === true;
  const workspaceSlug =
    typeof body?.workspaceSlug === "string" && body.workspaceSlug.trim().length > 0
      ? body.workspaceSlug.trim()
      : null;

  if (isInviteRedirect) {
    return redirectPath;
  }

  if (!onboardingCompleted) {
    return `${onboardingPath}?provider=${provider}&redirect=${encodeURIComponent(redirectPath)}`;
  }

  if (workspaceSlug) {
    if (redirectPath === fallbackRedirectPath) {
      return `/${workspaceSlug}/my-work`;
    }

    return rewriteWorkspacePath(redirectPath, workspaceSlug);
  }

  return redirectPath;
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<FormState>(initialState);
  const [emailInput, setEmailInput] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
  const isSignUp = mode === "signup";
  const isSubmitting = state.submittingMethod !== null;
  const isBusy = isSubmitting || isSendingReset;
  const redirectPath = resolveRedirectPath(searchParams.get("redirect"));
  const modeSwitchRedirect = searchParams.get("redirect");
  const modeSwitchHref =
    modeSwitchRedirect && modeSwitchRedirect.startsWith("/")
      ? `${isSignUp ? "/login" : "/signup"}?redirect=${encodeURIComponent(modeSwitchRedirect)}`
      : isSignUp
        ? "/login"
        : "/signup";

  const title = isSignUp ? "Create an account" : "Sign in";
  const subtitle = isSignUp
    ? "Set up your credentials to access your workspace."
    : "Enter your credentials to access your workspace.";

  const emailSubmitLabel = useMemo(() => {
    if (state.submittingMethod === "email") return "Working...";
    return isSignUp ? "Create account" : "Sign in";
  }, [isSignUp, state.submittingMethod]);

  const googleActionLabel = isSignUp ? "Sign up with Google" : "Continue with Google";
  const googleSubmitLabel =
    state.submittingMethod === "google" ? "Opening..." : googleActionLabel;

  function setValidationError(error: string) {
    setState({
      error,
      notice: null,
      submittingMethod: null,
    });
  }

  async function handleSubmitWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setEmailInput(email);

    if (!email || !password) {
      setValidationError("Email and password are required.");
      return;
    }

    if (isSignUp) {
      const fullName = String(formData.get("fullName") ?? "").trim();
      const confirmPassword = String(formData.get("confirmPassword") ?? "");
      const acceptedTerms = formData.get("terms");

      if (!fullName) {
        setValidationError("Full name is required.");
        return;
      }

      if (password.length < 6) {
        setValidationError("Password must be at least 6 characters.");
        return;
      }

      if (password !== confirmPassword) {
        setValidationError("Passwords do not match.");
        return;
      }

      if (!acceptedTerms) {
        setValidationError("Please accept the terms to continue.");
        return;
      }
    }

    setState({ error: null, notice: null, submittingMethod: "email" });

    try {
      const auth = getFirebaseClientAuth();

      if (isSignUp) {
        await setPersistence(auth, browserLocalPersistence);
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const fullName = String(formData.get("fullName") ?? "").trim();
        if (fullName) {
          await updateProfile(credential.user, { displayName: fullName });
        }
        await establishServerSession(credential.user);
      } else {
        const remember = Boolean(formData.get("remember"));
        await setPersistence(
          auth,
          remember ? browserLocalPersistence : browserSessionPersistence,
        );
        const credential = await signInWithEmailAndPassword(auth, email, password);
        await establishServerSession(credential.user);
      }

      const destination = await resolvePostAuthDestination("email", redirectPath);

      setState({
        error: null,
        notice: isSignUp ? "Account created. Redirecting..." : "Signed in. Redirecting...",
        submittingMethod: null,
      });
      router.replace(destination);
    } catch (error) {
      setState({
        error: getAuthErrorMessage(error),
        notice: null,
        submittingMethod: null,
      });
    }
  }

  async function handleContinueWithGoogle() {
    setState({ error: null, notice: null, submittingMethod: "google" });

    try {
      const auth = getFirebaseClientAuth();
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      await establishServerSession(credential.user);
      const destination = await resolvePostAuthDestination("google", redirectPath);

      setState({
        error: null,
        notice: "Google authentication successful. Redirecting...",
        submittingMethod: null,
      });
      router.replace(destination);
    } catch (error) {
      setState({
        error: getAuthErrorMessage(error),
        notice: null,
        submittingMethod: null,
      });
    }
  }

  async function handleForgotPassword() {
    const email = emailInput.trim();
    if (!email) {
      setValidationError("Enter your email address first, then choose Forgot password.");
      return;
    }

    setIsSendingReset(true);
    setState({ error: null, notice: null, submittingMethod: null });

    try {
      const auth = getFirebaseClientAuth();
      await sendPasswordResetEmail(auth, email);
      setState({
        error: null,
        notice: `If an account exists for ${email}, a reset email has been sent.`,
        submittingMethod: null,
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "";

      if (code === "auth/user-not-found" || code === "auth/invalid-email") {
        setState({
          error: null,
          notice: `If an account exists for ${email}, a reset email has been sent.`,
          submittingMethod: null,
        });
      } else {
        setState({
          error: getAuthErrorMessage(error),
          notice: null,
          submittingMethod: null,
        });
      }
    } finally {
      setIsSendingReset(false);
    }
  }

  return (
    <section className="border border-slate-200 bg-[color:var(--surface)] p-6 sm:p-7">
      <div className="mb-7 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">ACCESS</p>
          <span className="rounded-sm border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-cyan-800">
            FIREBASE AUTH
          </span>
        </div>

        <div className="flex items-center gap-6 border-b border-slate-200 text-sm">
          <Link
            href="/login"
            className={`relative pb-2 font-semibold transition ${
              !isSignUp ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Sign in
            {!isSignUp ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[color:var(--accent)]" />
            ) : null}
          </Link>
          <Link
            href="/signup"
            className={`relative pb-2 font-semibold transition ${
              isSignUp ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Sign up
            {isSignUp ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[color:var(--accent)]" />
            ) : null}
          </Link>
        </div>

        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-4">
        <button
          type="button"
          onClick={handleContinueWithGoogle}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-2 rounded-sm border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Image src="/google-g.svg" alt="" width={18} height={18} aria-hidden="true" />
          <span>{googleSubmitLabel}</span>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-[color:var(--surface)] px-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
              or continue with email
            </span>
          </div>
        </div>
      </div>

      <form className="mt-4 space-y-4" onSubmit={handleSubmitWithEmail}>
        {isSignUp ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
              Full name
            </span>
            <input
              name="fullName"
              type="text"
              autoComplete="name"
              placeholder="Jordan Lee"
              className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-cyan-100"
            />
          </label>
        ) : null}

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Email
          </span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            value={emailInput}
            onChange={(event) => setEmailInput(event.target.value)}
            placeholder="you@company.com"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-cyan-100"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Password
          </span>
          <input
            name="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            placeholder={isSignUp ? "Create a strong password" : "Enter your password"}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-cyan-100"
          />
        </label>

        {isSignUp ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
              Confirm password
            </span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900 outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-cyan-100"
            />
          </label>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
              <input
                type="checkbox"
                name="remember"
                className="h-4 w-4 rounded-sm border-slate-300 text-[color:var(--accent)] focus:ring-[color:var(--accent)]"
              />
              Keep me signed in
            </label>
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={isBusy}
              className="text-sm text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900"
            >
              {isSendingReset ? "Sending..." : "Forgot password?"}
            </button>
          </div>
        )}

        {isSignUp ? (
          <label className="flex items-start gap-2 rounded-sm border border-slate-200 bg-[color:var(--surface-soft)] px-3 py-2.5 text-sm text-[color:var(--muted)]">
            <input
              type="checkbox"
              name="terms"
              className="mt-0.5 h-4 w-4 rounded-sm border-slate-300 text-[color:var(--accent)] focus:ring-[color:var(--accent)]"
            />
            I agree to the terms and privacy policy.
          </label>
        ) : null}

        {state.error ? (
          <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        ) : null}

        {state.notice ? (
          <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
            {state.notice}
          </p>
        ) : null}

        <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Live Firebase auth is enabled. Ensure your domain is authorized in Firebase Auth settings.
        </p>

        <button
          type="submit"
          disabled={isBusy}
          className="w-full rounded-sm bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.07em] text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {emailSubmitLabel}
        </button>
      </form>

      <p className="mt-6 text-sm text-[color:var(--muted)]">
        {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
        <Link
          href={modeSwitchHref}
          className="font-semibold text-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </section>
  );
}
