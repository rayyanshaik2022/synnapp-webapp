"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type InviteNotification = {
  id: string;
  type: "workspace_invite";
  token: string;
  inviteUrl: string;
  workspaceSlug: string;
  workspaceName: string;
  role: string;
  invitedByName: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;
  isRead: boolean;
  readAt: string;
};

type MentionNotification = {
  id: string;
  type: "mention";
  notificationId: string;
  workspaceSlug: string;
  workspaceName: string;
  entityType: "decision" | "action";
  entityId: string;
  entityTitle: string;
  entityPath: string;
  mentionedByName: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  isRead: boolean;
  readAt: string;
};

type NotificationItem = InviteNotification | MentionNotification;

type NotificationsResponse = {
  error?: string;
  unreadCount?: number;
  notifications?: NotificationItem[];
};

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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load notifications.";
}

function unreadBadgeLabel(count: number) {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const hasUnread = unreadCount > 0;
  const unreadLabel = useMemo(() => unreadBadgeLabel(unreadCount), [unreadCount]);

  const loadNotifications = useCallback(
    async (background = false) => {
      if (!background) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await fetch("/api/notifications", { method: "GET" });
        const result = (await response.json().catch(() => null)) as
          | NotificationsResponse
          | null;

        if (!response.ok) {
          throw new Error(result?.error ?? "Failed to load notifications.");
        }

        setNotifications(result?.notifications ?? []);
        setUnreadCount(
          typeof result?.unreadCount === "number" && Number.isFinite(result.unreadCount)
            ? Math.max(0, Math.floor(result.unreadCount))
            : 0,
        );
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        if (!background) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadNotifications();

    const interval = window.setInterval(() => {
      void loadNotifications(true);
    }, 45000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadNotifications]);

  async function patchNotifications(
    payload:
      | { action: "mark_read"; token: string }
      | { action: "mark_read"; notificationType: "mention"; notificationId: string }
      | { action: "mark_all_read" },
  ) {
    setIsMutating(true);
    setError(null);

    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to update notifications.");
      }

      await loadNotifications(true);
    } catch (patchError) {
      setError(getErrorMessage(patchError));
    } finally {
      setIsMutating(false);
    }
  }

  function handleTogglePanel() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      void loadNotifications(true);
    }
  }

  function getNotificationActionHref(notification: NotificationItem) {
    if (notification.type === "mention") {
      return notification.entityPath || "#";
    }

    return notification.inviteUrl;
  }

  function getNotificationPrimaryLabel(notification: NotificationItem) {
    if (notification.type === "mention") {
      return notification.entityTitle || `${notification.entityType} update`;
    }

    return notification.workspaceName;
  }

  function getNotificationSummary(notification: NotificationItem) {
    if (notification.type === "mention") {
      const preview = notification.preview;
      if (preview) {
        return `${notification.mentionedByName} mentioned you in a ${notification.entityType}.`;
      }
      return `${notification.mentionedByName} mentioned you in ${notification.workspaceName}.`;
    }

    return `${notification.invitedByName} invited you as ${notification.role}.`;
  }

  function getNotificationMeta(notification: NotificationItem) {
    if (notification.type === "mention") {
      const updatedLabel = formatDateLabel(notification.updatedAt || notification.createdAt);
      return `Updated ${updatedLabel}`;
    }

    return `Received ${formatDateLabel(notification.createdAt)} • Expires ${formatDateLabel(
      notification.expiresAt,
    )}`;
  }

  function getNotificationActionLabel(notification: NotificationItem) {
    if (notification.type === "mention") {
      return `Open ${notification.entityType}`;
    }

    return "Review invite";
  }

  function buildMarkReadPayload(notification: NotificationItem) {
    if (notification.type === "mention") {
      return {
        action: "mark_read" as const,
        notificationType: "mention" as const,
        notificationId: notification.notificationId,
      };
    }

    return {
      action: "mark_read" as const,
      token: notification.token,
    };
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleTogglePanel}
        aria-expanded={isOpen}
        aria-label="Open notifications"
        className="relative inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
      >
        <BellIcon />
        {hasUnread ? (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[10px] font-semibold text-white">
            {unreadLabel}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <section className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(92vw,420px)] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_16px_36px_rgba(15,23,42,0.15)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2.5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Notifications
              </p>
              <p className="mt-0.5 text-xs text-slate-600">Invites and mentions</p>
            </div>
            <button
              type="button"
              onClick={() => void patchNotifications({ action: "mark_all_read" })}
              disabled={isMutating || unreadCount === 0}
              className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Mark all read
            </button>
          </div>

          {error ? (
            <p className="mt-3 rounded-sm border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}

          {isLoading ? (
            <p className="mt-3 rounded-sm border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
              Loading notifications...
            </p>
          ) : notifications.length === 0 ? (
            <p className="mt-3 rounded-sm border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
              No notifications.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {notifications.map((notification) => (
                <article
                  key={notification.id}
                  className={`rounded-lg border px-3 py-2.5 ${
                    notification.isRead
                      ? "border-slate-200 bg-slate-50"
                      : "border-cyan-200 bg-cyan-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {getNotificationPrimaryLabel(notification)}
                    </p>
                    <span
                      className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${
                        notification.isRead
                          ? "border-slate-300 bg-white text-slate-600"
                          : "border-cyan-200 bg-white text-cyan-800"
                      }`}
                    >
                      {notification.isRead ? "READ" : "NEW"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-700">
                    {getNotificationSummary(notification)}
                  </p>
                  {notification.type === "mention" && notification.preview ? (
                    <p className="mt-1 text-[11px] text-slate-500">{notification.preview}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-500">
                    {getNotificationMeta(notification)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Link
                      href={getNotificationActionHref(notification)}
                      onClick={() => {
                        if (!notification.isRead) {
                          void patchNotifications(buildMarkReadPayload(notification));
                        }
                        setIsOpen(false);
                      }}
                      className="rounded-sm bg-[color:var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
                    >
                      {getNotificationActionLabel(notification)}
                    </Link>
                    <button
                      type="button"
                      onClick={() => void patchNotifications(buildMarkReadPayload(notification))}
                      disabled={notification.isRead || isMutating}
                      className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Mark read
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M6.75 7.5a3.25 3.25 0 0 1 6.5 0v2.47c0 .7.22 1.39.62 1.96l.58.83c.27.39-.01.91-.49.91H5.54c-.48 0-.76-.52-.49-.91l.58-.83c.4-.57.62-1.26.62-1.96V7.5Z" />
      <path d="M8.4 14.75a1.6 1.6 0 0 0 3.2 0" />
    </svg>
  );
}
