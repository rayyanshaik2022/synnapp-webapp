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
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </article>
  );
}

export function FilterChip({ label, active = false, className }: FilterChipProps) {
  return (
    <button
      type="button"
      className={cx(
        active
          ? "rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
          : "rounded-sm border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-600",
        className,
      )}
    >
      {label}
    </button>
  );
}
