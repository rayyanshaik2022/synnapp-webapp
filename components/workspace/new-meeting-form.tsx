"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeMeetingDraftPayload,
  type MeetingDraftPayload,
} from "@/lib/workspace/meeting-draft";

type NewMeetingFormProps = {
  workspaceSlug: string;
  initialDateISO: string;
};

type DraftRow = {
  id: string;
  value: string;
};

type CreateMeetingResponse = {
  error?: string;
  meetingId?: string;
};

function isValidDate(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const parsed = new Date(`${normalized}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function isValidTime(value: string) {
  const normalized = value.trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) return false;
  const [hoursRaw, minutesRaw] = normalized.split(":");
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);
  return (
    Number.isFinite(hours) &&
    Number.isFinite(minutes) &&
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  );
}

function parseScheduleDateTime(date: string, time: string) {
  if (!isValidDate(date) || !isValidTime(time)) return null;
  const parsed = new Date(`${date.trim()}T${time.trim()}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function NewMeetingForm({
  workspaceSlug,
  initialDateISO,
}: NewMeetingFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [date, setDate] = useState(initialDateISO);
  const [time, setTime] = useState("10:00");
  const [location, setLocation] = useState("Room Atlas + Zoom");
  const [attendees, setAttendees] = useState<DraftRow[]>([
    { id: "attendee-1", value: "You" },
    { id: "attendee-2", value: "Priya Shah" },
  ]);
  const [agenda, setAgenda] = useState<DraftRow[]>([
    { id: "agenda-1", value: "Review context and objective" },
    { id: "agenda-2", value: "Capture decisions and tradeoffs" },
    { id: "agenda-3", value: "Assign owners and due dates" },
  ]);
  const [nextAttendeeId, setNextAttendeeId] = useState(3);
  const [nextAgendaId, setNextAgendaId] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const attendeeCount = attendees.filter((attendee) => attendee.value.trim()).length;
  const agendaCount = agenda.filter((item) => item.value.trim()).length;
  const parsedScheduleDateTime = useMemo(
    () => parseScheduleDateTime(date, time),
    [date, time],
  );
  const dateTimeError = useMemo(() => {
    if (!date.trim() || !time.trim()) {
      return "Date and time are required.";
    }
    if (!isValidDate(date)) {
      return "Enter a valid date.";
    }
    if (!isValidTime(time)) {
      return "Enter a valid time.";
    }
    if (!parsedScheduleDateTime) {
      return "Meeting date/time is invalid.";
    }
    return null;
  }, [date, parsedScheduleDateTime, time]);
  const schedulePreview = useMemo(() => {
    if (!parsedScheduleDateTime) return "";
    return parsedScheduleDateTime.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [parsedScheduleDateTime]);

  const hasRequiredContent = useMemo(() => {
    return (
      title.trim().length > 0 &&
      objective.trim().length > 0 &&
      attendeeCount > 0 &&
      agendaCount > 0
    );
  }, [agendaCount, attendeeCount, objective, title]);

  const canSubmit = useMemo(
    () => hasRequiredContent && dateTimeError === null,
    [dateTimeError, hasRequiredContent],
  );

  function addAttendee() {
    setAttendees((prev) => [
      ...prev,
      { id: `attendee-${nextAttendeeId}`, value: "" },
    ]);
    setNextAttendeeId((value) => value + 1);
  }

  function addAgendaItem() {
    setAgenda((prev) => [...prev, { id: `agenda-${nextAgendaId}`, value: "" }]);
    setNextAgendaId((value) => value + 1);
  }

  function handleAttendeeChange(id: string, value: string) {
    setAttendees((prev) =>
      prev.map((attendee) =>
        attendee.id === id ? { ...attendee, value } : attendee,
      ),
    );
  }

  function handleAgendaChange(id: string, value: string) {
    setAgenda((prev) =>
      prev.map((item) => (item.id === id ? { ...item, value } : item)),
    );
  }

  function removeAttendee(id: string) {
    setAttendees((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((attendee) => attendee.id !== id);
    });
  }

  function removeAgendaItem(id: string) {
    setAgenda((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!hasRequiredContent) {
      setError(
        "Title, objective, at least one attendee, and one agenda item are required.",
      );
      return;
    }

    if (dateTimeError) {
      setError(dateTimeError);
      return;
    }

    const payload: MeetingDraftPayload = normalizeMeetingDraftPayload({
      title,
      objective,
      date,
      time,
      location,
      attendees: attendees.map((attendee) => attendee.value),
      agenda: agenda.map((item) => item.value),
    });

    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/meetings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: payload }),
        },
      );

      const result = (await response.json().catch(() => null)) as
        | CreateMeetingResponse
        | null;

      if (!response.ok) {
        throw new Error(result?.error ?? "Failed to create meeting.");
      }

      const meetingId = result?.meetingId?.trim();
      if (!meetingId) {
        throw new Error("Meeting was created, but no meeting ID was returned.");
      }

      router.push(`/${workspaceSlug}/meetings/${meetingId}`);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to create meeting.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Meeting title
        </span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Weekly Product Decisions"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
          Objective
        </span>
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          rows={3}
          placeholder="What should be decided or aligned in this meeting?"
          className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Date
          </span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Time
          </span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Location
          </span>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Room / Video Link"
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
      </div>

      <p
        className={`rounded-sm border px-3 py-2 text-xs ${
          dateTimeError
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        {dateTimeError ? dateTimeError : `Scheduled for ${schedulePreview}`}
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Attendees
          </p>
          <button
            type="button"
            onClick={addAttendee}
            className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Add attendee
          </button>
        </div>

        <div className="space-y-2">
          {attendees.map((attendee) => (
            <div key={attendee.id} className="flex items-center gap-2">
              <input
                value={attendee.value}
                onChange={(event) =>
                  handleAttendeeChange(attendee.id, event.target.value)
                }
                placeholder="Attendee name"
                className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <button
                type="button"
                onClick={() => removeAttendee(attendee.id)}
                className="rounded-sm border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-600">
            Agenda
          </p>
          <button
            type="button"
            onClick={addAgendaItem}
            className="rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Add agenda item
          </button>
        </div>

        <div className="space-y-2">
          {agenda.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <input
                value={item.value}
                onChange={(event) => handleAgendaChange(item.id, event.target.value)}
                placeholder="Agenda item"
                className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
              <button
                type="button"
                onClick={() => removeAgendaItem(item.id)}
                className="rounded-sm border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <p className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
        Submitting creates a real meeting record in your workspace and opens it for capture.
      </p>

      <button
        type="submit"
        disabled={!canSubmit || isSubmitting}
        className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Creating meeting..." : "Create meeting"}
      </button>
    </form>
  );
}
