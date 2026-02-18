function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded bg-slate-200/90"
      style={{ width }}
      aria-hidden="true"
    />
  );
}

function SkeletonCard() {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="space-y-2">
        <SkeletonLine width="38%" />
        <SkeletonLine width="72%" />
        <SkeletonLine width="56%" />
      </div>
      <div className="mt-4 flex gap-2">
        <div className="h-6 w-20 rounded bg-slate-200/90" aria-hidden="true" />
        <div className="h-6 w-24 rounded bg-slate-200/90" aria-hidden="true" />
      </div>
    </article>
  );
}

export default function WorkspaceLoading() {
  return (
    <main className="space-y-6" aria-busy="true" aria-live="polite">
      <section className="rounded-2xl border border-slate-200 bg-[color:var(--surface)] p-5 shadow-sm sm:p-6">
        <div className="animate-pulse space-y-3">
          <SkeletonLine width="14%" />
          <div className="h-8 w-48 rounded bg-slate-200/90" aria-hidden="true" />
          <SkeletonLine width="62%" />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="h-20 rounded-lg border border-slate-200 bg-white" aria-hidden="true" />
          <div className="h-20 rounded-lg border border-slate-200 bg-white" aria-hidden="true" />
          <div className="h-20 rounded-lg border border-slate-200 bg-white" aria-hidden="true" />
        </div>
      </section>

      <section className="animate-pulse rounded-2xl border border-slate-200 bg-[color:var(--surface)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap gap-2">
          <div className="h-7 w-28 rounded bg-slate-200/90" aria-hidden="true" />
          <div className="h-7 w-24 rounded bg-slate-200/90" aria-hidden="true" />
          <div className="h-7 w-32 rounded bg-slate-200/90" aria-hidden="true" />
        </div>
      </section>

      <section className="animate-pulse space-y-3 rounded-2xl border border-slate-200 bg-[color:var(--surface)] p-5 shadow-sm sm:p-6">
        <div className="grid gap-3 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    </main>
  );
}
