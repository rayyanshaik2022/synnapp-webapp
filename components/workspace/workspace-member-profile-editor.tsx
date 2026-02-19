"use client";

import { FormEvent, useMemo, useState } from "react";

type NotificationValues = {
  meetingDigests: boolean;
  actionReminders: boolean;
  weeklySummary: boolean;
  productAnnouncements: boolean;
};

type WorkspaceMemberProfileEditorProps = {
  workspaceSlug: string;
  initialDisplayName: string;
  initialJobTitle: string;
  initialNotifications: NotificationValues;
  email: string;
  roleLabel: string;
  statusLabel: string;
};

type WorkspaceProfileApiResponse = {
  error?: string;
  updated?: boolean;
  profile?: {
    displayName: string;
    jobTitle: string;
    notifications: NotificationValues;
    email: string;
    role: string;
    status: string;
  };
};

function normalizeDisplayName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeJobTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function hasNotificationChanges(a: NotificationValues, b: NotificationValues) {
  return (
    a.meetingDigests !== b.meetingDigests ||
    a.actionReminders !== b.actionReminders ||
    a.weeklySummary !== b.weeklySummary ||
    a.productAnnouncements !== b.productAnnouncements
  );
}

export function WorkspaceMemberProfileEditor({
  workspaceSlug,
  initialDisplayName,
  initialJobTitle,
  initialNotifications,
  email,
  roleLabel,
  statusLabel,
}: WorkspaceMemberProfileEditorProps) {
  const normalizedInitialDisplayName = normalizeDisplayName(initialDisplayName);
  const normalizedInitialJobTitle = normalizeJobTitle(initialJobTitle);
  const [savedDisplayName, setSavedDisplayName] = useState(normalizedInitialDisplayName);
  const [savedJobTitle, setSavedJobTitle] = useState(normalizedInitialJobTitle);
  const [savedNotifications, setSavedNotifications] =
    useState<NotificationValues>(initialNotifications);
  const [displayNameInput, setDisplayNameInput] = useState(normalizedInitialDisplayName);
  const [jobTitleInput, setJobTitleInput] = useState(normalizedInitialJobTitle);
  const [notifications, setNotifications] = useState<NotificationValues>(initialNotifications);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedDisplayName = useMemo(
    () => normalizeDisplayName(displayNameInput),
    [displayNameInput],
  );
  const normalizedJobTitle = useMemo(() => normalizeJobTitle(jobTitleInput), [jobTitleInput]);
  const hasChanges =
    normalizedDisplayName !== savedDisplayName ||
    normalizedJobTitle !== savedJobTitle ||
    hasNotificationChanges(notifications, savedNotifications);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: normalizedDisplayName,
            jobTitle: normalizedJobTitle,
            notifications,
          }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | WorkspaceProfileApiResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to save workspace profile.");
      }

      const nextDisplayName =
        typeof result?.profile?.displayName === "string" && result.profile.displayName
          ? result.profile.displayName
          : normalizedDisplayName;
      const nextJobTitle =
        typeof result?.profile?.jobTitle === "string"
          ? result.profile.jobTitle
          : normalizedJobTitle;
      const nextNotifications = result?.profile?.notifications ?? notifications;
      const wasUpdated = result?.updated === true;

      setSavedDisplayName(nextDisplayName);
      setSavedJobTitle(nextJobTitle);
      setSavedNotifications(nextNotifications);
      setDisplayNameInput(nextDisplayName);
      setJobTitleInput(nextJobTitle);
      setNotifications(nextNotifications);
      setNotice(wasUpdated ? "Workspace profile updated." : "No profile changes.");
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to save workspace profile.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setDisplayNameInput(savedDisplayName);
    setJobTitleInput(savedJobTitle);
    setNotifications(savedNotifications);
    setError(null);
    setNotice(null);
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Workspace Display Name
          </span>
          <input
            value={displayNameInput}
            onChange={(event) => setDisplayNameInput(event.target.value)}
            placeholder="Your name in this workspace"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Job Title (Workspace)
          </span>
          <input
            value={jobTitleInput}
            onChange={(event) => setJobTitleInput(event.target.value)}
            placeholder="Role title in this workspace"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <ReadOnlyField label="Account Email" value={email || "Not set"} />
        <ReadOnlyField label="Workspace Role" value={roleLabel} />
        <ReadOnlyField label="Membership Status" value={statusLabel} />
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">
          Workspace Notifications
        </h3>
        <div className="mt-3 space-y-2">
          <PreferenceToggle
            label="Meeting digest emails"
            enabled={notifications.meetingDigests}
            onToggle={() =>
              setNotifications((prev) => ({
                ...prev,
                meetingDigests: !prev.meetingDigests,
              }))
            }
          />
          <PreferenceToggle
            label="Action due reminders"
            enabled={notifications.actionReminders}
            onToggle={() =>
              setNotifications((prev) => ({
                ...prev,
                actionReminders: !prev.actionReminders,
              }))
            }
          />
          <PreferenceToggle
            label="Weekly workspace summary"
            enabled={notifications.weeklySummary}
            onToggle={() =>
              setNotifications((prev) => ({
                ...prev,
                weeklySummary: !prev.weeklySummary,
              }))
            }
          />
          <PreferenceToggle
            label="Product announcements"
            enabled={notifications.productAnnouncements}
            onToggle={() =>
              setNotifications((prev) => ({
                ...prev,
                productAnnouncements: !prev.productAnnouncements,
              }))
            }
          />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        These values apply only to this workspace and do not change your account profile.
      </p>

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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleReset}
          disabled={!hasChanges || isSubmitting}
          className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Discard changes
        </button>
        <button
          type="submit"
          disabled={!hasChanges || isSubmitting}
          className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Save workspace profile"}
        </button>
      </div>
    </form>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
        {label}
      </span>
      <input
        value={value}
        readOnly
        className="w-full rounded-sm border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-600"
      />
    </label>
  );
}

function PreferenceToggle({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-sm border border-slate-200 bg-white px-3 py-2.5 text-left"
    >
      <span className="text-sm text-slate-700">{label}</span>
      <span
        className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${
          enabled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-slate-100 text-slate-700"
        }`}
      >
        {enabled ? "Enabled" : "Disabled"}
      </span>
    </button>
  );
}
