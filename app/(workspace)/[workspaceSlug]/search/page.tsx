import type { ReactNode } from "react";
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
    sort?: string | string[];
    page?: string | string[];
  }>;
}>;

type SearchKind = "decision" | "action" | "meeting";
type SearchScope = "all" | SearchKind;
type UpdatedWindow = "all" | "7d" | "30d";
type SearchSortMode = "relevance" | "recent";

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
  userSearchText: string;
};

type MeetingState = "scheduled" | "inProgress" | "completed";
type DigestState = "pending" | "sent";
type MemberSearchOption = {
  uid: string;
  displayName: string;
  email: string;
  mentionToken: string;
  searchText: string;
};

const SEARCH_FETCH_LIMIT_PER_KIND = 220;
const SEARCH_RESULTS_PER_PAGE = 30;
const SEARCH_MEMBER_CHIP_LIMIT = 10;

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

function parseAttendeePeople(value: unknown) {
  if (!Array.isArray(value)) {
    return {
      names: [] as string[],
      emails: [] as string[],
      uids: [] as string[],
    };
  }

  const names: string[] = [];
  const emails: string[] = [];
  const uids: string[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = normalizeText(record.name);
    const email = normalizeText(record.email);
    const uid = normalizeText(record.uid);

    if (name) names.push(name);
    if (email) emails.push(email);
    if (uid) uids.push(uid);
  }

  return {
    names,
    emails,
    uids,
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
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

function parseSearchSortMode(value: string | string[] | undefined): SearchSortMode {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();
  if (normalized === "recent") return "recent";
  return "relevance";
}

function parsePage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(normalizeText(candidate), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function parseQuery(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return normalizeText(candidate);
}

function normalizeMentionToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/g, "")
    .trim();
}

function parseQueryTokens(query: string) {
  const rawTokens = normalizeText(query).split(/\s+/).filter(Boolean);
  const mentionTokens = rawTokens
    .filter((token) => token.startsWith("@"))
    .map((token) => normalizeMentionToken(token))
    .filter(Boolean);
  const textTokens = rawTokens
    .filter((token) => !token.startsWith("@"))
    .flatMap((token) => tokenize(token));

  return {
    mentionTokens,
    textTokens,
  };
}

function normalizeTokenSource(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toMentionToken(displayName: string, email: string, uid: string) {
  const display = normalizeTokenSource(displayName).replace(/\s+/g, "-");
  if (display) return display.slice(0, 32);

  const emailHandle = normalizeText(email).split("@")[0] ?? "";
  const emailToken = normalizeMentionToken(emailHandle);
  if (emailToken) return emailToken.slice(0, 32);

  return normalizeMentionToken(uid).slice(0, 32) || "user";
}

function buildUserSearchText(parts: Array<string | undefined>) {
  const expanded = parts.flatMap((part) => {
    const normalized = normalizeText(part);
    if (!normalized) return [] as string[];

    const canonical = normalizeTokenSource(normalized);
    const dashed = canonical.replace(/\s+/g, "-");
    const compact = canonical.replace(/\s+/g, "");
    const mentionToken = normalizeMentionToken(normalized);

    return [normalized, canonical, dashed, compact, mentionToken].filter(Boolean);
  });

  return buildSearchText(expanded);
}

function appendMentionToQuery(query: string, mentionToken: string) {
  const nextMention = `@${normalizeMentionToken(mentionToken)}`;
  if (nextMention === "@") return query;

  const existing = normalizeText(query);
  if (!existing) return nextMention;

  const existingMentions = new Set(
    existing
      .split(/\s+/)
      .map((token) => normalizeMentionToken(token))
      .filter(Boolean),
  );

  if (existingMentions.has(nextMention.slice(1))) {
    return existing;
  }

  return `${existing} ${nextMention}`;
}

function searchHref({
  workspaceSlug,
  query,
  kind,
  updated,
  sort,
  page = 1,
}: {
  workspaceSlug: string;
  query: string;
  kind: SearchScope;
  updated: UpdatedWindow;
  sort: SearchSortMode;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (kind !== "all") params.set("kind", kind);
  if (updated !== "all") params.set("updated", updated);
  if (sort !== "relevance") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized
    ? `/${workspaceSlug}/search?${serialized}`
    : `/${workspaceSlug}/search`;
}

function queryChipClass(active: boolean) {
  return active
    ? "rounded-md border border-cyan-500 bg-cyan-100 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-cyan-950"
    : "rounded-md border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-800 transition hover:border-slate-500 hover:bg-slate-100 hover:text-slate-950";
}

function kindStyle(kind: SearchKind) {
  if (kind === "decision") return "border-cyan-500 bg-cyan-100 text-cyan-950";
  if (kind === "action") return "border-emerald-500 bg-emerald-100 text-emerald-950";
  return "border-indigo-500 bg-indigo-100 text-indigo-950";
}

function kindLabel(kind: SearchKind) {
  return kind[0].toUpperCase() + kind.slice(1);
}

function resultCardClass(kind: SearchKind) {
  if (kind === "decision") {
    return "rounded-lg border border-slate-400 border-l-4 border-l-cyan-600 bg-white px-4 py-4 shadow-sm transition hover:border-slate-500 hover:shadow";
  }
  if (kind === "action") {
    return "rounded-lg border border-slate-400 border-l-4 border-l-emerald-600 bg-white px-4 py-4 shadow-sm transition hover:border-slate-500 hover:shadow";
  }
  return "rounded-lg border border-slate-400 border-l-4 border-l-indigo-600 bg-white px-4 py-4 shadow-sm transition hover:border-slate-500 hover:shadow";
}

function resultMetaClass(tone: "id" | "owner" | "updated" | "status") {
  if (tone === "id") return "border-slate-400 bg-slate-100 text-slate-900";
  if (tone === "owner") return "border-cyan-300 bg-cyan-50 text-cyan-900";
  if (tone === "updated") return "border-indigo-300 bg-indigo-50 text-indigo-900";
  return "border-emerald-300 bg-emerald-50 text-emerald-900";
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatches(value: string, tokens: string[]): ReactNode {
  const normalized = normalizeText(value);
  if (!normalized || tokens.length === 0) return normalized;

  const uniqueTokens = Array.from(new Set(tokens))
    .map((token) => token.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (uniqueTokens.length === 0) return normalized;

  const tokenSet = new Set(uniqueTokens.map((token) => token.toLowerCase()));
  const pattern = uniqueTokens.map((token) => escapeRegex(token)).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = normalized.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;
    if (!tokenSet.has(part.toLowerCase())) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }
    return (
      <mark
        key={`${part}-${index}`}
        className="rounded-[2px] bg-amber-100 px-0.5 text-slate-900"
      >
        {part}
      </mark>
    );
  });
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

function parseMeetingState(value: unknown): MeetingState {
  const state = normalizeText(value);
  if (state === "scheduled") return "scheduled";
  if (state === "inProgress") return "inProgress";
  if (state === "completed") return "completed";
  return "scheduled";
}

function parseDigestState(value: unknown): DigestState {
  const digest = normalizeText(value);
  if (digest === "pending") return "pending";
  if (digest === "sent") return "sent";
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
  const requestedSortMode = parseSearchSortMode(resolvedSearchParams.sort);
  const requestedPage = parsePage(resolvedSearchParams.page);
  const { mentionTokens, textTokens } = parseQueryTokens(query);
  const sortMode: SearchSortMode = query ? requestedSortMode : "recent";

  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || "Workspace";
  const workspaceRef = adminDb.collection("workspaces").doc(access.workspaceId);

  const decisionsRef = workspaceRef.collection("decisions");
  const actionsRef = workspaceRef.collection("actions");
  const meetingsRef = workspaceRef.collection("meetings");
  const membersRef = workspaceRef.collection("members");

  const [decisionSnapshots, actionSnapshots, meetingSnapshots, memberSnapshots] = await Promise.all([
    decisionsRef
      .orderBy("updatedAt", "desc")
      .limit(SEARCH_FETCH_LIMIT_PER_KIND)
      .get()
      .catch(() => decisionsRef.limit(SEARCH_FETCH_LIMIT_PER_KIND).get()),
    actionsRef
      .orderBy("updatedAt", "desc")
      .limit(SEARCH_FETCH_LIMIT_PER_KIND)
      .get()
      .catch(() => actionsRef.limit(SEARCH_FETCH_LIMIT_PER_KIND).get()),
    meetingsRef
      .orderBy("updatedAt", "desc")
      .limit(SEARCH_FETCH_LIMIT_PER_KIND)
      .get()
      .catch(() => meetingsRef.limit(SEARCH_FETCH_LIMIT_PER_KIND).get()),
    membersRef
      .limit(300)
      .get()
      .catch(() => membersRef.get()),
  ]);

  const memberSearchOptions = memberSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      const status = normalizeText(data.status).toLowerCase();
      if (status === "removed") return null;

      const uid = normalizeText(data.uid) || snapshot.id;
      const displayName = normalizeText(data.displayName);
      const email = normalizeText(data.email);

      if (!uid || (!displayName && !email)) return null;

      const mentionToken = toMentionToken(displayName, email, uid);

      return {
        uid,
        displayName,
        email,
        mentionToken,
        searchText: buildUserSearchText([uid, displayName, email, mentionToken]),
      } satisfies MemberSearchOption;
    })
    .filter(isPresent)
    .sort((a, b) => {
      const left = normalizeText(a.displayName || a.email || a.uid).toLowerCase();
      const right = normalizeText(b.displayName || b.email || b.uid).toLowerCase();
      return left.localeCompare(right);
    });

  const memberByUid = new Map(memberSearchOptions.map((member) => [member.uid, member]));

  const decisionResults = decisionSnapshots.docs
    .map((snapshot) => {
      const data = snapshot.data() as Record<string, unknown>;
      if (data.archived === true) return null;

      const title = normalizeText(data.title) || `Decision ${snapshot.id}`;
      const statement = normalizeText(data.statement);
      const rationale = normalizeText(data.rationale);
      const owner = normalizeText(data.owner) || normalizeText(data.ownerUid) || "Unassigned";
      const ownerUid = normalizeText(data.ownerUid);
      const mentionUids = parseStringArray(data.mentionUids);
      const ownerMember = ownerUid ? memberByUid.get(ownerUid) : undefined;
      const mentionMembers = mentionUids.map((uid) => memberByUid.get(uid));
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
        userSearchText: buildUserSearchText([
          owner,
          ownerUid,
          ownerMember?.displayName,
          ownerMember?.email,
          ownerMember?.mentionToken,
          mentionUids.join(" "),
          mentionMembers.map((member) => member?.displayName).join(" "),
          mentionMembers.map((member) => member?.email).join(" "),
          mentionMembers.map((member) => member?.mentionToken).join(" "),
        ]),
      } satisfies SearchResult;
    })
    .filter(isPresent);

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
      const ownerUid = normalizeText(data.ownerUid);
      const mentionUids = parseStringArray(data.mentionUids);
      const ownerMember = ownerUid ? memberByUid.get(ownerUid) : undefined;
      const mentionMembers = mentionUids.map((uid) => memberByUid.get(uid));
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
        userSearchText: buildUserSearchText([
          owner,
          ownerUid,
          ownerMember?.displayName,
          ownerMember?.email,
          ownerMember?.mentionToken,
          mentionUids.join(" "),
          mentionMembers.map((member) => member?.displayName).join(" "),
          mentionMembers.map((member) => member?.email).join(" "),
          mentionMembers.map((member) => member?.mentionToken).join(" "),
        ]),
      } satisfies SearchResult;
    })
    .filter(isPresent);

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
      const ownerUid = normalizeText(data.ownerUid) || normalizeText(data.createdBy);
      const ownerMember = ownerUid ? memberByUid.get(ownerUid) : undefined;
      const attendeePeople = parseAttendeePeople(data.attendees);
      const attendees = attendeePeople.names;
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
        userSearchText: buildUserSearchText([
          owner,
          ownerUid,
          ownerMember?.displayName,
          ownerMember?.email,
          ownerMember?.mentionToken,
          attendeePeople.names.join(" "),
          attendeePeople.emails.join(" "),
          attendeePeople.uids.join(" "),
        ]),
      } satisfies SearchResult;
    })
    .filter(isPresent);

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
    if (textTokens.length > 0 && !includesAllTokens(result.searchText, textTokens)) {
      return false;
    }
    if (mentionTokens.length > 0 && !includesAllTokens(result.userSearchText, mentionTokens)) {
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

  const sortedResults = kindFilteredResults
    .map((result) => ({
      result,
      score: computeSearchScore(result, textTokens),
    }))
    .sort((a, b) => {
      if (sortMode === "relevance" && textTokens.length > 0 && b.score !== a.score) {
        return b.score - a.score;
      }
      return (
        b.result.updatedAtEpoch - a.result.updatedAtEpoch ||
        a.result.id.localeCompare(b.result.id)
      );
    })
    .map((entry) => entry.result);
  const totalMatches = sortedResults.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / SEARCH_RESULTS_PER_PAGE));
  const currentPage = totalMatches === 0 ? 1 : Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * SEARCH_RESULTS_PER_PAGE;
  const pageEnd = pageStart + SEARCH_RESULTS_PER_PAGE;
  const visibleResults = sortedResults.slice(pageStart, pageEnd);
  const showingStart = totalMatches === 0 ? 0 : pageStart + 1;
  const showingEnd = totalMatches === 0 ? 0 : pageStart + visibleResults.length;

  const hasFilters =
    query !== "" ||
    scope !== "all" ||
    updated !== "all" ||
    (query !== "" && sortMode !== "relevance");

  const hasQuery = query !== "";
  const hasMentionQuery = mentionTokens.length > 0;
  const mentionTokenSet = new Set(mentionTokens);
  const seenMentionTokens = new Set<string>();
  const visibleMemberMentionOptions = memberSearchOptions.filter((member) => {
    if (seenMentionTokens.has(member.mentionToken)) return false;
    seenMentionTokens.add(member.mentionToken);
    return seenMentionTokens.size <= SEARCH_MEMBER_CHIP_LIMIT;
  });
  const mentionAutocompleteOptions = memberSearchOptions.map((member) => ({
    uid: member.uid,
    mentionToken: member.mentionToken,
    displayName: member.displayName,
    email: member.email,
  }));
  const isRelevanceActive = hasQuery && sortMode === "relevance";
  const isRecentActive = !hasQuery || sortMode === "recent";
  const previousPageHref =
    currentPage > 1
      ? searchHref({
          workspaceSlug: workspaceSlugForNav,
          query,
          kind: scope,
          updated,
          sort: sortMode,
          page: currentPage - 1,
        })
      : null;
  const nextPageHref =
    currentPage < totalPages
      ? searchHref({
          workspaceSlug: workspaceSlugForNav,
          query,
          kind: scope,
          updated,
          sort: sortMode,
          page: currentPage + 1,
        })
      : null;

  return (
    <main className="space-y-6">
      <WorkspacePanel className="border-slate-300 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Search</h1>
            <p className="mt-2 text-sm text-slate-700">
              Search decisions, actions, and meeting records across this workspace.
            </p>
          </div>
          <span className="rounded-md border border-cyan-500 bg-cyan-100 px-3 py-1 text-xs font-semibold tracking-[0.08em] text-cyan-950">
            {totalMatches} matches
          </span>
        </div>

        <WorkspaceSearchBox
          key={`search-box:${query}:${scope}:${updated}:${sortMode}`}
          workspaceSlug={workspaceSlugForNav}
          initialQuery={query}
          kind={scope}
          updated={updated}
          sort={sortMode}
          mentionOptions={mentionAutocompleteOptions}
        />

        <p className="mt-2 text-xs text-slate-800">
          Tip: press <kbd className="rounded border border-slate-400 bg-white px-1 text-slate-800">/</kbd> to jump to search. Use <span className="font-semibold text-slate-900">@name</span> to filter by people.
        </p>

        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-800">Type</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: "all",
              updated,
              sort: sortMode,
            })}
            className={queryChipClass(scope === "all")}
          >
            All Results {matchedByQueryAndWindow.length}
          </Link>
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: "decision",
              updated,
              sort: sortMode,
            })}
            className={queryChipClass(scope === "decision")}
          >
            Decisions {decisionCount}
          </Link>
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: "action",
              updated,
              sort: sortMode,
            })}
            className={queryChipClass(scope === "action")}
          >
            Actions {actionCount}
          </Link>
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: "meeting",
              updated,
              sort: sortMode,
            })}
            className={queryChipClass(scope === "meeting")}
          >
            Meetings {meetingCount}
          </Link>
        </div>

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-800">Updated</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: scope,
              updated: "all",
              sort: sortMode,
            })}
            className={queryChipClass(updated === "all")}
          >
            Any Time
          </Link>
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: scope,
              updated: "7d",
              sort: sortMode,
            })}
            className={queryChipClass(updated === "7d")}
          >
            Last 7 Days
          </Link>
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: scope,
              updated: "30d",
              sort: sortMode,
            })}
            className={queryChipClass(updated === "30d")}
          >
            Last 30 Days
          </Link>
        </div>

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-800">Sort</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {hasQuery ? (
            <Link
              href={searchHref({
                workspaceSlug: workspaceSlugForNav,
                query,
                kind: scope,
                updated,
                sort: "relevance",
              })}
              className={queryChipClass(isRelevanceActive)}
            >
              Most Relevant
            </Link>
          ) : (
            <span className="rounded-md border border-slate-400 bg-slate-100 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-600">
              Most Relevant (enter query)
            </span>
          )}
          <Link
            href={searchHref({
              workspaceSlug: workspaceSlugForNav,
              query,
              kind: scope,
              updated,
              sort: "recent",
            })}
            className={queryChipClass(isRecentActive)}
          >
            Most Recent
          </Link>
        </div>

        {visibleMemberMentionOptions.length > 0 ? (
          <>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-800">
              People
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {visibleMemberMentionOptions.map((member) => (
                <Link
                  key={`mention-${member.uid}`}
                  href={searchHref({
                    workspaceSlug: workspaceSlugForNav,
                    query: appendMentionToQuery(query, member.mentionToken),
                    kind: scope,
                    updated,
                    sort: sortMode,
                  })}
                  className={queryChipClass(mentionTokenSet.has(member.mentionToken))}
                  title={
                    member.email
                      ? `${member.displayName || member.email} (${member.email})`
                      : member.displayName || member.uid
                  }
                >
                  @{member.mentionToken}
                </Link>
              ))}
            </div>
            {hasMentionQuery ? (
              <p className="mt-2 text-xs text-slate-700">
                Mention filters active:{" "}
                <span className="font-semibold text-slate-900">
                  {mentionTokens.map((token) => `@${token}`).join(", ")}
                </span>
              </p>
            ) : null}
          </>
        ) : null}
      </WorkspacePanel>

      <WorkspacePanel className="border-slate-300 bg-white">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Results</h2>
          <span className="text-sm text-slate-800">
            {totalMatches === 0
              ? query
                ? `No matches for "${query}"`
                : "No recent items"
              : query
                ? `Showing ${showingStart}-${showingEnd} of ${totalMatches} matches for "${query}"`
                : `Showing ${showingStart}-${showingEnd} of ${totalMatches} recent items`}
          </span>
        </div>

        <div className="space-y-3">
          {visibleResults.map((result) => (
            <article
              key={`${result.kind}-${result.id}`}
              className={resultCardClass(result.kind)}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-900">
                    {highlightMatches(result.title, textTokens)}
                  </p>
                  <p className="mt-1 break-words text-sm text-slate-700">
                    {highlightMatches(result.snippet, textTokens)}
                  </p>
                </div>
                <span
                  className={`rounded-sm border px-2 py-1 text-[11px] font-semibold tracking-[0.08em] ${kindStyle(result.kind)}`}
                >
                  {kindLabel(result.kind)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-[0.08em]">
                <span className={`rounded-sm border px-2 py-1 ${resultMetaClass("id")}`}>
                  {result.id}
                </span>
                <span className={`rounded-sm border px-2 py-1 ${resultMetaClass("owner")}`}>
                  {result.ownerLabel}
                </span>
                <span className={`rounded-sm border px-2 py-1 ${resultMetaClass("updated")}`}>
                  {result.updatedLabel}
                </span>
                <span className={`rounded-sm border px-2 py-1 ${resultMetaClass("status")}`}>
                  {result.statusLabel}
                </span>
              </div>

              {result.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {result.tags.map((tag) => (
                    <span
                      key={`${result.kind}-${result.id}-${tag}`}
                      className="rounded-md border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex items-center justify-end">
                <Link
                  href={result.href}
                  className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:border-slate-600 hover:bg-slate-100"
                >
                  Open result
                </Link>
              </div>
            </article>
          ))}

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-3 py-2">
              <p className="text-xs font-semibold tracking-[0.08em] text-slate-700">
                Page {currentPage} of {totalPages}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {previousPageHref ? (
                  <Link
                    href={previousPageHref}
                    className="rounded-sm border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-slate-600 hover:text-slate-950"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">
                    Previous
                  </span>
                )}
                {nextPageHref ? (
                  <Link
                    href={nextPageHref}
                    className="rounded-sm border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-slate-600 hover:text-slate-950"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="rounded-sm border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-400">
                    Next
                  </span>
                )}
              </div>
            </div>
          ) : null}

          {visibleResults.length === 0 ? (
            <div className="space-y-3">
              <p className="rounded-sm border border-dashed border-slate-400 bg-white px-3 py-2 text-sm text-slate-800">
                {query
                  ? `No results for "${query}". Try fewer keywords or broaden filters.`
                  : "No searchable workspace records yet. Create meetings, decisions, or actions first."}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {hasFilters ? (
                  <Link
                    href={searchHref({
                      workspaceSlug: workspaceSlugForNav,
                      query: "",
                      kind: "all",
                      updated: "all",
                      sort: "relevance",
                    })}
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
