import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveWorkspaceBySlug } from "@/lib/auth/workspace-data";
import { parseMeetingDraftPayload } from "@/lib/workspace/meeting-draft";

type RouteContext = {
  params: Promise<{
    workspaceSlug: string;
  }>;
};

type CreateMeetingBody = {
  draft?: unknown;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatTimeLabel(date: string, time: string) {
  const parsedDate = date ? new Date(`${date}T00:00:00`) : null;
  const dateLabel =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : date || "Date TBD";

  if (!time) return dateLabel;

  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return dateLabel;

  const period = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 === 0 ? 12 : hours % 12;
  const normalizedMinutes = String(minutes).padStart(2, "0");

  return `${dateLabel}, ${normalizedHours}:${normalizedMinutes} ${period}`;
}

function createMeetingId() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 900 + 100);
  return `M-${timestamp}${random}`;
}

async function authenticateSession(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error("UNAUTHORIZED");
  }

  return adminAuth.verifySessionCookie(sessionCookie, true);
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const decodedSession = await authenticateSession(request);
    const uid = decodedSession.uid;
    const { workspaceSlug } = await context.params;
    const workspace = await resolveWorkspaceBySlug(workspaceSlug);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    const workspaceRef = adminDb.collection("workspaces").doc(workspace.workspaceId);
    const memberSnapshot = await workspaceRef.collection("members").doc(uid).get();
    if (!memberSnapshot.exists) {
      return NextResponse.json({ error: "Access denied." }, { status: 403 });
    }

    const body = (await request.json()) as CreateMeetingBody;
    const draft = parseMeetingDraftPayload(body.draft);

    if (!draft) {
      return NextResponse.json({ error: "Valid meeting draft payload is required." }, { status: 400 });
    }

    const attendees =
      draft.attendees.length > 0
        ? draft.attendees.map((name, index) => ({
            id: `u-${index + 1}`,
            name,
            role: index === 0 ? "Facilitator" : "Participant",
            required: true,
            present: true,
          }))
        : [{ id: "u-1", name: "You", role: "Facilitator", required: true, present: true }];

    const agenda =
      draft.agenda.length > 0
        ? draft.agenda.map((title, index) => ({
            id: `ag-${index + 1}`,
            title,
            state: index === 0 ? "inProgress" : "queued",
          }))
        : [{ id: "ag-1", title: "Set context and goals", state: "inProgress" }];

    const userSnapshot = await adminDb.collection("users").doc(uid).get();
    const actorName =
      normalizeText(decodedSession.name) ||
      normalizeText(userSnapshot.get("displayName")) ||
      attendees[0]?.name ||
      "Workspace User";

    const now = Timestamp.now();
    let meetingRef = workspaceRef.collection("meetings").doc(createMeetingId());
    let attempts = 0;
    while (attempts < 4) {
      const existingSnapshot = await meetingRef.get();
      if (!existingSnapshot.exists) break;
      meetingRef = workspaceRef.collection("meetings").doc(createMeetingId());
      attempts += 1;
    }
    if ((await meetingRef.get()).exists) {
      meetingRef = workspaceRef.collection("meetings").doc();
    }

    const meetingPayload = {
      title: draft.title || "New Meeting",
      team: workspace.workspaceName || "Workspace",
      owner: actorName,
      timeLabel: formatTimeLabel(draft.date, draft.time),
      duration: "45 min",
      location: draft.location || "TBD",
      objective:
        draft.objective ||
        "Capture outcomes, decisions, actions, and open questions from this meeting.",
      state: "scheduled",
      digest: "pending",
      locked: false,
      revision: 1,
      lastSentLabel: "Not sent yet",
      attendees,
      agenda,
      notes: [
        {
          id: "n-1",
          heading: "Key Discussion",
          content:
            draft.objective ||
            "Capture key context and tradeoffs discussed in the meeting.",
        },
        {
          id: "n-2",
          heading: "Risks and Constraints",
          content: "Capture blockers, dependencies, and assumptions to revisit.",
        },
        {
          id: "n-3",
          heading: "Follow-up Context",
          content: "Add handoff context for owners and stakeholders not present.",
        },
      ],
      openQuestions: [],
      decisions: [],
      actions: [],
      digestRecipients: attendees.slice(0, 4).map((attendee, index) => ({
        id: `r-${index + 1}`,
        label: attendee.name,
        enabled: index < 2,
      })),
      digestOptions: {
        includeNotes: true,
        includeOpenQuestions: true,
        includeActionOwners: true,
      },
    };

    await meetingRef.set({
      ...meetingPayload,
      createdAt: now,
      createdBy: uid,
      updatedAt: now,
      updatedBy: uid,
    });

    await meetingRef.collection("revisions").add({
      source: "meetingUpdate",
      eventType: "created",
      changedFields: ["initial capture"],
      summary: "Captured initial meeting revision.",
      meetingRevision: 1,
      actorUid: uid,
      actorName,
      capturedAt: now,
      restoredFromRevisionId: "",
      meeting: meetingPayload,
    });

    return NextResponse.json({
      ok: true,
      workspaceSlug: workspace.workspaceSlug,
      meetingId: meetingRef.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create meeting.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
