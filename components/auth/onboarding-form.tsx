"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFirebaseClientAuth } from "@/lib/firebase/client";
import { updateProfile } from "firebase/auth";

function slugifyWorkspaceName(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "my-workspace";
}

type SubmitState = {
  error: string | null;
  submitting: boolean;
};

type SlugAvailabilityState = {
  status: "idle" | "checking" | "available" | "unavailable" | "error";
  message: string;
};

const initialSubmitState: SubmitState = {
  error: null,
  submitting: false,
};

const initialSlugAvailabilityState: SlugAvailabilityState = {
  status: "idle",
  message: "",
};

type OnboardingFormProps = {
  provider?: string;
  redirectPath?: string;
};

export function OnboardingForm({
  provider: providerInput,
  redirectPath: redirectPathInput,
}: OnboardingFormProps) {
  const router = useRouter();
  const provider = providerInput?.trim() || "google";
  const redirectPath = redirectPathInput?.trim() || "";
  const auth = getFirebaseClientAuth();
  const initialDisplayName = auth.currentUser?.displayName?.trim() ?? "";

  const [fullName, setFullName] = useState(initialDisplayName);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [role, setRole] = useState("Product / Ops");
  const [teamSize, setTeamSize] = useState("2-10");
  const [state, setState] = useState<SubmitState>(initialSubmitState);
  const [slugAvailability, setSlugAvailability] = useState<SlugAvailabilityState>(
    initialSlugAvailabilityState,
  );

  const submitLabel = useMemo(
    () => (state.submitting ? "Setting up..." : "Complete setup"),
    [state.submitting],
  );
  const submitDisabled =
    state.submitting ||
    slugAvailability.status === "checking" ||
    slugAvailability.status === "unavailable";

  useEffect(() => {
    const candidateSlug = workspaceSlug.trim();
    if (!candidateSlug) {
      setSlugAvailability(initialSlugAvailabilityState);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setSlugAvailability({
      status: "checking",
      message: "Checking slug availability...",
    });

    const timerId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/auth/onboarding/slug?slug=${encodeURIComponent(candidateSlug)}`,
          { signal: controller.signal },
        );
        const result = (await response.json().catch(() => null)) as
          | { error?: string; available?: boolean; reason?: string; slug?: string }
          | null;

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(result?.error ?? "Failed to validate slug.");
        }

        setSlugAvailability({
          status: result?.available ? "available" : "unavailable",
          message:
            result?.reason ??
            (result?.available ? "Slug is available." : "Slug is unavailable."),
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setSlugAvailability({
          status: "error",
          message: "Could not verify slug right now. You can still submit.",
        });
      }
    }, 280);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timerId);
    };
  }, [workspaceSlug]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = fullName.trim();
    const normalizedWorkspaceName = workspaceName.trim();
    const normalizedWorkspaceSlug = slugifyWorkspaceName(workspaceSlug);

    if (!normalizedName) {
      setState({ error: "Full name is required.", submitting: false });
      return;
    }

    if (!normalizedWorkspaceName) {
      setState({ error: "Workspace name is required.", submitting: false });
      return;
    }

    if (slugAvailability.status === "checking") {
      setState({ error: "Wait for slug availability check to finish.", submitting: false });
      return;
    }

    if (slugAvailability.status === "unavailable") {
      setState({ error: slugAvailability.message || "Workspace slug is unavailable.", submitting: false });
      return;
    }

    setState({ error: null, submitting: true });

    try {
      if (auth.currentUser && auth.currentUser.displayName !== normalizedName) {
        await updateProfile(auth.currentUser, { displayName: normalizedName });
      }

      const response = await fetch("/api/auth/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: normalizedName,
          workspaceName: normalizedWorkspaceName,
          workspaceSlug: normalizedWorkspaceSlug,
          role,
          teamSize,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | { workspaceSlug?: string; error?: string }
        | null;

      if (!response.ok) {
        const message = result?.error ?? "Failed to complete onboarding.";
        if (response.status === 409 && message.toLowerCase().includes("slug")) {
          setSlugAvailability({
            status: "unavailable",
            message,
          });
        }
        throw new Error(message);
      }

      const resolvedSlug = result?.workspaceSlug ?? normalizedWorkspaceSlug;
      const safeRedirect =
        redirectPath && redirectPath.startsWith("/") ? redirectPath : null;

      if (safeRedirect) {
        const parts = safeRedirect.split("/").filter(Boolean);
        const root = parts[0] ?? "";
        if (root === "invite") {
          router.replace(safeRedirect);
          return;
        }

        if (parts.length >= 2) {
          const rewrittenPath = `/${resolvedSlug}/${parts.slice(1).join("/")}`;
          router.replace(rewrittenPath);
          return;
        }
      }

      router.replace(`/${resolvedSlug}/my-work`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to complete onboarding.";
      setState({ error: message, submitting: false });
    }
  }

  return (
    <section className="border border-slate-200 bg-[color:var(--surface)] p-6 sm:p-7">
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">ONBOARDING</p>
          <span className="rounded-sm border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-cyan-800">
            {provider.toUpperCase()}
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Set up your workspace
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          One quick step so we can route you into the right workspace context.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Full name
          </span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Jordan Lee"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Workspace name
          </span>
          <input
            value={workspaceName}
            onChange={(event) => {
              const nextName = event.target.value;
              setWorkspaceName(nextName);
              if (!slugTouched) {
                setWorkspaceSlug(nextName.trim() ? slugifyWorkspaceName(nextName) : "");
              }
            }}
            placeholder="Acme Corp"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Workspace slug
          </span>
          <input
            value={workspaceSlug}
            onChange={(event) => {
              setSlugTouched(true);
              const rawValue = event.target.value;
              setWorkspaceSlug(rawValue.trim() ? slugifyWorkspaceName(rawValue) : "");
            }}
            placeholder="acme-corp"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900"
          />
          {slugAvailability.status !== "idle" ? (
            <p
              className={`text-xs ${
                slugAvailability.status === "available"
                  ? "text-emerald-700"
                  : slugAvailability.status === "checking"
                    ? "text-slate-500"
                    : slugAvailability.status === "unavailable"
                      ? "text-rose-700"
                      : "text-amber-700"
              }`}
            >
              {slugAvailability.message}
            </p>
          ) : null}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
              Role
            </span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900"
            >
              <option>Product / Ops</option>
              <option>Engineering</option>
              <option>Leadership</option>
              <option>Support</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
              Team size
            </span>
            <select
              value={teamSize}
              onChange={(event) => setTeamSize(event.target.value)}
              className="w-full rounded-sm border border-slate-300 bg-white px-3 py-3 text-slate-900"
            >
              <option>1</option>
              <option>2-10</option>
              <option>11-50</option>
              <option>51-200</option>
              <option>200+</option>
            </select>
          </label>
        </div>

        {state.error ? (
          <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitDisabled}
          className="w-full rounded-sm bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.07em] text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitLabel}
        </button>
      </form>

      <p className="mt-5 text-sm text-[color:var(--muted)]">
        Already set up?{" "}
        <Link
          href="/acme-corp/my-work"
          className="font-semibold text-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
        >
          Go to workspace
        </Link>
      </p>
    </section>
  );
}
