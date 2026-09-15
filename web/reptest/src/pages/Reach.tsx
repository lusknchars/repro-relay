import { DiscordDiscussion } from "@/components/discord";
import { ReachMeetings } from "@/components/meetings";
import { Reach } from "@/components/reach";

export function ReachPage() {
  return (
    <div className="grid gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reach</h1>
          <p className="mt-1 text-sm text-muted">
            Meeting actions, daily todos and follow-ups in one place.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <a
            className="t-control rounded-md border border-border bg-surface px-3 py-2 hover:bg-surface-2"
            href="/?view=calendar"
          >
            Calendar
          </a>
          <a
            className="t-control rounded-md border border-border bg-surface px-3 py-2 hover:bg-surface-2"
            href="/?view=team"
          >
            Team & call setup
          </a>
        </div>
      </header>
      <DiscordDiscussion />
      <ReachMeetings />
      <Reach />
    </div>
  );
}
