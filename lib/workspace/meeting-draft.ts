export type MeetingDraftPayload = {
  title: string;
  objective: string;
  date: string;
  time: string;
  location: string;
  attendees: string[];
  agenda: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sanitizeList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function sanitizeText(value: string) {
  return value.trim();
}

export function normalizeMeetingDraftPayload(
  payload: MeetingDraftPayload,
): MeetingDraftPayload {
  return {
    title: sanitizeText(payload.title),
    objective: sanitizeText(payload.objective),
    date: sanitizeText(payload.date),
    time: sanitizeText(payload.time),
    location: sanitizeText(payload.location),
    attendees: sanitizeList(payload.attendees),
    agenda: sanitizeList(payload.agenda),
  };
}

export function parseMeetingDraftPayload(input: unknown): MeetingDraftPayload | null {
  if (!input || typeof input !== "object") return null;

  const raw = input as Partial<MeetingDraftPayload>;

  if (
    typeof raw.title !== "string" ||
    typeof raw.objective !== "string" ||
    typeof raw.date !== "string" ||
    typeof raw.time !== "string" ||
    typeof raw.location !== "string" ||
    !isStringArray(raw.attendees) ||
    !isStringArray(raw.agenda)
  ) {
    return null;
  }

  return normalizeMeetingDraftPayload({
    title: raw.title,
    objective: raw.objective,
    date: raw.date,
    time: raw.time,
    location: raw.location,
    attendees: raw.attendees,
    agenda: raw.agenda,
  });
}
