import Link from "next/link";
import { NewMeetingForm } from "@/components/workspace/new-meeting-form";
import { SummaryTile, WorkspacePanel } from "@/components/workspace/primitives";

type NewMeetingPageProps = Readonly<{
  params: Promise<{ workspaceSlug: string }>;
}>;

function formatWorkspaceName(workspaceSlug: string) {
  return workspaceSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function NewMeetingPage({ params }: NewMeetingPageProps) {
  const { workspaceSlug } = await params;
  const workspaceName = formatWorkspaceName(workspaceSlug) || "Workspace";
  const initialDateISO = new Date().toISOString().slice(0, 10);

  return (
    <main className="space-y-6">
      <WorkspacePanel>
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">{workspaceName}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">New Meeting</h1>
        <p className="mt-2 text-sm text-slate-600">
          Define your meeting structure first, then jump directly into a seeded meeting record.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/${workspaceSlug}/meetings`}
            className="rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:text-slate-900"
          >
            Back to meetings
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryTile label="Step 1" value="Configure" detail="Title, objective, schedule" />
          <SummaryTile label="Step 2" value="Seed" detail="Attendees and agenda" />
          <SummaryTile label="Step 3" value="Capture" detail="Decisions and actions in record" />
        </div>
      </WorkspacePanel>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <WorkspacePanel>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Meeting Setup</h2>
          <p className="mt-1 text-sm text-slate-600">
            This form creates a persisted meeting record and routes you into the full capture flow.
          </p>

          <div className="mt-4">
            <NewMeetingForm
              workspaceSlug={workspaceSlug}
              initialDateISO={initialDateISO}
            />
          </div>
        </WorkspacePanel>

        <WorkspacePanel>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">What Happens Next</h2>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <p className="rounded-sm border border-slate-200 bg-white px-3 py-2.5">
              1. A new meeting ID is generated and opened immediately.
            </p>
            <p className="rounded-sm border border-slate-200 bg-white px-3 py-2.5">
              2. Your title, objective, attendees, and agenda prefill the meeting record.
            </p>
            <p className="rounded-sm border border-slate-200 bg-white px-3 py-2.5">
              3. You can immediately capture decisions, actions, open questions, and digest output.
            </p>
          </div>

          <p className="mt-4 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The new record is saved immediately so decisions and actions can sync live.
          </p>
        </WorkspacePanel>
      </section>
    </main>
  );
}
