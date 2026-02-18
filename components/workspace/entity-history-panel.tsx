"use client";

import { useEffect, useState } from "react";
import { WorkspacePanel } from "@/components/workspace/primitives";
import {
  ENTITY_HISTORY_EVENT_NAME,
  type ClientEntityHistoryEventDetail,
} from "@/lib/workspace/history-client-events";
import { type CanonicalEntityType, type CanonicalHistoryEventType, type CanonicalHistorySource } from "@/lib/workspace/history-types";

export type EntityHistoryItem = {
  id: string;
  actorName: string;
  message: string;
  eventType: CanonicalHistoryEventType;
  source: CanonicalHistorySource;
  atLabel: string;
};

type EntityHistoryPanelProps = {
  title: string;
  emptyLabel: string;
  entity: CanonicalEntityType;
  entityId: string;
  entries: EntityHistoryItem[];
};

function eventTypeLabel(eventType: CanonicalHistoryEventType) {
  if (eventType === "created") return "Created";
  if (eventType === "updated") return "Updated";
  if (eventType === "archived") return "Archived";
  return "Restored";
}

function eventTypeStyle(eventType: CanonicalHistoryEventType) {
  if (eventType === "created") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (eventType === "updated") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (eventType === "archived") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function sourceLabel(source: CanonicalHistorySource) {
  return source === "meetingSync" ? "Meeting Sync" : "Manual";
}

export function EntityHistoryPanel({
  title,
  emptyLabel,
  entity,
  entityId,
  entries,
}: EntityHistoryPanelProps) {
  const [liveEntries, setLiveEntries] = useState(entries);

  useEffect(() => {
    setLiveEntries(entries);
  }, [entries]);

  useEffect(() => {
    function handleHistoryEvent(rawEvent: Event) {
      const event = rawEvent as CustomEvent<ClientEntityHistoryEventDetail>;
      const detail = event.detail;

      if (!detail || detail.entity !== entity || detail.entityId !== entityId) {
        return;
      }

      setLiveEntries((prev) => [detail.entry, ...prev].slice(0, 12));
    }

    window.addEventListener(ENTITY_HISTORY_EVENT_NAME, handleHistoryEvent as EventListener);
    return () => {
      window.removeEventListener(ENTITY_HISTORY_EVENT_NAME, handleHistoryEvent as EventListener);
    };
  }, [entity, entityId]);

  return (
    <WorkspacePanel>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
        <span className="text-xs font-semibold tracking-[0.1em] text-slate-600">
          {liveEntries.length} event{liveEntries.length === 1 ? "" : "s"}
        </span>
      </div>

      {liveEntries.length === 0 ? (
        <p className="mt-3 rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          {emptyLabel}
        </p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {liveEntries.map((entry) => (
            <article
              key={entry.id}
              className="rounded-sm border border-slate-200 bg-white px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${eventTypeStyle(entry.eventType)}`}
                >
                  {eventTypeLabel(entry.eventType)}
                </span>
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
                  {sourceLabel(entry.source)}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-900">{entry.message}</p>
              <p className="mt-1 text-xs text-slate-600">
                {entry.actorName} • {entry.atLabel}
              </p>
            </article>
          ))}
        </div>
      )}
    </WorkspacePanel>
  );
}
