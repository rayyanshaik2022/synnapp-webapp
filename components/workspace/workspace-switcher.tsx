"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ResolvedWorkspace } from "@/lib/auth/workspace-data";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { NotificationCenter } from "@/components/workspace/notification-center";
import {
  MAX_OWNED_BASIC_WORKSPACES,
  MAX_WORKSPACE_MEMBERSHIPS,
} from "@/lib/workspace/limits";

type WorkspaceSwitcherProps = {
  currentWorkspaceSlug: string;
  workspaces: ResolvedWorkspace[];
  userName: string;
  userRole: string;
  userInitials: string;
};

type UpdateDefaultWorkspaceResponse = {
  error?: string;
  workspaceSlug?: string;
};

type CreateWorkspaceResponse = {
  error?: string;
  workspaceSlug?: string;
};

type SlugAvailabilityState = {
  status: "idle" | "checking" | "available" | "unavailable" | "error";
  message: string;
};

const initialSlugAvailabilityState: SlugAvailabilityState = {
  status: "idle",
  message: "",
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function normalizeWorkspaceSlug(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "my-workspace";
}

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function rewriteWorkspacePath(pathname: string, workspaceSlug: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return `/${workspaceSlug}/my-work`;
  }

  segments[0] = workspaceSlug;
  return `/${segments.join("/")}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Failed to switch workspace.";
}

export function WorkspaceSwitcher({
  currentWorkspaceSlug,
  workspaces,
  userName,
  userRole,
  userInitials,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedWorkspaceSlug, setSelectedWorkspaceSlug] = useState(currentWorkspaceSlug);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [createWorkspaceSlug, setCreateWorkspaceSlug] = useState("");
  const [createSlugTouched, setCreateSlugTouched] = useState(false);
  const [createSlugAvailability, setCreateSlugAvailability] = useState<SlugAvailabilityState>(
    initialSlugAvailabilityState,
  );
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const workspaceOptions = useMemo(() => {
    const seen = new Set<string>();
    const deduped: ResolvedWorkspace[] = [];

    for (const workspace of workspaces) {
      const workspaceSlug = normalizeText(workspace.workspaceSlug);
      if (!workspaceSlug || seen.has(workspaceSlug)) continue;
      seen.add(workspaceSlug);
      deduped.push(workspace);
    }

    const hasCurrent = deduped.some(
      (workspace) => workspace.workspaceSlug === currentWorkspaceSlug,
    );

    if (hasCurrent) {
      return deduped;
    }

    return [
      {
        workspaceId: `fallback-${currentWorkspaceSlug}`,
        workspaceSlug: currentWorkspaceSlug,
        workspaceName: formatWorkspaceName(currentWorkspaceSlug) || currentWorkspaceSlug,
      },
      ...deduped,
    ];
  }, [currentWorkspaceSlug, workspaces]);

  const selectedWorkspaceName = useMemo(() => {
    const selectedWorkspace = workspaceOptions.find(
      (workspace) => workspace.workspaceSlug === selectedWorkspaceSlug,
    );

    return (
      selectedWorkspace?.workspaceName ||
      formatWorkspaceName(selectedWorkspaceSlug) ||
      selectedWorkspaceSlug
    );
  }, [selectedWorkspaceSlug, workspaceOptions]);

  useEffect(() => {
    setSelectedWorkspaceSlug(currentWorkspaceSlug);
    setIsWorkspaceMenuOpen(false);
    setIsUserMenuOpen(false);
    setIsCreateFormOpen(false);
    setCreateWorkspaceName("");
    setCreateWorkspaceSlug("");
    setCreateSlugTouched(false);
    setCreateSlugAvailability(initialSlugAvailabilityState);
    setCreateError(null);
  }, [currentWorkspaceSlug]);

  useEffect(() => {
    if (!isCreateFormOpen) {
      setCreateSlugAvailability(initialSlugAvailabilityState);
      return;
    }

    const candidateSlug = createWorkspaceSlug.trim();
    if (!candidateSlug) {
      setCreateSlugAvailability(initialSlugAvailabilityState);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setCreateSlugAvailability({
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
          | { error?: string; available?: boolean; reason?: string }
          | null;

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(result?.error ?? "Failed to validate slug.");
        }

        const normalizedReason = normalizeText(result?.reason).toLowerCase();
        const isAlreadyOwnedSlug =
          result?.available === true &&
          normalizedReason.includes("already belongs to your workspace");
        const isAvailable = result?.available === true && !isAlreadyOwnedSlug;
        setCreateSlugAvailability({
          status: isAvailable ? "available" : "unavailable",
          message: isAlreadyOwnedSlug
            ? "Slug already belongs to one of your workspaces."
            : result?.reason ??
              (isAvailable ? "Slug is available." : "Slug is unavailable."),
        });
      } catch (availabilityError) {
        if (cancelled) return;
        if (availabilityError instanceof DOMException && availabilityError.name === "AbortError") {
          return;
        }

        setCreateSlugAvailability({
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
  }, [createWorkspaceSlug, isCreateFormOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      const clickedWorkspaceMenu = workspaceMenuRef.current?.contains(event.target) ?? false;
      const clickedUserMenu = userMenuRef.current?.contains(event.target) ?? false;
      if (!clickedWorkspaceMenu) {
        setIsWorkspaceMenuOpen(false);
      }
      if (!clickedUserMenu) {
        setIsUserMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsWorkspaceMenuOpen(false);
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function handleWorkspaceChange(nextWorkspaceSlug: string) {
    setIsWorkspaceMenuOpen(false);
    setIsCreateFormOpen(false);
    setSelectedWorkspaceSlug(nextWorkspaceSlug);
    setError(null);

    if (nextWorkspaceSlug === currentWorkspaceSlug) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/workspaces/default", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: nextWorkspaceSlug }),
      });

      const result = (await response.json().catch(() => null)) as
        | UpdateDefaultWorkspaceResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to switch workspace.");
      }

      const resolvedWorkspaceSlug =
        typeof result?.workspaceSlug === "string" && result.workspaceSlug
          ? result.workspaceSlug
          : nextWorkspaceSlug;
      const targetPath = rewriteWorkspacePath(pathname, resolvedWorkspaceSlug);
      const query = searchParams.toString();
      router.push(query ? `${targetPath}?${query}` : targetPath);
      router.refresh();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
      setSelectedWorkspaceSlug(currentWorkspaceSlug);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedWorkspaceName = createWorkspaceName.trim();
    const normalizedWorkspaceSlug = normalizeWorkspaceSlug(createWorkspaceSlug);

    if (!normalizedWorkspaceName) {
      setCreateError("Workspace name is required.");
      return;
    }

    if (createSlugAvailability.status === "checking") {
      setCreateError("Wait for slug availability check to finish.");
      return;
    }

    if (createSlugAvailability.status === "unavailable") {
      setCreateError(createSlugAvailability.message || "Workspace slug is unavailable.");
      return;
    }

    setIsCreatingWorkspace(true);
    setCreateError(null);
    setError(null);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceName: normalizedWorkspaceName,
          workspaceSlug: normalizedWorkspaceSlug,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | CreateWorkspaceResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to create workspace.");
      }

      const resolvedWorkspaceSlug =
        typeof result?.workspaceSlug === "string" && result.workspaceSlug
          ? result.workspaceSlug
          : normalizedWorkspaceSlug;

      setIsCreateFormOpen(false);
      setCreateWorkspaceName("");
      setCreateWorkspaceSlug("");
      setCreateSlugTouched(false);
      setCreateSlugAvailability(initialSlugAvailabilityState);
      setCreateError(null);
      setIsWorkspaceMenuOpen(false);
      setSelectedWorkspaceSlug(resolvedWorkspaceSlug);
      router.push(`/${resolvedWorkspaceSlug}/my-work`);
      router.refresh();
    } catch (createWorkspaceError) {
      setCreateError(
        createWorkspaceError instanceof Error
          ? createWorkspaceError.message
          : "Failed to create workspace.",
      );
    } finally {
      setIsCreatingWorkspace(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Workspace
            </span>
            <div className="relative w-full max-w-[360px]" ref={workspaceMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setIsWorkspaceMenuOpen((current) => {
                    const next = !current;
                    if (!next) {
                      setIsCreateFormOpen(false);
                      setCreateError(null);
                    }
                    return next;
                  });
                  setIsUserMenuOpen(false);
                }}
                disabled={isSubmitting || isCreatingWorkspace}
                aria-expanded={isWorkspaceMenuOpen}
                aria-haspopup="menu"
                className="inline-flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="truncate text-sm font-semibold text-slate-900">
                  {selectedWorkspaceName}
                </span>
                <span
                  className={`text-xs text-slate-500 transition ${isWorkspaceMenuOpen ? "rotate-180" : ""}`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>

              {isWorkspaceMenuOpen ? (
                <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-[min(94vw,360px)] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_16px_36px_rgba(15,23,42,0.15)]">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Switch Workspace
                  </p>

                  <div className="mt-1 max-h-56 space-y-1 overflow-y-auto">
                    {workspaceOptions.map((workspace) => {
                      const isActiveWorkspace =
                        workspace.workspaceSlug === selectedWorkspaceSlug;

                      return (
                        <button
                          key={workspace.workspaceSlug}
                          type="button"
                          onClick={() => void handleWorkspaceChange(workspace.workspaceSlug)}
                          disabled={isSubmitting || isCreatingWorkspace}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-2 text-left text-sm transition ${
                            isActiveWorkspace
                              ? "border-slate-400 bg-slate-100 text-slate-900"
                              : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          <span className="truncate">{workspace.workspaceName}</span>
                          {isActiveWorkspace ? (
                            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                              Current
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-2 border-t border-slate-200 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreateFormOpen((current) => !current);
                        setCreateError(null);
                      }}
                      disabled={isSubmitting || isCreatingWorkspace}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isCreateFormOpen ? "Hide New Workspace Form" : "New Workspace"}
                    </button>
                  </div>

                  {isCreateFormOpen ? (
                    <form
                      className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2"
                      onSubmit={(event) => void handleCreateWorkspace(event)}
                    >
                      <p className="text-xs text-slate-600">
                        Own up to {MAX_OWNED_BASIC_WORKSPACES} basic workspaces and join up
                        to {MAX_WORKSPACE_MEMBERSHIPS} total workspaces.
                      </p>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                          Workspace name
                        </span>
                        <input
                          value={createWorkspaceName}
                          onChange={(event) => {
                            const nextName = event.target.value;
                            setCreateWorkspaceName(nextName);
                            if (!createSlugTouched) {
                              setCreateWorkspaceSlug(
                                nextName.trim() ? normalizeWorkspaceSlug(nextName) : "",
                              );
                            }
                          }}
                          placeholder="Acme Corp"
                          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                          Workspace slug
                        </span>
                        <input
                          value={createWorkspaceSlug}
                          onChange={(event) => {
                            setCreateSlugTouched(true);
                            const rawValue = event.target.value;
                            setCreateWorkspaceSlug(
                              rawValue.trim() ? normalizeWorkspaceSlug(rawValue) : "",
                            );
                          }}
                          placeholder="acme-corp"
                          className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900"
                        />
                      </label>

                      {createSlugAvailability.status !== "idle" ? (
                        <p
                          className={`text-xs ${
                            createSlugAvailability.status === "available"
                              ? "text-emerald-700"
                              : createSlugAvailability.status === "checking"
                                ? "text-slate-600"
                                : createSlugAvailability.status === "unavailable"
                                  ? "text-rose-700"
                                  : "text-amber-700"
                          }`}
                        >
                          {createSlugAvailability.message}
                        </p>
                      ) : null}

                      {createError ? (
                        <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                          {createError}
                        </p>
                      ) : null}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsCreateFormOpen(false);
                            setCreateError(null);
                          }}
                          disabled={isCreatingWorkspace}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={
                            isCreatingWorkspace || createSlugAvailability.status === "checking"
                          }
                          className="rounded-md bg-[color:var(--accent)] px-2 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isCreatingWorkspace ? "Creating..." : "Create"}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NotificationCenter />

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((current) => !current)}
              aria-expanded={isUserMenuOpen}
              aria-haspopup="menu"
              className="inline-flex h-10 max-w-[280px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 transition hover:border-slate-500"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-700">
                {userInitials}
              </div>
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
                <p className="truncate text-[11px] text-slate-600">{userRole}</p>
              </div>
              <span
                className={`text-xs text-slate-500 transition ${isUserMenuOpen ? "rotate-180" : ""}`}
                aria-hidden
              >
                ▾
              </span>
            </button>

            {isUserMenuOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(90vw,260px)] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_16px_36px_rgba(15,23,42,0.15)]">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  User
                </p>
                <Link
                  href={`/${currentWorkspaceSlug}/account`}
                  onClick={() => setIsUserMenuOpen(false)}
                  className="block rounded-md border border-transparent px-2 py-2 text-sm font-medium text-slate-800 transition hover:border-slate-200 hover:bg-slate-50"
                >
                  Go to Account Settings
                </Link>
                <SignOutButton className="mt-1 w-full rounded-md border border-transparent px-2 py-2 text-left text-sm font-medium text-slate-800 transition hover:border-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                  Sign out
                </SignOutButton>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
