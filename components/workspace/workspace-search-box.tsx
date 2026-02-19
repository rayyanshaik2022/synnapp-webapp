"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

type MentionOption = {
  uid: string;
  mentionToken: string;
  displayName: string;
  email: string;
};

type WorkspaceSearchBoxProps = {
  workspaceSlug: string;
  initialQuery: string;
  kind: "all" | "decision" | "action" | "meeting";
  updated: "all" | "7d" | "30d";
  sort: "relevance" | "recent";
  mentionOptions: MentionOption[];
};

type MentionContext = {
  start: number;
  end: number;
  token: string;
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  );
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMentionToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "")
    .trim();
}

function buildMentionSearchText(option: MentionOption) {
  return [
    option.mentionToken,
    option.displayName,
    option.email,
    normalizeMentionToken(option.displayName),
    normalizeMentionToken((option.email || "").split("@")[0] ?? ""),
  ]
    .join(" ")
    .toLowerCase();
}

function resolveMentionContext(value: string, cursor: number | null): MentionContext | null {
  const position = cursor ?? value.length;
  const prefix = value.slice(0, position);
  const match = prefix.match(/(?:^|\s)(@[^\s@]*)$/);

  if (!match || !match[1]) return null;

  const rawMention = match[1];
  const start = position - rawMention.length;

  return {
    start,
    end: position,
    token: normalizeMentionToken(rawMention.slice(1)),
  };
}

function mentionLabel(option: MentionOption) {
  const displayName = normalizeText(option.displayName);
  const email = normalizeText(option.email);

  if (displayName && email) return `${displayName} (${email})`;
  if (displayName) return displayName;
  if (email) return email;
  return option.uid;
}

function mentionSecondary(option: MentionOption) {
  const displayName = normalizeText(option.displayName);
  const email = normalizeText(option.email);
  if (displayName && email) return email;
  return "";
}

export function WorkspaceSearchBox({
  workspaceSlug,
  initialQuery,
  kind,
  updated,
  sort,
  mentionOptions,
}: WorkspaceSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [queryValue, setQueryValue] = useState(initialQuery);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(null);
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const mentionIndex = useMemo(() => {
    return mentionOptions.map((option) => ({
      ...option,
      searchText: buildMentionSearchText(option),
    }));
  }, [mentionOptions]);

  const filteredMentionOptions = useMemo(() => {
    if (!mentionContext) return [] as Array<(typeof mentionIndex)[number]>;

    const token = normalizeMentionToken(mentionContext.token);
    return mentionIndex
      .filter((option) => {
        if (!token) return true;
        return option.searchText.includes(token);
      })
      .slice(0, 8);
  }, [mentionContext, mentionIndex]);

  const showMentionDropdown =
    isMentionOpen && mentionContext !== null && filteredMentionOptions.length > 0;
  const maxMentionIndex = Math.max(filteredMentionOptions.length - 1, 0);
  const activeMentionIndexSafe = Math.min(activeMentionIndex, maxMentionIndex);

  function updateMentionContext(value: string, cursor: number | null) {
    setMentionContext(resolveMentionContext(value, cursor));
  }

  function insertMention(mentionToken: string) {
    if (!inputRef.current) return;

    const normalizedMention = normalizeMentionToken(mentionToken);
    if (!normalizedMention) return;

    const mention = `@${normalizedMention}`;
    const currentValue = queryValue;
    const currentContext = mentionContext;

    let nextValue = currentValue;
    let nextCursor = currentValue.length;

    if (currentContext) {
      const before = currentValue.slice(0, currentContext.start);
      const after = currentValue.slice(currentContext.end);
      const prefix = `${before}${mention}`;
      const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
      nextValue = `${prefix}${needsTrailingSpace ? " " : ""}${after}`;
      nextCursor = prefix.length + (needsTrailingSpace ? 1 : 0);
    } else {
      const base = normalizeText(currentValue);
      nextValue = base ? `${base} ${mention} ` : `${mention} `;
      nextCursor = nextValue.length;
    }

    setQueryValue(nextValue);
    setMentionContext(null);
    setIsMentionOpen(false);
    setActiveMentionIndex(0);

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setQueryValue(nextValue);
    updateMentionContext(nextValue, event.target.selectionStart);
    setIsMentionOpen(true);
  }

  function handleInputFocus() {
    setIsMentionOpen(true);
    updateMentionContext(queryValue, inputRef.current?.selectionStart ?? null);
  }

  function handleInputBlur() {
    window.setTimeout(() => {
      setIsMentionOpen(false);
    }, 120);
  }

  function handleInputCursorChange() {
    if (!inputRef.current) return;
    updateMentionContext(queryValue, inputRef.current.selectionStart);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!showMentionDropdown) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((current) =>
        Math.min(current + 1, Math.max(filteredMentionOptions.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      const option = filteredMentionOptions[activeMentionIndexSafe];
      if (!option) return;
      event.preventDefault();
      insertMention(option.mentionToken);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionContext(null);
      setIsMentionOpen(false);
      setActiveMentionIndex(0);
    }
  }

  function handleMentionMouseDown(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function handleClear() {
    if (!inputRef.current || !formRef.current) return;
    inputRef.current.value = "";
    setQueryValue("");
    setMentionContext(null);
    setIsMentionOpen(false);
    setActiveMentionIndex(0);
    formRef.current.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={`/${workspaceSlug}/search`}
      method="get"
      className="mt-5 rounded-xl border border-slate-400 bg-white p-1.5 shadow-sm transition focus-within:border-slate-600 focus-within:shadow"
    >
      {kind !== "all" ? <input type="hidden" name="kind" value={kind} /> : null}
      {updated !== "all" ? <input type="hidden" name="updated" value={updated} /> : null}
      {sort !== "relevance" ? <input type="hidden" name="sort" value={sort} /> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-[220px] flex-1">
          <label className="flex items-center gap-2 rounded-lg px-2.5 py-2.5">
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-600"
              aria-hidden="true"
            >
              ⌕
            </span>
            <input
              ref={inputRef}
              type="search"
              name="q"
              value={queryValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onKeyUp={handleInputCursorChange}
              onClick={handleInputCursorChange}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              placeholder="Search titles, notes, tags, IDs, or @person..."
              aria-label="Search workspace records"
              className="workspace-search-input min-w-0 flex-1 appearance-none bg-transparent text-sm text-slate-900 shadow-none outline-none ring-0 [-webkit-appearance:none] [box-shadow:none] placeholder:text-slate-500 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none"
              autoComplete="off"
            />
            <kbd className="hidden rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 sm:inline">
              /
            </kbd>
          </label>

          {showMentionDropdown ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-slate-300 bg-white p-1 shadow-[0_10px_24px_rgba(15,23,42,0.15)]">
              {filteredMentionOptions.map((option, index) => {
                const active = index === activeMentionIndexSafe;
                const secondary = mentionSecondary(option);

                return (
                  <button
                    key={`mention-option-${option.uid}`}
                    type="button"
                    onMouseDown={handleMentionMouseDown}
                    onMouseEnter={() => setActiveMentionIndex(index)}
                    onClick={() => insertMention(option.mentionToken)}
                    className={
                      active
                        ? "w-full rounded-md border border-slate-300 bg-slate-100 px-2.5 py-2 text-left"
                        : "w-full rounded-md px-2.5 py-2 text-left transition hover:bg-slate-100"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900">
                        @{option.mentionToken}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600">
                        {mentionLabel(option)}
                      </span>
                    </div>
                    {secondary ? (
                      <p className="mt-0.5 text-[11px] text-slate-600">{secondary}</p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 self-end border-t border-slate-300 pt-1 sm:self-auto sm:border-t-0 sm:border-l sm:pl-2 sm:pt-0">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-950"
          >
            Search
          </button>
          {queryValue.trim() ? (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md px-2.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
