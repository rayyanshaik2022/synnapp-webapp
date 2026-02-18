import { type DocumentReference, Timestamp } from "firebase-admin/firestore";
import type {
  CanonicalEntityType,
  CanonicalHistoryEventType,
  CanonicalHistorySource,
} from "@/lib/workspace/history-types";

export type {
  CanonicalEntityType,
  CanonicalHistoryEventType,
  CanonicalHistorySource,
} from "@/lib/workspace/history-types";

type WriteCanonicalHistoryEventInput = {
  entityRef: DocumentReference;
  entity: CanonicalEntityType;
  eventType: CanonicalHistoryEventType;
  source: CanonicalHistorySource;
  actorUid: string;
  actorName?: string;
  message: string;
  at?: Timestamp;
  metadata?: Record<string, unknown>;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeMetadata(value: Record<string, unknown> | undefined) {
  if (!value) return null;

  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

export async function writeCanonicalHistoryEvent({
  entityRef,
  entity,
  eventType,
  source,
  actorUid,
  actorName,
  message,
  at,
  metadata,
}: WriteCanonicalHistoryEventInput) {
  const cleanedMessage = normalizeText(message);
  const cleanedMetadata = sanitizeMetadata(metadata);

  await entityRef.collection("history").add({
    entity,
    eventType,
    source,
    actorUid: normalizeText(actorUid),
    actorName: normalizeText(actorName) || "Workspace User",
    message: cleanedMessage || `${entity} ${eventType}`,
    at: at ?? Timestamp.now(),
    ...(cleanedMetadata ? { metadata: cleanedMetadata } : {}),
  });
}

export function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
