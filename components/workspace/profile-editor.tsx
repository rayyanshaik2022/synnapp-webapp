"use client";

import { FormEvent, useMemo, useState } from "react";

type ProfileValues = {
  fullName: string;
  email: string;
  phone: string;
  timezone: string;
  bio: string;
};

type ProfileEditorProps = {
  initialProfile: ProfileValues;
};

type ProfileApiResponse = {
  error?: string;
  profile?: ProfileValues;
};

function hasProfileChanges(a: ProfileValues, b: ProfileValues) {
  return (
    a.fullName !== b.fullName ||
    a.email !== b.email ||
    a.phone !== b.phone ||
    a.timezone !== b.timezone ||
    a.bio !== b.bio
  );
}

export function ProfileEditor({ initialProfile }: ProfileEditorProps) {
  const [savedProfile, setSavedProfile] = useState<ProfileValues>(initialProfile);
  const [profile, setProfile] = useState<ProfileValues>(initialProfile);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isDirty = useMemo(() => hasProfileChanges(profile, savedProfile), [profile, savedProfile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: profile.fullName,
          phone: profile.phone,
          timezone: profile.timezone,
          bio: profile.bio,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | ProfileApiResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to save profile.");
      }

      const nextProfile = result?.profile ?? profile;
      setProfile(nextProfile);
      setSavedProfile(nextProfile);
      setNotice("Profile saved.");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to save profile.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setProfile(savedProfile);
    setError(null);
    setNotice(null);
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ProfileField
          label="Full Name"
          value={profile.fullName}
          onChange={(value) => setProfile((prev) => ({ ...prev, fullName: value }))}
          placeholder="Your name"
        />
        <ProfileField
          label="Email"
          type="email"
          value={profile.email}
          onChange={() => undefined}
          placeholder="you@company.com"
          readOnly
        />
        <ProfileField
          label="Phone"
          value={profile.phone}
          onChange={(value) => setProfile((prev) => ({ ...prev, phone: value }))}
          placeholder="+1 555 0100"
        />
      </div>

      <p className="text-xs text-slate-500">
        Email is managed by your authentication provider and cannot be edited here.
      </p>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Timezone
        </span>
        <select
          value={profile.timezone}
          onChange={(event) =>
            setProfile((prev) => ({ ...prev, timezone: event.target.value }))
          }
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        >
          <option value="America/Los_Angeles">America/Los_Angeles</option>
          <option value="America/Denver">America/Denver</option>
          <option value="America/Chicago">America/Chicago</option>
          <option value="America/New_York">America/New_York</option>
          <option value="Europe/London">Europe/London</option>
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Bio
        </span>
        <textarea
          value={profile.bio}
          onChange={(event) => setProfile((prev) => ({ ...prev, bio: event.target.value }))}
          rows={3}
          placeholder="A short summary about your role and focus."
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

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
          disabled={!isDirty || isSubmitting}
          className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Discard changes
        </button>
        <button
          type="submit"
          disabled={!isDirty || isSubmitting}
          className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "email";
  readOnly?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-sm border px-3 py-2.5 text-sm ${
          readOnly
            ? "border-slate-200 bg-slate-100 text-slate-500"
            : "border-slate-300 bg-white text-slate-900"
        }`}
      />
    </label>
  );
}
