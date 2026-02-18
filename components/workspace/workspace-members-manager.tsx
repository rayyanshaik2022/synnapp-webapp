"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canManageWorkspaceMembers,
  parseWorkspaceMemberRole,
  type WorkspaceMemberRole,
  WORKSPACE_MEMBER_ROLES,
} from "@/lib/auth/permissions";

type MemberRecord = {
  uid: string;
  displayName: string;
  email: string;
  role: WorkspaceMemberRole;
  status: string;
  joinedAt?: string | null;
};

type MembersResponse = {
  error?: string;
  actorUid?: string;
  actorRole?: WorkspaceMemberRole;
  canManageMembers?: boolean;
  members?: MemberRecord[];
};

type WorkspaceMembersManagerProps = {
  workspaceSlug: string;
  canManageMembers: boolean;
  actorRoleLabel: string;
};

const ROLE_OPTIONS: WorkspaceMemberRole[] = [...WORKSPACE_MEMBER_ROLES];

function normalizeRole(value: string): WorkspaceMemberRole {
  const parsedRole = parseWorkspaceMemberRole(value);
  if (ROLE_OPTIONS.includes(parsedRole)) {
    return parsedRole;
  }
  return "member";
}

function titleCase(value: string) {
  if (!value) return "";
  return value[0].toUpperCase() + value.slice(1);
}

function roleStyle(role: WorkspaceMemberRole) {
  if (role === "owner") return "border-violet-200 bg-violet-50 text-violet-700";
  if (role === "admin") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (role === "member") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function statusStyle(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function WorkspaceMembersManager({
  workspaceSlug,
  canManageMembers,
  actorRoleLabel,
}: WorkspaceMembersManagerProps) {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actorUid, setActorUid] = useState("");
  const [actorRole, setActorRole] = useState<WorkspaceMemberRole>("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>("member");

  const effectiveCanManage = canManageMembers && canManageWorkspaceMembers(actorRole);
  const canAssignOwner = actorRole === "owner";

  const roleOptions = useMemo(() => {
    return ROLE_OPTIONS.filter((role) => (role === "owner" ? canAssignOwner : true));
  }, [canAssignOwner]);

  const loadMembers = useCallback(async () => {
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
        throw new Error(result?.error ?? "Failed to load members.");
      }

      setMembers(result?.members ?? []);
      setActorUid(result?.actorUid ?? "");
      setActorRole(normalizeRole(result?.actorRole ?? "member"));
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load members.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function handleInvite() {
    if (!effectiveCanManage) return;

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setError("Email is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            role: inviteRole,
          }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | { error?: string; created?: boolean; member?: MemberRecord }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to add member.");
      }

      setInviteEmail("");
      setInviteRole("member");
      setNotice(result?.created ? "Member added." : "Member updated.");
      await loadMembers();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to add member.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRoleChange(memberUid: string, role: WorkspaceMemberRole) {
    if (!effectiveCanManage) return;

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(memberUid)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | { error?: string; updated?: boolean }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to update role.");
      }

      setNotice(result?.updated ? "Member role updated." : "Role unchanged.");
      await loadMembers();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to update role.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRemove(memberUid: string) {
    if (!effectiveCanManage) return;

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(memberUid)}`,
        {
          method: "DELETE",
        },
      );

      const result = (await response.json().catch(() => null)) as
        | { error?: string; removed?: boolean }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to remove member.");
      }

      setNotice(result?.removed ? "Member removed." : "Member update applied.");
      await loadMembers();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to remove member.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Members and Roles</h2>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Add member
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Adds existing users who have already created an account in this environment.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="teammate@company.com"
            disabled={!effectiveCanManage || isSubmitting}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          />
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(normalizeRole(event.target.value))}
            disabled={!effectiveCanManage || isSubmitting}
            className="rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          >
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {titleCase(role)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleInvite}
            disabled={!effectiveCanManage || isSubmitting}
            className="rounded-sm bg-[color:var(--accent)] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {effectiveCanManage
            ? "You can add members and manage roles."
            : `Member management requires owner/admin permissions. Your role: ${actorRoleLabel}.`}
        </p>
      </div>

      {notice ? (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
          Loading members...
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((member) => {
            const isSelf = member.uid === actorUid;
            const isOwnerMember = member.role === "owner";
            const canEditOwnerMember = actorRole === "owner" || !isOwnerMember;
            const canEditRole = effectiveCanManage && !isSelf && canEditOwnerMember;
            const canRemoveMember = effectiveCanManage && !isSelf && canEditOwnerMember;
            const memberRoleOptions = roleOptions.includes(member.role)
              ? roleOptions
              : ([member.role, ...roleOptions] as WorkspaceMemberRole[]);

            return (
              <article
                key={member.uid}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{member.displayName}</p>
                    <p className="mt-1 text-xs text-slate-600">{member.email || "No email"}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                    <span className={`rounded-sm border px-2 py-1 ${roleStyle(member.role)}`}>
                      {titleCase(member.role)}
                    </span>
                    <span className={`rounded-sm border px-2 py-1 ${statusStyle(member.status)}`}>
                      {titleCase(member.status)}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={member.role}
                    onChange={(event) =>
                      void handleRoleChange(member.uid, normalizeRole(event.target.value))
                    }
                    disabled={!canEditRole || isSubmitting}
                    className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  >
                    {memberRoleOptions.map((role) => (
                      <option key={`${member.uid}-${role}`} value={role}>
                        {titleCase(role)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleRemove(member.uid)}
                    disabled={!canRemoveMember || isSubmitting}
                    className="rounded-sm border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove
                  </button>
                  {isSelf ? (
                    <span className="text-xs text-slate-500">Current user</span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
