import Link from "next/link";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="min-h-screen bg-[linear-gradient(158deg,#e8edf4_0%,#d8e1ed_50%,#e8edf4_100%)] px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center">
        <section className="grid w-full overflow-hidden rounded-2xl border border-slate-300/70 bg-[color:var(--surface)] shadow-[0_24px_52px_rgba(15,23,42,0.16)] lg:grid-cols-[1.06fr_0.94fr]">
          <aside className="hidden border-r border-slate-700 bg-[linear-gradient(165deg,#0f172a_0%,#1e293b_100%)] p-10 lg:flex lg:flex-col">
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-300">SYNNAPP OPERATIONS</p>
            <h2 className="mt-8 max-w-xl text-5xl font-semibold leading-[1.06] tracking-tight text-white">
              Decision systems that stay clear under pressure.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-6 text-slate-300">
              The interface is tuned for modern B2B operations: structured, minimal, and focused on high-signal actions.
            </p>

            <ul className="mt-9 space-y-3">
              <li className="rounded-md border border-slate-700 bg-slate-800/55 px-4 py-3 text-sm text-slate-200">
                Capture meeting decisions with rationale and audit context.
              </li>
              <li className="rounded-md border border-slate-700 bg-slate-800/55 px-4 py-3 text-sm text-slate-200">
                Turn decisions into owned actions and track completion.
              </li>
              <li className="rounded-md border border-slate-700 bg-slate-800/55 px-4 py-3 text-sm text-slate-200">
                Keep history searchable without losing source references.
              </li>
            </ul>

            <Link
              href="/"
              className="mt-auto inline-flex w-fit items-center rounded-sm border border-slate-500 bg-slate-900/25 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-300 hover:bg-slate-900/45"
            >
              Back to home
            </Link>
          </aside>

          <div className="p-5 sm:p-8 lg:p-10">
            <div className="mb-8 border-b border-slate-200 pb-4 lg:hidden">
              <p className="text-xs font-semibold tracking-[0.2em] text-slate-600">SYNNAPP OPERATIONS</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Workspace access</h2>
              <p className="mt-2 text-sm text-slate-600">Firebase authentication is active.</p>
            </div>
            <div className="mx-auto w-full max-w-md">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
