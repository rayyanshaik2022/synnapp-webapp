import type { ReactNode } from "react";

type WorkspacePanelProps = {
  children: ReactNode;
  className?: string;
};

type SummaryTileProps = {
  label: string;
  value: string;
  detail: string;
  className?: string;
};

type FilterChipProps = {
  label: string;
  active?: boolean;
  href?: string;
  className?: string;
};

function cx(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function WorkspacePanel({ children, className }: WorkspacePanelProps) {
  return (
    <section
      className={cx(
        "rounded-2xl border border-slate-200 bg-[color:var(--surface)] p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SummaryTile({ label, value, detail, className }: SummaryTileProps) {
  return (
    <article className={cx("rounded-lg border border-slate-200 bg-white px-4 py-3", className)}>
      <p className="text-[11px] font-semibold tracking-[0.13em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-900 [overflow-wrap:anywhere]">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </article>
  );
}

export function FilterChip({ label, active = false, href, className }: FilterChipProps) {
  const chipClassName = cx(
    active
      ? "rounded-sm border border-slate-500 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-900"
      : "rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-800",
    className,
  );

  if (href) {
    return (
      <a
        href={href}
        aria-label={`Jump to ${label}`}
        className={cx(
          "inline-flex items-center gap-1 rounded-sm border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-900 transition hover:border-slate-700 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
          className,
        )}
      >
        {label}
      </a>
    );
  }

  return (
    <button type="button" className={chipClassName}>
      {label}
    </button>
  );
}
