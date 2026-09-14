import { useRef, useState } from "react";
import { ChevronRight, RefreshCw, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { api, useLoad } from "@/lib/live";
type Commit = {
  sha: string;
  author: string;
  subject: string;
  committed_at: string;
};
type History = {
  snapshot: { repository: string; revision: string; commits: Commit[] } | null;
  current: boolean;
  checked_at?: string;
};
function relative(value: string) {
  const minutes = Math.floor((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 0) return "Future Git timestamp";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}
export function Contributions() {
  const feed = useLoad(() => api<History>("/contributions"), [], 15000);
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const commits = feed.data?.snapshot?.commits || [];
  function row(c: Commit) {
    return (
      <li key={c.sha} className="flex items-start gap-3 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-accent-soft text-xs font-semibold text-accent-text"
        >
          {c.author
            .split(/\s+/)
            .slice(0, 2)
            .map((n) => n[0])
            .join("")
            .toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{c.author}</p>
          <p className="mt-0.5 break-words text-sm text-muted">{c.subject}</p>
          <code className="text-[10px] text-muted" title={c.sha}>
            {c.sha.slice(0, 8)}
          </code>
        </div>
        <time
          className="shrink-0 pt-1 text-xs text-muted"
          dateTime={c.committed_at}
          title={new Date(c.committed_at).toLocaleString()}
        >
          {relative(c.committed_at)}
        </time>
      </li>
    );
  }
  return (
    <section
      aria-label="Recent code contributions"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header className="flex items-center justify-between border-b border-border bg-surface-2/40 px-4 py-3">
        <h2 className="text-sm font-semibold">Recent contributions</h2>
        <Button
          size="sm"
          aria-label="Refresh contributions"
          onClick={feed.refresh}
        >
          <RefreshCw size={13} />
        </Button>
      </header>
      <div className="px-4 pb-4">
        {feed.error && (
          <p role="alert" className="py-3 text-sm text-danger">
            {feed.error}
          </p>
        )}
        {feed.loading && !feed.data && (
          <p role="status" className="py-3 text-sm text-muted">
            Reading repository activity…
          </p>
        )}
        {feed.data && !commits.length && (
          <p className="py-4 text-sm text-muted">
            No commit activity captured yet. The local repository harness
            publishes recent commits here when connected.
          </p>
        )}
        <ul>{commits.slice(0, 4).map(row)}</ul>
        {!!commits.length && (
          <>
            <p className="mb-3 text-xs text-muted">
              Git authors ·{" "}
              {feed.data?.current
                ? "Current repository snapshot"
                : "Snapshot may be stale"}
              . Commit history does not prove review, deployment or account
              ownership.
            </p>
            <Button
              className="w-full"
              onClick={() => {
                setSearch("");
                dialog.current?.showModal();
              }}
            >
              View all contributions <ChevronRight size={14} />
            </Button>
          </>
        )}
      </div>
      <dialog
        ref={dialog}
        aria-label="Contribution history"
        className="w-[min(760px,calc(100vw-24px))] max-h-[85vh] rounded-lg border border-border bg-surface p-4 text-foreground shadow-xl backdrop:bg-black/40"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Contribution history</h2>
            <p className="break-all text-xs text-muted">
              {feed.data?.snapshot?.repository} · latest {commits.length}{" "}
              commits on captured HEAD
            </p>
          </div>
          <button
            type="button"
            aria-label="Close contribution history"
            className="t-control rounded p-2"
            onClick={() => dialog.current?.close()}
          >
            <X size={16} />
          </button>
        </header>
        <Input
          aria-label="Search contributions"
          placeholder="Search author, change or commit…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="divide-y divide-border">
          {commits
            .filter((c) =>
              (c.author + c.subject + c.sha)
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map(row)}
        </ul>
        {!commits.some((c) =>
          (c.author + c.subject + c.sha)
            .toLowerCase()
            .includes(search.toLowerCase()),
        ) && (
          <p className="p-4 text-sm text-muted">No matching contributions.</p>
        )}
      </dialog>
    </section>
  );
}
