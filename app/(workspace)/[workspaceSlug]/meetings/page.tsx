import {
  WorkspaceMeetingsView,
  type MeetingSort,
  type MeetingView,
  type WorkspaceMeetingRecord,
} from "@/components/workspace/workspace-meetings-view";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { adminDb } from "@/lib/firebase/admin";

type WorkspaceMeetingsPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    view?: string | string[];
    sort?: string | string[];
  }>;
}>;

type MeetingState = "scheduled" | "inProgress" | "completed";
type DigestState = "sent" | "pending";

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

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

function parseCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function parseMeetingState(value: unknown): MeetingState {
  const state = normalizeText(value);
  if (state === "scheduled" || state === "inProgress" || state === "completed") {
    return state;
  }
  return "scheduled";
}

function parseDigestState(value: unknown): DigestState {
  const state = normalizeText(value);
  if (state === "sent" || state === "pending") {
    return state;
  }
  return "pending";
}

function parseMeetingView(value: string | string[] | undefined): MeetingView {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();

  if (normalized === "mine" || normalized === "my") return "mine";
  if (normalized === "digest-pending" || normalized === "digestpending") {
    return "digestPending";
  }
  if (normalized === "locked") return "locked";
  return "all";
}

function parseMeetingSort(value: string | string[] | undefined): MeetingSort {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = normalizeText(candidate).toLowerCase();
  if (normalized === "title") return "title";
  return "updated";
}

function parseMeetingRecord(
  id: string,
  value: unknown,
  uid: string,
  displayName: string,
  email: string,
): WorkspaceMeetingRecord | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const ownerLabel = normalizeText(data.owner) || "Workspace User";
  const ownerUid = normalizeText(data.ownerUid) || normalizeText(data.createdBy);
  const ownerLabelNormalized = ownerLabel.toLowerCase();
  const updatedAt = parseDate(data.updatedAt) ?? parseDate(data.createdAt);
  const isMine =
    ownerUid === uid ||
    (ownerLabelNormalized !== "" &&
      (ownerLabelNormalized === displayName || ownerLabelNormalized === email));

  return {
    id,
    title: normalizeText(data.title) || `Meeting ${id}`,
    team: normalizeText(data.team) || "Workspace",
    timeLabel: normalizeText(data.timeLabel) || "Date TBD",
    duration: normalizeText(data.duration) || "45 min",
    attendees: parseCount(data.attendees),
    decisions: parseCount(data.decisions),
    actions: parseCount(data.actions),
    openQuestions: parseCount(data.openQuestions),
    state: parseMeetingState(data.state),
    digest: parseDigestState(data.digest),
    locked: data.locked === true,
    owner: ownerLabel,
    isMine,
    sortTimestamp: updatedAt?.getTime() ?? 0,
  };
}

export default async function WorkspaceMeetingsPage({
  params,
  searchParams,
}: WorkspaceMeetingsPageProps) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const initialView = parseMeetingView(resolvedSearchParams.view);
  const initialSort = parseMeetingSort(resolvedSearchParams.sort);

  const access = await requireWorkspaceAccess(workspaceSlug);
  const workspaceSlugForNav = access.workspaceSlug;
  const workspaceName = access.workspaceName || formatWorkspaceName(workspaceSlug) || "Workspace";
  const userDisplayName = normalizeText(access.user.displayName).toLowerCase();
  const userEmail = normalizeText(access.user.email).toLowerCase();

  const meetingSnapshots = await adminDb
    .collection("workspaces")
    .doc(access.workspaceId)
    .collection("meetings")
    .orderBy("updatedAt", "desc")
    .limit(120)
    .get();

  const meetings = meetingSnapshots.docs
    .map((snapshot) =>
      parseMeetingRecord(
        snapshot.id,
        snapshot.data(),
        access.uid,
        userDisplayName,
        userEmail,
      ),
    )
    .filter((meeting): meeting is WorkspaceMeetingRecord => meeting !== null);

  return (
    <WorkspaceMeetingsView
      workspaceSlug={workspaceSlugForNav}
      workspaceName={workspaceName}
      meetings={meetings}
      initialView={initialView}
      initialSort={initialSort}
    />
  );
}
