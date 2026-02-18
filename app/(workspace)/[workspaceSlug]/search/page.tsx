import Link from "next/link";
import { WorkspacePanel } from "@/components/workspace/primitives";
import { WorkspaceSearchBox } from "@/components/workspace/workspace-search-box";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceSearchPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    q?: string | string[];
    kind?: string | string[];
    updated?: string | string[];
  }>;
}>;

type SearchKind = "decision" | "action" | "meeting";
type SearchScope = "all" | SearchKind;
type UpdatedWindow = "all" | "7d" | "30d";

type SearchResult = {
  id: string;
  kind: SearchKind;
  title: string;
  snippet: string;
  updatedLabel: string;
  updatedAtEpoch: number;
  ownerLabel: string;
  href: string;
  tags: string[];
  statusLabel: string;
  searchText: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function parseObjectTextArray(value: unknown, key: string) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      return normalizeText((entry as Record<string, unknown>)[key]);
    })
    .filter(Boolean);
}

function parseSearchScope(value: string | string[] | undefined): SearchScope {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();
  if (normalized === "decision" || normalized === "action" || normalized === "meeting") {
    return normalized;
  }
  return "all";
}

function parseUpdatedWindow(value: string | string[] | undefined): UpdatedWindow {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();
  if (normalized === "7d" || normalized === "30d") return normalized;
  return "all";
}

function parseQuery(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return normalizeText(candidate);
}

function searchHref(
  workspaceSlug: string,
  query: string,
  kind: SearchScope,
  updated: UpdatedWindow,
) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (kind !== "all") params.set("kind", kind);
  if (updated !== "all") params.set("updated", updated);
  const serialized = params.toString();
  return serialized
    ? `/${workspaceSlug}/search?${serialized}`
    : `/${workspaceSlug}/search`;
}

function queryChipClass(active: boolean) {
  return active
    ? "rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
    : "rounded-sm border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-600 transition hover:border-slate-300 hover:text-slate-800";
}

function kindStyle(kind: SearchKind) {
  if (kind === "decision") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (kind === "action") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-violet-200 bg-violet-50 text-violet-700";
}

function kindLabel(kind: SearchKind) {
  return kind[0].toUpperCase() + kind.slice(1);
}

function titleCase(value: string) {
  if (!value) return "";
  return value[0].toUpperCase() + value.slice(1);
}

function formatUpdatedLabel(date: Date | null) {
  if (!date) return "Updated recently";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clipSnippet(value: string, max = 180) {
  const normalized = normalizeText(value);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function tokenize(query: string) {
  return normalizeText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function buildSearchText(parts: Array<string | undefined>) {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function includesAllTokens(haystack: string, tokens: string[]) {
  return tokens.every((token) => haystack.includes(token));
}

function computeSearchScore(result: SearchResult, tokens: string[]) {
  if (tokens.length === 0) return 0;

  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) score += 12;
    if (snippet.includes(token)) score += 5;
    if (result.searchText.includes(token)) score += 2;
  }

  if (title.includes(tokens.join(" "))) {
    score += 12;
  }

  return score;
}

function parseMeetingState(value: unknown) {
  const state = normalizeText(value);
  if (state === "scheduled" || state === "inProgress" || state === "completed") {
    return state;
  }
  return "scheduled";
}

function parseDigestState(value: unknown) {
  const digest = normalizeText(value);
  if (digest === "pending" || digest === "sent") return digest;
  return "pending";
}

function meetingStateLabel(state: string) {
  if (state === "inProgress") return "In Progress";
  return titleCase(state);
}

export default async function WorkspaceSearchPage({
  params,
  searchParams,
}: WorkspaceSearchPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const query = parseQuery(resolvedSearchParams.q);
  const scope = parseSearchScope(resolvedSearchParams.kind);
  const updated = parseUpdatedWindow(resolvedSearchParams.updated);
  const tokens = tokenize(query);

  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || "Workspace";
  const workspaceRef = adminDb.collection("workspaces").doc(access.workspaceId);

  const decisionsRef = workspaceRef.collection("decisions");
  const actionsRef = workspaceRef.collection("actions");
  const meetingsRef = workspaceRef.collection("meetings");

  const [decisionSnapshots, actionSnapshots, meetingSnapshots] = await Promise.all([
    decisionsRef
      .orderBy("updatedAt", "desc")
      .limit(220)
      .get()
      .catch(() => decisionsRef.limit(220).get()),
    actionsRef
      .orderBy("updatedAt", "desc")
      .limit(220)
      .get()
      .catch(() => actionsRef.limit(220).get()),
    meetingsRef
      .orderBy("updatedAt", "desc")
      .limit(220)
      .get()
      .catch(() => meetingsRef.limit(220).get()),
  ]);

  const decisionResults = decisionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      if (data.archived === true) return null;

      const title = normalizeText(data.title) || `Decision ${snapshot.id}`;
      const statement = normalizeText(data.statement);
      const rationale = normalizeText(data.rationale);
      const owner = normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned";
      const status = normalizeText(data.status) || "proposed";
      const tags = parseStringArray(data.tags).slice(0, 4);
      const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);

      return {
        id: snapshot.id,
        kind: "decision",
        title,
        snippet: clipSnippet(statement || rationale || "No decision summary yet."),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAtEpoch: updatedAt?.getTime() ?? 0,
        ownerLabel: `Owner ${owner}`,
        href: `/${workspaceSlugForNav}/decisions/${snapshot.id}`,
        tags,
        statusLabel: titleCase(status),
        searchText: buildSearchText([
          snapshot.id,
          title,
          statement,
          rationale,
          owner,
          tags.join(" "),
          normalizeText(data.meetingId),
        ]),
      } satisfies SearchResult;
    })
    .filter((result): result is SearchResult => result !== null);

  const actionResults = actionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      if (data.archived === true) return null;

      const title =
        normalizeText(data.title) ||
        normalizeText(data.description) ||
        `Action ${snapshot.id}`;
      const description =
        normalizeText(data.description) ||
        normalizeText(data.notes) ||
        normalizeText(data.blockedReason);
      const owner = normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned";
      const status = normalizeText(data.status) || "open";
      const project =
        normalizeText(data.project) ||
        normalizeText(data.teamLabel) ||
        normalizeText(data.team);
      const dueLabel = normalizeText(data.dueLabel);
      const priority = normalizeText(data.priority);
      const updatedAt =
        parseDate(data.updatedAt) ?? parseDate(data.completedAt) ?? parseDate(data.createdAt);
      const tags = [project, priority ? `priority:${priority}` : ""].filter(Boolean);

      return {
        id: snapshot.id,
        kind: "action",
        title,
        snippet: clipSnippet(
          description || `Owner ${owner}${dueLabel ? ` • Due ${dueLabel}` : ""}`,
        ),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAtEpoch: updatedAt?.getTime() ?? 0,
        ownerLabel: `Owner ${owner}`,
        href: `/${workspaceSlugForNav}/actions/${snapshot.id}`,
        tags: tags.slice(0, 4),
        statusLabel: titleCase(status),
        searchText: buildSearchText([
          snapshot.id,
          title,
          description,
          owner,
          status,
          project,
          dueLabel,
          priority,
          normalizeText(data.meetingId),
          normalizeText(data.decisionId),
        ]),
      } satisfies SearchResult;
    })
    .filter((result): result is SearchResult => result !== null);

  const meetingResults = meetingSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      const title = normalizeText(data.title) || `Meeting ${snapshot.id}`;
      const objective = normalizeText(data.objective);
      const owner = normalizeText(data.owner) || "Workspace User";
      const team = normalizeText(data.team) || "Workspace";
      const location = normalizeText(data.location);
      const timeLabel = normalizeText(data.timeLabel);
      const state = parseMeetingState(data.state);
      const digest = parseDigestState(data.digest);
      const attendees = parseObjectTextArray(data.attendees, "name");
      const agenda = parseObjectTextArray(data.agenda, "title");
      const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);
      const tags = [
        team,
        state === "inProgress" ? "in-progress" : state,
        digest === "sent" ? "digest-sent" : "digest-pending",
      ].filter(Boolean);

      return {
        id: snapshot.id,
        kind: "meeting",
        title,
        snippet: clipSnippet(objective || `Team ${team}${location ? ` • ${location}` : ""}`),
        updatedLabel: formatUpdatedLabel(updatedAt),
        updatedAtEpoch: updatedAt?.getTime() ?? 0,
        ownerLabel: `Owner ${owner}`,
        href: `/${workspaceSlugForNav}/meetings/${snapshot.id}`,
        tags: tags.slice(0, 4),
        statusLabel: `${meetingStateLabel(state)} • ${
          digest === "sent" ? "Digest Sent" : "Digest Pending"
        }`,
        searchText: buildSearchText([
          snapshot.id,
          title,
          objective,
          owner,
          team,
          location,
          timeLabel,
          state,
          digest,
          attendees.join(" "),
          agenda.join(" "),
        ]),
      } satisfies SearchResult;
    })
    .filter((result): result is SearchResult => result !== null);

  const allResults = [...decisionResults, ...actionResults, ...meetingResults];
  const now =
    parseDate(decisionSnapshots.readTime)?.getTime() ??
    parseDate(actionSnapshots.readTime)?.getTime() ??
    parseDate(meetingSnapshots.readTime)?.getTime() ??
    0;
  const updatedCutoff =
    updated === "7d"
      ? now - 7 * 24 * 60 * 60 * 1000
      : updated === "30d"
        ? now - 30 * 24 * 60 * 60 * 1000
        : null;

  const matchedByQueryAndWindow = allResults.filter((result) => {
    if (updatedCutoff !== null && result.updatedAtEpoch < updatedCutoff) {
      return false;
    }
    if (tokens.length > 0 && !includesAllTokens(result.searchText, tokens)) {
      return false;
    }
    return true;
  });

  const decisionCount = matchedByQueryAndWindow.filter((item) => item.kind === "decision").length;
  const actionCount = matchedByQueryAndWindow.filter((item) => item.kind === "action").length;
  const meetingCount = matchedByQueryAndWindow.filter((item) => item.kind === "meeting").length;

  const kindFilteredResults =
    scope === "all"
      ? matchedByQueryAndWindow
      : matchedByQueryAndWindow.filter((result) => result.kind === scope);

  const visibleResults = kindFilteredResults
    .map((result) => ({
      result,
      score: computeSearchScore(result, tokens),
    }))
    .sort((a, b) => {
      if (tokens.length > 0 && b.score !== a.score) {
        return b.score - a.score;
      }
      return (
        b.result.updatedAtEpoch - a.result.updatedAtEpoch ||
        a.result.id.localeCompare(b.result.id)
      );
    })
    .slice(0, 140)
    .map((entry) => entry.result);

  const hasFilters = query !== "" || scope !== "all" || updated !== "all";

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Search</h1>
            <p className="mt-2 text-sm text-slate-600">
              Search decisions, actions, and meeting records across this workspace.
            </p>
          </div>
          <span className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700">
            {visibleResults.length} matches
          </span>
        </div>

        <WorkspaceSearchBox
          workspaceSlug={workspaceSlugForNav}
          initialQuery={query}
          kind={scope}
          updated={updated}
        />

        <p className="mt-2 text-xs text-slate-500">
          Tip: press <kbd className="rounded border border-slate-300 bg-white px-1">/</kbd> to jump to search.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={searchHref(workspaceSlugForNav, query, "all", updated)}
            className={queryChipClass(scope === "all")}
          >
            All Results {matchedByQueryAndWindow.length}
          </Link>
          <Link
            href={searchHref(workspaceSlugForNav, query, "decision", updated)}
            className={queryChipClass(scope === "decision")}
          >
            Decisions {decisionCount}
          </Link>
          <Link
            href={searchHref(workspaceSlugForNav, query, "action", updated)}
            className={queryChipClass(scope === "action")}
          >
            Actions {actionCount}
          </Link>
          <Link
            href={searchHref(workspaceSlugForNav, query, "meeting", updated)}
            className={queryChipClass(scope === "meeting")}
          >
            Meetings {meetingCount}
          </Link>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href={searchHref(workspaceSlugForNav, query, scope, "all")}
            className={queryChipClass(updated === "all")}
          >
            Any Time
          </Link>
          <Link
            href={searchHref(workspaceSlugForNav, query, scope, "7d")}
            className={queryChipClass(updated === "7d")}
          >
            Last 7 Days
          </Link>
          <Link
            href={searchHref(workspaceSlugForNav, query, scope, "30d")}
            className={queryChipClass(updated === "30d")}
          >
            Last 30 Days
          </Link>
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Results</h2>
          <span className="text-sm text-slate-600">
            {query ? `${visibleResults.length} matches for "${query}"` : `${visibleResults.length} recent items`}
          </span>
        </div>

        <div className="space-y-3">
          {visibleResults.map((result) => (
            <article
              key={`${result.kind}-${result.id}`}
              className="rounded-lg border border-slate-200 bg-white px-4 py-4 transition hover:border-slate-300"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{result.title}</p>
                  <p className="mt-1 text-sm text-slate-700">{result.snippet}</p>
                </div>
                <span
                  className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${kindStyle(result.kind)}`}
                >
                  {kindLabel(result.kind)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-slate-700">
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  {result.id}
                </span>
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  {result.ownerLabel}
                </span>
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  {result.updatedLabel}
                </span>
                <span className="rounded-sm border border-slate-200 bg-slate-100 px-2 py-1">
                  {result.statusLabel}
                </span>
              </div>

              {result.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {result.tags.map((tag) => (
                    <span
                      key={`${result.kind}-${result.id}-${tag}`}
                      className="rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex items-center justify-end">
                <Link
                  href={result.href}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                >
                  Open result
                </Link>
              </div>
            </article>
          ))}

          {visibleResults.length === 0 ? (
            <div className="space-y-3">
              <p className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {query
                  ? `No results for "${query}". Try fewer keywords or broaden filters.`
                  : "No searchable workspace records yet. Create meetings, decisions, or actions first."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {hasFilters ? (
                  <Link
                    href={searchHref(workspaceSlugForNav, "", "all", "all")}
                    className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                  >
                    Clear filters
                  </Link>
                ) : null}
                <Link
                  href={`/${workspaceSlugForNav}/meetings/new`}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                >
                  New meeting
                </Link>
                <Link
                  href={`/${workspaceSlugForNav}/decisions/new`}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                >
                  New decision
                </Link>
                <Link
                  href={`/${workspaceSlugForNav}/actions/new`}
                  className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
                >
                  New action
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </WorkspacePanel>
    </main>
  );
}
