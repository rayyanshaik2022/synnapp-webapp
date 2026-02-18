import Link from "next/link";

type WorkspaceNotFoundPageProps = Readonly<{
  searchParams: Promise<{
    workspace?: string | string[];
    fallback?: string | string[];
  }>;
}>;

function readFirst(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function WorkspaceNotFoundPage({
  searchParams,
}: WorkspaceNotFoundPageProps) {
  const resolvedSearchParams = await searchParams;
  const workspace = readFirst(resolvedSearchParams.workspace);
  const fallbackWorkspaceSlug = readFirst(resolvedSearchParams.fallback);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">WORKSPACE</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
        Workspace not found
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {workspace
          ? `The workspace "${workspace}" does not exist or is no longer available.`
          : "The workspace you requested does not exist or is no longer available."}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {fallbackWorkspaceSlug ? (
          <Link
            href={`/${fallbackWorkspaceSlug}/my-work`}
            className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--accent-strong)]"
          >
            Open my workspace
          </Link>
        ) : null}
        <Link
          href="/login"
          className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
        >
          Back to sign in
        </Link>
      </div>
    </section>
  );
}
