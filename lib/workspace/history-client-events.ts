import type {
  CanonicalEntityType,
  CanonicalHistoryEventType,
  CanonicalHistorySource,
} from "@/lib/workspace/history-types";

export type ClientEntityHistoryItem = {
  id: string;
  actorName: string;
  message: string;
  eventType: CanonicalHistoryEventType;
  source: CanonicalHistorySource;
  atLabel: string;
};

export type ClientEntityHistoryEventDetail = {
  entity: CanonicalEntityType;
  entityId: string;
  entry: ClientEntityHistoryItem;
};

export const ENTITY_HISTORY_EVENT_NAME = "synn:entity-history-event";

export function emitEntityHistoryEvent(detail: ClientEntityHistoryEventDetail) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ClientEntityHistoryEventDetail>(ENTITY_HISTORY_EVENT_NAME, {
      detail,
    }),
  );
}
