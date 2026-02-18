"use client";

import { useEffect, useMemo, useState } from "react";

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

type MemberMentionPickerProps = {
  workspaceSlug: string;
  value: string[];
  onChange: (nextMentionUids: string[]) => void;
  disabled?: boolean;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUidArray(value: string[]) {
  const unique = new Set<string>();
  for (const uid of value) {
    const normalizedUid = normalizeText(uid);
    if (normalizedUid) {
      unique.add(normalizedUid);
    }
  }
  return Array.from(unique);
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Failed to load workspace members.";
}

export function MemberMentionPicker({
  workspaceSlug,
  value,
  onChange,
  disabled = false,
}: MemberMentionPickerProps) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    async function loadMembers() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`,
        );
        const result = (await response.json().catch(() => null)) as
          | MembersResponse
          | null;

        if (!response.ok) {
          throw new Error(result?.error ?? "Failed to load workspace members.");
        }

        const membersList = (result?.members ?? []).filter(
          (member) => normalizeText(member.uid) !== "" && member.status !== "removed",
        );
        setMembers(membersList);
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setIsLoading(false);
      }
    }

    void loadMembers();
  }, [workspaceSlug]);

  const membersByUid = useMemo(() => {
    const mapped = new Map<string, WorkspaceMember>();
    for (const member of members) {
      mapped.set(member.uid, member);
    }
    return mapped;
  }, [members]);

  const selectedMentionUids = useMemo(() => normalizeUidArray(value), [value]);

  useEffect(() => {
    if (isLoading) return;

    const pruned = selectedMentionUids.filter((uid) => membersByUid.has(uid));
    if (!areStringArraysEqual(pruned, selectedMentionUids)) {
      onChange(pruned);
    }
  }, [isLoading, membersByUid, onChange, selectedMentionUids]);

  const selectedMembers = useMemo(() => {
    return selectedMentionUids
      .map((uid) => membersByUid.get(uid))
      .filter((member): member is WorkspaceMember => member !== undefined);
  }, [membersByUid, selectedMentionUids]);

  const filteredMembers = useMemo(() => {
    const queryValue = normalizeText(query).toLowerCase();
    const selectedSet = new Set(selectedMentionUids);

    const options = members.filter((member) => {
      if (selectedSet.has(member.uid)) return false;
      if (!queryValue) return true;

      return (
        member.displayName.toLowerCase().includes(queryValue) ||
        member.email.toLowerCase().includes(queryValue)
      );
    });

    return options.slice(0, 8);
  }, [members, query, selectedMentionUids]);

  function handleSelect(uid: string) {
    const next = normalizeUidArray([...selectedMentionUids, uid]);
    onChange(next);
    setQuery("");
    setIsOpen(false);
  }

  function handleRemove(uid: string) {
    const next = selectedMentionUids.filter((currentUid) => currentUid !== uid);
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Mentions
        </span>
        <span className="text-[11px] text-slate-500">
          Pick workspace members to notify
        </span>
      </div>

      {selectedMembers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-slate-200 bg-slate-50 p-2">
          {selectedMembers.map((member) => (
            <span
              key={member.uid}
              className="inline-flex items-center gap-1 rounded-sm border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-semibold text-cyan-800"
            >
              {member.displayName}
              {member.email ? (
                <span className="font-normal text-cyan-700">({member.email})</span>
              ) : null}
              <button
                type="button"
                onClick={() => handleRemove(member.uid)}
                disabled={disabled}
                className="rounded-sm border border-cyan-300 bg-white px-1 text-[10px] font-semibold text-cyan-700 transition hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
            }, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filteredMembers.length > 0) {
              event.preventDefault();
              handleSelect(filteredMembers[0]!.uid);
            }
          }}
          placeholder={isLoading ? "Loading members..." : "Search member by name or email"}
          disabled={disabled || isLoading}
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        />

        {isOpen && !disabled && !isLoading ? (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-sm border border-slate-200 bg-white p-1 shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
            {filteredMembers.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-slate-500">No members found.</p>
            ) : (
              filteredMembers.map((member) => (
                <button
                  key={member.uid}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleSelect(member.uid)}
                  className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100"
                >
                  <span className="font-semibold text-slate-900">{member.displayName}</span>
                  {member.email ? (
                    <span className="ml-1 text-slate-500">{member.email}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
