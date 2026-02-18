"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ArchiveRestoreButtonProps = {
  workspaceSlug: string;
  entity: "decisions" | "actions";
  entityId: string;
  className?: string;
};

type RestoreResponse = {
  error?: string;
};

export function ArchiveRestoreButton({
  workspaceSlug,
  entity,
  entityId,
  className,
}: ArchiveRestoreButtonProps) {
  const router = useRouter();
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore() {
    setIsRestoring(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/${entity}/${encodeURIComponent(entityId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: false }),
        },
      );

      const result = (await response.json().catch(() => null)) as RestoreResponse | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to restore item.");
      }

      router.refresh();
    } catch (restoreError) {
      const message =
        restoreError instanceof Error ? restoreError.message : "Failed to restore item.";
      setError(message);
    } finally {
      setIsRestoring(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleRestore}
        disabled={isRestoring}
        className={
          className ??
          "rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {isRestoring ? "Restoring..." : "Restore"}
      </button>
      {error ? <span className="text-xs text-rose-700">{error}</span> : null}
    </div>
  );
}
