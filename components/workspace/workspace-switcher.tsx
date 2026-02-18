"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ResolvedWorkspace } from "@/lib/auth/workspace-data";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { NotificationCenter } from "@/components/workspace/notification-center";

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

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
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

  const canSwitch = workspaceOptions.length > 1;

  useEffect(() => {
    setSelectedWorkspaceSlug(currentWorkspaceSlug);
  }, [currentWorkspaceSlug]);

  async function handleWorkspaceChange(nextWorkspaceSlug: string) {
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Workspace
          </span>
          <select
            value={selectedWorkspaceSlug}
            onChange={(event) => void handleWorkspaceChange(event.target.value)}
            disabled={!canSwitch || isSubmitting}
            className="h-10 w-full max-w-[320px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          >
            {workspaceOptions.map((workspace) => (
              <option key={workspace.workspaceSlug} value={workspace.workspaceSlug}>
                {workspace.workspaceName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-10 max-w-[280px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-700">
              {userInitials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
              <p className="truncate text-[11px] text-slate-600">{userRole}</p>
            </div>
          </div>
          <Link
            href={`/${currentWorkspaceSlug}/profile`}
            className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Profile
          </Link>
          <NotificationCenter />
          <SignOutButton className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60">
            Sign out
          </SignOutButton>
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
