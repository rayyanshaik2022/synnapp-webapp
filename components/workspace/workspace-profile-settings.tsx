"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type WorkspaceProfileSettingsProps = {
  workspaceName: string;
  workspaceSlug: string;
  canManageSlug: boolean;
  roleLabel: string;
};

type UpdateWorkspaceSlugResponse = {
  error?: string;
  workspaceSlug?: string;
  updated?: boolean;
};

function normalizeSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function rewriteWorkspacePath(pathname: string, workspaceSlug: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return `/${workspaceSlug}/settings`;
  }

  segments[0] = workspaceSlug;
  return `/${segments.join("/")}`;
}

export function WorkspaceProfileSettings({
  workspaceName,
  workspaceSlug,
  canManageSlug,
  roleLabel,
}: WorkspaceProfileSettingsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [currentWorkspaceSlug, setCurrentWorkspaceSlug] = useState(workspaceSlug);
  const [slugInput, setSlugInput] = useState(workspaceSlug);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedInput = useMemo(() => normalizeSlug(slugInput), [slugInput]);
  const hasChanges = normalizedInput !== currentWorkspaceSlug;

  async function handleSave() {
    if (!canManageSlug) {
      setError("Only owners and admins can change the workspace slug.");
      return;
    }

    if (!normalizedInput) {
      setError("Workspace slug is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(currentWorkspaceSlug)}/slug`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: normalizedInput }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | UpdateWorkspaceSlugResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to update workspace slug.");
      }

      const nextWorkspaceSlug =
        typeof result?.workspaceSlug === "string" && result.workspaceSlug
          ? result.workspaceSlug
          : normalizedInput;

      const updated = result?.updated === true;
      const previousWorkspaceSlug = currentWorkspaceSlug;
      setCurrentWorkspaceSlug(nextWorkspaceSlug);
      setSlugInput(nextWorkspaceSlug);
      setNotice(updated ? "Workspace slug updated." : "Workspace slug unchanged.");

      if (nextWorkspaceSlug !== previousWorkspaceSlug) {
        const nextPath = rewriteWorkspacePath(pathname, nextWorkspaceSlug);
        router.replace(nextPath);
        router.refresh();
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to update workspace slug.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Workspace Profile</h2>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSubmitting || !hasChanges || !canManageSlug}
          className="rounded-sm bg-[color:var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Save changes"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SettingField label="Workspace Name" value={workspaceName} />
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Workspace Slug
          </span>
          <input
            value={slugInput}
            onChange={(event) => setSlugInput(normalizeSlug(event.target.value))}
            readOnly={!canManageSlug}
            className={`w-full rounded-sm border px-3 py-2.5 text-sm outline-none ${
              canManageSlug
                ? "border-slate-300 bg-white text-slate-900"
                : "border-slate-200 bg-slate-100 text-slate-500"
            }`}
          />
        </label>
        <SettingField label="Plan Tier" value="Pro" />
        <SettingField label="Primary Region" value="us-central1" />
        <SettingField label="Timezone" value="America/Los_Angeles" />
        <SettingField label="Default Review Cadence" value="90 days" />
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {canManageSlug
          ? "Changing the slug updates all workspace member routing hints."
          : `Slug updates require owner/admin permission. Your role: ${roleLabel}.`}
      </p>

      {notice ? (
        <p className="mt-3 rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </>
  );
}

function SettingField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
        {label}
      </span>
      <input
        value={value}
        readOnly
        className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none"
      />
    </label>
  );
}
