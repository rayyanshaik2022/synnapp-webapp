"use client";

import { useEffect, useRef } from "react";

type WorkspaceSearchBoxProps = {
  workspaceSlug: string;
  initialQuery: string;
  kind: "all" | "decision" | "action" | "meeting";
  updated: "all" | "7d" | "30d";
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

export function WorkspaceSearchBox({
  workspaceSlug,
  initialQuery,
  kind,
  updated,
}: WorkspaceSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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

  function handleClear() {
    if (!inputRef.current || !formRef.current) return;
    inputRef.current.value = "";
    formRef.current.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      action={`/${workspaceSlug}/search`}
      method="get"
      className="mt-5 rounded-lg border border-slate-300 bg-white px-3 py-2.5"
    >
      {kind !== "all" ? <input type="hidden" name="kind" value={kind} /> : null}
      {updated !== "all" ? <input type="hidden" name="updated" value={updated} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-400" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={inputRef}
          name="q"
          defaultValue={initialQuery}
          placeholder="Search titles, notes, owners, tags, IDs..."
          className="min-w-[220px] flex-1 bg-transparent text-sm text-slate-900 outline-none"
          autoComplete="off"
        />
        <button
          type="submit"
          className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
        >
          Search
        </button>
        {initialQuery ? (
          <button
            type="button"
            onClick={handleClear}
            className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
