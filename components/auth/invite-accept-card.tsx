"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type InviteStatus = "pending" | "accepted" | "revoked" | "expired";
type InviteRole = "owner" | "admin" | "member" | "viewer";

type InviteDetailsResponse = {
  error?: string;
  invite?: {
    token: string;
    inviteId: string;
    workspaceId: string;
    workspaceSlug: string;
    workspaceName: string;
    email: string;
    role: InviteRole;
    status: InviteStatus;
    invitedByName: string;
    invitedByUid: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    acceptedAt: string;
  };
  actor?: {
    uid: string;
    email: string;
    displayName: string;
  };
  canAccept?: boolean;
  alreadyMember?: boolean;
  reason?: string;
};

type AcceptInviteResponse = {
  error?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  role?: InviteRole;
  alreadyMember?: boolean;
};

type InviteAcceptCardProps = {
  token: string;
};

function normalizeText(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function formatRoleLabel(role: InviteRole) {
  return role[0]?.toUpperCase() + role.slice(1);
}

function formatDateLabel(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "Not available";

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return "Not available";
  }

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
  if (status === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "revoked") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export function InviteAcceptCard({ token }: InviteAcceptCardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [details, setDetails] = useState<InviteDetailsResponse | null>(null);
  const [acceptedWorkspaceSlug, setAcceptedWorkspaceSlug] = useState("");

  const markNotificationRead = useCallback(async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_read",
          token,
        }),
      });
    } catch {
      // Notification read state is non-blocking for invite acceptance flow.
    }
  }, [token]);

  const loadInviteDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`);
      const result = (await response.json().catch(() => null)) as InviteDetailsResponse | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to load invite.");
      }

      setDetails(result);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load invite.";
      setError(message);
      setDetails(null);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadInviteDetails();
  }, [loadInviteDetails]);

  useEffect(() => {
    void markNotificationRead();
  }, [markNotificationRead]);

  async function handleAcceptInvite() {
    if (!details?.canAccept) return;

    setIsAccepting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as AcceptInviteResponse | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to accept invite.");
      }

      const workspaceSlug = normalizeText(result?.workspaceSlug);
      if (workspaceSlug) {
        setAcceptedWorkspaceSlug(workspaceSlug);
      }

      setNotice(
        result?.alreadyMember
          ? "You are already a member. Workspace is ready."
          : "Invite accepted. You can open the workspace now.",
      );
      await loadInviteDetails();
      router.refresh();
    } catch (acceptError) {
      const message =
        acceptError instanceof Error ? acceptError.message : "Failed to accept invite.";
      setError(message);
    } finally {
      setIsAccepting(false);
    }
  }

  const workspaceSlug =
    normalizeText(acceptedWorkspaceSlug) ||
    normalizeText(details?.invite?.workspaceSlug);
  const workspacePath = workspaceSlug ? `/${workspaceSlug}/my-work` : "";
  const switchAccountPath = `/login?redirect=${encodeURIComponent(`/invite/${token}`)}`;
  const inviteStatus = details?.invite?.status ?? "pending";
  const canAccept = details?.canAccept === true;
  const secondaryMessage = useMemo(() => {
    if (!details?.reason) return "";
    return details.reason;
  }, [details?.reason]);
  const secondaryMessageLower = secondaryMessage.toLowerCase();
  const isEmailMismatch =
    secondaryMessageLower.includes("invite is for") &&
    secondaryMessageLower.includes("signed in as");
  const alreadyMember = details?.alreadyMember === true;

  if (isLoading) {
    return (
      <section className="border border-slate-200 bg-[color:var(--surface)] p-6 sm:p-7">
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">INVITE</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          Loading invitation
        </h1>
        <p className="mt-3 text-sm text-slate-600">Checking invite details and access...</p>
      </section>
    );
  }

  if (!details?.invite) {
    return (
      <section className="border border-slate-200 bg-[color:var(--surface)] p-6 sm:p-7">
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">INVITE</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          Invite unavailable
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          {error ?? "This invite link is invalid or no longer available."}
        </p>
        <div className="mt-5">
          <Link
            href="/login"
            className="inline-flex rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Back to login
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-slate-200 bg-[color:var(--surface)] p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">WORKSPACE INVITE</p>
        <span
          className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${statusStyle(inviteStatus)}`}
        >
          {inviteStatus.toUpperCase()}
        </span>
      </div>

      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        Join {details.invite.workspaceName}
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        You were invited by {details.invite.invitedByName} as {formatRoleLabel(details.invite.role)}.
      </p>

      <dl className="mt-5 space-y-2 rounded-sm border border-slate-200 bg-white px-3 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">Invited email</dt>
          <dd className="font-medium text-slate-800">{details.invite.email || "Not set"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">Signed-in email</dt>
          <dd className="font-medium text-slate-800">{details.actor?.email || "Not set"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">Expires</dt>
          <dd className="font-medium text-slate-800">{formatDateLabel(details.invite.expiresAt)}</dd>
        </div>
      </dl>

      {notice ? (
        <p className="mt-4 rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
          {notice}
        </p>
      ) : null}

      {inviteStatus === "expired" ? (
        <p className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This invite has expired. Ask a workspace admin to send a new invite link.
        </p>
      ) : null}

      {inviteStatus === "revoked" ? (
        <p className="mt-4 rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This invite was revoked by a workspace admin.
        </p>
      ) : null}

      {inviteStatus === "accepted" && !alreadyMember ? (
        <p className="mt-4 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          This invite has already been accepted.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {!error && secondaryMessage ? (
        <p className="mt-4 rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {secondaryMessage}
        </p>
      ) : null}

      {!error && isEmailMismatch ? (
        <p className="mt-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Sign in with the invited email to accept this invite.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {canAccept ? (
          <button
            type="button"
            onClick={() => void handleAcceptInvite()}
            disabled={isAccepting}
            className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAccepting ? "Accepting..." : "Accept Invite"}
          </button>
        ) : null}

        {workspacePath ? (
          <Link
            href={workspacePath}
            className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Open Workspace
          </Link>
        ) : null}

        {isEmailMismatch ? (
          <Link
            href={switchAccountPath}
            className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Switch account
          </Link>
        ) : null}
      </div>
    </section>
  );
}
