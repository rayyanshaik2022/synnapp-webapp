import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-xl backdrop-blur sm:p-10">
        <p className="mb-4 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs tracking-[0.2em] text-slate-600">
          SYNN
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Firebase auth is live.
        </h1>
        <p className="mt-3 text-slate-600">
          Sign in and sign up now connect to Firebase Authentication with email/password and Google.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="rounded-xl bg-[color:var(--accent)] px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
          >
            Open sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-slate-500"
          >
            Open sign up
          </Link>
          <Link
            href="/acme-corp/my-work"
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-slate-500"
          >
            Open my work
          </Link>
        </div>
      </section>
    </main>
  );
}
