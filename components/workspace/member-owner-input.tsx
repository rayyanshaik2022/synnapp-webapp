"use client";

import { useEffect, useId, useMemo, useState } from "react";

type WorkspaceMember = {
  uid: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
};

type MembersResponse = {
  error?: string;
  members?: WorkspaceMember[];
};

type MemberOwnerInputProps = {
  workspaceSlug: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Failed to load workspace members.";
}

export function MemberOwnerInput({
  workspaceSlug,
  value,
  onChange,
  disabled = false,
  label = "Owner",
  placeholder = "Action owner",
}: MemberOwnerInputProps) {
  const datalistId = useId();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadMembers() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`,
        );
        const result = (await response.json().catch(() => null)) as MembersResponse | null;

        if (!response.ok) {
          throw new Error(result?.error ?? "Failed to load workspace members.");
        }

        const nextMembers = (result?.members ?? []).filter((member) => {
          return member.status !== "removed" && normalizeText(member.displayName) !== "";
        });
        setMembers(nextMembers);
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setIsLoading(false);
      }
    }

    void loadMembers();
  }, [workspaceSlug]);

  const helperLabel = useMemo(() => {
    if (error) return error;
    if (isLoading) return "Loading workspace members...";
    return "Suggested from workspace members. You can still type a custom owner.";
  }, [error, isLoading]);

  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={datalistId}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      />
      <datalist id={datalistId}>
        {members.map((member) => {
          const displayName = normalizeText(member.displayName);
          const email = normalizeText(member.email);
          const optionLabel = email ? `${displayName} (${email})` : displayName;

          return (
            <option key={member.uid} value={displayName} label={optionLabel} />
          );
        })}
      </datalist>
      <span
        className={`text-xs ${
          error ? "text-rose-700" : "text-slate-500"
        }`}
      >
        {helperLabel}
      </span>
    </label>
  );
}
