"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  parseWorkspaceMemberRole,
  type WorkspaceMemberRole,
  WORKSPACE_MEMBER_ROLES,
} from "@/lib/auth/permissions";

type InviteStatus = "pending" | "accepted" | "rejected" | "revoked" | "expired";
type InviteEmailDeliveryStatus = "sent" | "skipped" | "failed";

type InviteEmailDelivery = {
  status: InviteEmailDeliveryStatus;
  provider: "resend" | "none";
  messageId: string;
  error: string;
};

type InviteRecord = {
  id: string;
  email: string;
  role: WorkspaceMemberRole;
  status: InviteStatus;
  targetUserExists: boolean;
  invitedByUid: string;
  invitedByName: string;
  inviteUrl: string;
  expiresAt: string;
  isExpired: boolean;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string;
  acceptedByUid: string;
  acceptedByEmail: string;
  rejectedAt: string;
  rejectedByUid: string;
  rejectedByEmail: string;
  revokedAt: string;
  revokedByUid: string;
  resendCount: number;
  emailDeliveryStatus: string;
  emailDeliveryProvider: string;
  emailDeliveryMessageId: string;
  emailDeliveryError: string;
  lastEmailDeliveryAt: string;
};

type InvitesResponse = {
  error?: string;
  invites?: InviteRecord[];
  actorRole?: WorkspaceMemberRole;
  canManageInvites?: boolean;
};

type WorkspaceInvitesManagerProps = {
  workspaceSlug: string;
  actorRole: WorkspaceMemberRole;
  actorRoleLabel: string;
  canManageInvites: boolean;
};

type InviteFilter = "all" | InviteStatus;

const ROLE_OPTIONS: WorkspaceMemberRole[] = [...WORKSPACE_MEMBER_ROLES];
const INVITE_FILTERS: Array<{ value: InviteFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "revoked", label: "Revoked" },
  { value: "expired", label: "Expired" },
];
const INVITE_PAGE_SIZE = 12;
const INVITE_POLLING_INTERVAL_MS = 20_000;

function normalizeRole(value: string): WorkspaceMemberRole {
  return parseWorkspaceMemberRole(value);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function titleCase(value: string) {
  if (!value) return "";
  return value[0].toUpperCase() + value.slice(1);
}

function formatDateLabel(value: string) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not set";

  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusStyle(status: InviteStatus) {
  if (status === "pending") return "border-cyan-200 bg-cyan-50 text-cyan-800";
  if (status === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "revoked") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function inviteDeliveryLabel(invite: InviteRecord) {
  const status = invite.emailDeliveryStatus;
  if (status === "sent") return "Email sent";
  if (status === "failed") return "Email failed";
  if (status === "skipped") return "Email skipped";
  return "Email queued";
}

function inviteResolutionLabel(invite: InviteRecord) {
  if (invite.status === "accepted") {
    const actor = invite.acceptedByEmail || invite.acceptedByUid || "recipient";
    const at = invite.acceptedAt ? ` on ${formatDateLabel(invite.acceptedAt)}` : "";
    return `Accepted by ${actor}${at}.`;
  }

  if (invite.status === "rejected") {
    const actor = invite.rejectedByEmail || invite.rejectedByUid || "recipient";
    const at = invite.rejectedAt ? ` on ${formatDateLabel(invite.rejectedAt)}` : "";
    return `Rejected by ${actor}${at}.`;
  }

  if (invite.status === "revoked") {
    const actor = invite.revokedByUid || "workspace manager";
    const at = invite.revokedAt ? ` on ${formatDateLabel(invite.revokedAt)}` : "";
    return `Revoked by ${actor}${at}.`;
  }

  if (invite.status === "expired") {
    return "Invite expired without a response.";
  }

  return "";
}

export function WorkspaceInvitesManager({
  workspaceSlug,
  actorRole,
  actorRoleLabel,
  canManageInvites,
}: WorkspaceInvitesManagerProps) {
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [isLoading, setIsLoading] = useState(canManageInvites);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceMemberRole>("member");
  const [statusFilter, setStatusFilter] = useState<InviteFilter>("all");
  const [emailFilter, setEmailFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(INVITE_PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canAssignOwner = actorRole === "owner";
  const roleOptions = useMemo(() => {
    return ROLE_OPTIONS.filter((role) => (role === "owner" ? canAssignOwner : true));
  }, [canAssignOwner]);

  const loadInvites = useCallback(async (options?: { silent?: boolean }) => {
    if (!canManageInvites) {
      setIsLoading(false);
      return;
    }

    if (options?.silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invites`,
      );
      const result = (await response.json().catch(() => null)) as
        | InvitesResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to load invites.");
      }

      setInvites(result?.invites ?? []);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load invites.";
      setError(message);
    } finally {
      if (options?.silent) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [canManageInvites, workspaceSlug]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  useEffect(() => {
    if (!canManageInvites) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadInvites({ silent: true });
    }, INVITE_POLLING_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [canManageInvites, loadInvites]);

  useEffect(() => {
    setVisibleCount(INVITE_PAGE_SIZE);
  }, [statusFilter, emailFilter]);

  const normalizedEmailFilter = emailFilter.trim().toLowerCase();
  const filteredInvites = useMemo(() => {
    return invites.filter((invite) => {
      if (statusFilter !== "all" && invite.status !== statusFilter) {
        return false;
      }

      if (normalizedEmailFilter && !invite.email.includes(normalizedEmailFilter)) {
        return false;
      }

      return true;
    });
  }, [invites, normalizedEmailFilter, statusFilter]);

  const visibleInvites = useMemo(
    () => filteredInvites.slice(0, visibleCount),
    [filteredInvites, visibleCount],
  );
  const hasMoreInvites = filteredInvites.length > visibleCount;
  const inviteCounts = useMemo(() => {
    const counts: Record<InviteStatus, number> = {
      pending: 0,
      accepted: 0,
      rejected: 0,
      revoked: 0,
      expired: 0,
    };

    for (const invite of invites) {
      counts[invite.status] += 1;
    }

    return counts;
  }, [invites]);

  async function handleCreateInvite() {
    if (!canManageInvites) return;

    const email = normalizeEmail(inviteEmail);
    if (!email) {
      setError("Invite email is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invites`,
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
        | {
            error?: string;
            invite?: {
              inviteUrl?: string;
              targetUserExists?: boolean;
              emailDelivery?: InviteEmailDelivery;
            };
          }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to create invite.");
      }

      setInviteEmail("");
      setInviteRole("member");
      const accountMessage =
        result?.invite?.targetUserExists === false
          ? "Recipient has not created an account yet. They can sign up via this invite link."
          : "Recipient can sign in and accept the invite.";
      const deliveryMessage =
        result?.invite?.emailDelivery?.status === "sent"
          ? "Invite email sent."
          : result?.invite?.emailDelivery?.error
            ? `Invite created but email not sent: ${result.invite.emailDelivery.error}`
            : "Invite created.";
      setNotice(
        result?.invite?.inviteUrl
          ? `${deliveryMessage} ${accountMessage} Link: ${result.invite.inviteUrl}`
          : `${deliveryMessage} ${accountMessage}`,
      );
      await loadInvites();
    } catch (createError) {
      const message =
        createError instanceof Error ? createError.message : "Failed to create invite.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePatchInvite(inviteId: string, action: "revoke" | "resend") {
    if (!canManageInvites) return;

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invites/${encodeURIComponent(inviteId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | {
            error?: string;
            invite?: {
              inviteUrl?: string;
              targetUserExists?: boolean;
              emailDelivery?: InviteEmailDelivery;
            };
          }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to update invite.");
      }

      if (action === "revoke") {
        setNotice("Invite revoked.");
      } else if (result?.invite?.inviteUrl) {
        const accountMessage =
          result?.invite?.targetUserExists === false
            ? "Recipient still has no account. They must sign up with invited email first."
            : "Recipient can sign in and accept.";
        const deliveryMessage =
          result?.invite?.emailDelivery?.status === "sent"
            ? "Invite email resent."
            : result?.invite?.emailDelivery?.error
              ? `Invite resent but email failed: ${result.invite.emailDelivery.error}`
              : "Invite resent.";
        setNotice(`${deliveryMessage} ${accountMessage} New link: ${result.invite.inviteUrl}`);
      } else {
        setNotice("Invite resent.");
      }

      await loadInvites();
    } catch (patchError) {
      const message =
        patchError instanceof Error ? patchError.message : "Failed to update invite.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyInviteLink(inviteUrl: string) {
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("Invite link copied.");
      setError(null);
    } catch {
      setError("Could not copy link. Copy it manually from the field.");
    }
  }

  if (!canManageInvites) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Invites</h2>
        <p className="mt-2 text-sm text-slate-600">
          Invite management requires owner/admin permission. Your role: {actorRoleLabel}.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Invite by email
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Generate a secure invite link. The invite can be accepted only by the invited email.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="teammate@company.com"
            disabled={isSubmitting}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
          />
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(normalizeRole(event.target.value))}
            disabled={isSubmitting}
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
            onClick={() => void handleCreateInvite()}
            disabled={isSubmitting}
            className="rounded-sm bg-[color:var(--accent)] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Create
          </button>
        </div>
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
          Loading invites...
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-600">
              Showing {visibleInvites.length} of {filteredInvites.length} filtered invites ({invites.length} total)
              {isRefreshing ? " • refreshing..." : ""}
            </p>
            <button
              type="button"
              onClick={() => void loadInvites({ silent: true })}
              disabled={isRefreshing || isSubmitting}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {INVITE_FILTERS.map((filter) => {
                const count = filter.value === "all" ? invites.length : inviteCounts[filter.value];
                const isActive = statusFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setStatusFilter(filter.value)}
                    className={`rounded-sm border px-2.5 py-1 text-xs font-semibold tracking-[0.06em] ${
                      isActive
                        ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                        : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
                    }`}
                  >
                    {filter.label} ({count})
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={emailFilter}
              onChange={(event) => setEmailFilter(event.target.value)}
              placeholder="Filter by email..."
              className="mt-3 w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>

          {filteredInvites.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">
              {invites.length === 0 ? "No invites yet." : "No invites match the current filters."}
            </div>
          ) : (
            <>
              <div className="max-h-[560px] space-y-3 overflow-y-auto p-3">
                {visibleInvites.map((invite) => {
                  const canRevoke = invite.status === "pending";
                  const canResend = invite.status !== "accepted";
                  const resolutionLabel = inviteResolutionLabel(invite);

                  return (
                    <article
                      key={invite.id}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{invite.email}</p>
                          <p className="mt-1 text-xs text-slate-600">
                            Role {titleCase(invite.role)} • Expires {formatDateLabel(invite.expiresAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {invite.targetUserExists
                              ? "Account exists"
                              : "No account yet: recipient must sign up first"}
                            {" • "}
                            {inviteDeliveryLabel(invite)}
                            {invite.lastEmailDeliveryAt
                              ? ` at ${formatDateLabel(invite.lastEmailDeliveryAt)}`
                              : ""}
                          </p>
                          {resolutionLabel ? (
                            <p className="mt-1 text-xs text-slate-500">{resolutionLabel}</p>
                          ) : null}
                          {invite.emailDeliveryError ? (
                            <p className="mt-1 text-xs text-rose-600">
                              Delivery error: {invite.emailDeliveryError}
                            </p>
                          ) : null}
                        </div>
                        <span
                          className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${statusStyle(invite.status)}`}
                        >
                          {invite.status.toUpperCase()}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                          readOnly
                          value={invite.inviteUrl}
                          className="min-w-[220px] flex-1 rounded-sm border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCopyInviteLink(invite.inviteUrl)}
                          className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                        >
                          Copy link
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePatchInvite(invite.id, "resend")}
                          disabled={!canResend || isSubmitting}
                          className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePatchInvite(invite.id, "revoke")}
                          disabled={!canRevoke || isSubmitting}
                          className="rounded-sm border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Revoke
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {hasMoreInvites ? (
                <div className="border-t border-slate-200 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((current) => current + INVITE_PAGE_SIZE)}
                    className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                  >
                    Show more ({filteredInvites.length - visibleCount} remaining)
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}
