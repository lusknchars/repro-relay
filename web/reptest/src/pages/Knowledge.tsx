import { useState } from "react";
import { BookOpen, FileText, ArrowUpRight } from "lucide-react";
import { PageSidebar } from "@/components/shell/PageSidebar";
import { Button, Badge, Input } from "@/components/ui";
import {
  api,
  useLoad,
  useWorkspace,
  when,
  errorText,
  type Memory,
} from "@/lib/live";
export function KnowledgePage() {
  const { data: workspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const [source, setSource] = useState(
    () => new URLSearchParams(location.search).get("knowledge-source") || "",
  );
  const memories = useLoad(() => api<Memory[]>("/memories"), [], 15000);
  const sources = new Map<
    string,
    { id: string; title: string; project: string; count: number }
  >();
  for (const memory of memories.data || []) {
    const existing = sources.get(memory.case_id);
    if (existing) existing.count += 1;
    else
      sources.set(memory.case_id, {
        id: memory.case_id,
        title:
          workspace?.cases.find((item) => item.id === memory.case_id)?.title ||
          memory.title,
        project: memory.project,
        count: 1,
      });
  }
  const sourceItems = [...sources.values()]
    .sort((a, b) => a.title.localeCompare(b.title))
    .filter((item) =>
      `${item.title} ${item.project}`
        .toLowerCase()
        .includes(sourceQuery.toLowerCase()),
    );
  const shown =
    memories.data?.filter(
      (memory) =>
        (!source || memory.case_id === source) &&
        `${memory.title} ${memory.observation.observed} ${memory.project}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  function selectSource(id: string) {
    setSource(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set("knowledge-source", id);
    else url.searchParams.delete("knowledge-source");
    history.replaceState(null, "", url);
  }
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <PageSidebar>
        <nav className="page-sidebar-nav" aria-label="Knowledge collections">
          <button
            className="page-sidebar-link"
            aria-label="All observations"
            aria-current={!source ? "page" : undefined}
            onClick={() => selectSource("")}
          >
            <BookOpen size={16} />
            All observations
            {memories.data && (
              <span className="page-sidebar-count" aria-hidden="true">
                {memories.data.length}
              </span>
            )}
          </button>
        </nav>
        <section
          className="page-sidebar-group"
          aria-label="Knowledge source reports"
        >
          <h3 className="page-sidebar-label">Source reports</h3>
          <input
            className="page-sidebar-search"
            aria-label="Find source reports"
            placeholder="Find a report or project…"
            value={sourceQuery}
            onChange={(event) => setSourceQuery(event.target.value)}
          />
          {sourceItems.map((item) => (
            <button
              key={item.id}
              className="page-sidebar-link"
              aria-label={`Filter by ${item.title}`}
              aria-current={source === item.id ? "page" : undefined}
              onClick={() => selectSource(item.id)}
              title={item.title}
            >
              <FileText size={15} />
              <span className="min-w-0">
                <span className="line-clamp-2 break-words">{item.title}</span>
                <span className="block text-[11px] text-muted">
                  {item.project}
                </span>
              </span>
              <span className="page-sidebar-count" aria-hidden="true">
                {item.count}
              </span>
            </button>
          ))}
          {!sourceItems.length && (
            <p className="page-sidebar-note">
              {memories.error
                ? "Sources unavailable. Refresh knowledge to retry."
                : !memories.data
                  ? "Loading source reports…"
                  : sourceQuery
                    ? "No source reports match."
                    : "Publish reviewed evidence from Work to start your library."}
            </p>
          )}
        </section>
        <section className="page-sidebar-group page-sidebar-divider">
          <h3 className="page-sidebar-label">About this library</h3>
          <p className="page-sidebar-note">
            Shared observations keep their source and reviewer. Private agent
            notes stay separate.
          </p>
          <a className="page-sidebar-link" href="/?view=work">
            <FileText size={15} />
            Open investigations
            <ArrowUpRight size={13} />
          </a>
          <a
            className="page-sidebar-link"
            href="/?view=settings&connection=mem0"
          >
            <BookOpen size={15} />
            Memory connection
            <ArrowUpRight size={13} />
          </a>
        </section>
      </PageSidebar>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Knowledge</h1>
          <p className="text-sm text-muted">
            Current reviewed observations, linked to their source revision.
          </p>
        </div>
        <Button onClick={memories.refresh}>Refresh</Button>
      </header>
      <Input
        aria-label="Search knowledge"
        placeholder="Search reviewed observations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {source && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>Source: {sources.get(source)?.title || "Selected report"}</span>
          <Button size="sm" onClick={() => selectSource("")}>
            Show all observations
          </Button>
        </div>
      )}
      {(error || memories.error) && (
        <p role="alert" className="text-danger">
          {error || memories.error}
        </p>
      )}
      {memories.loading && <p role="status">Loading knowledge…</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {shown.map((m) => (
          <li key={m.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="text-sm font-medium">{m.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {m.observation.observed}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                <Badge tone="ok">Reviewed observation</Badge>
                <span>
                  {m.case_id} · revision {m.revision}
                </span>
                <span>Reviewer: {m.reviewer}</span>
                <span>{when(m.created_at)}</span>
                <a
                  className="text-accent-text hover:underline"
                  href={`/?case=${encodeURIComponent(m.case_id)}`}
                >
                  Open source report
                </a>
              </div>
            </div>
            <Button
              size="sm"
              disabled={
                !!busy ||
                !workspace?.account.enabled ||
                workspace.account.role === "viewer"
              }
              pending={busy === m.id}
              onClick={async () => {
                setBusy(m.id);
                setError("");
                try {
                  await api(`/memories/${m.id}`, "DELETE");
                  memories.refresh();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy("");
                }
              }}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
      {memories.data &&
        !shown.length &&
        !memories.loading &&
        !memories.error && (
          <p className="text-sm text-muted">
            {query || source
              ? "No reviewed observations match these filters."
              : "No current reviewed observations. Publish reviewed evidence from a case before reusing it."}
          </p>
        )}
      <p className="text-xs text-muted">
        Stale and revoked records are excluded by the backend. Private Mem0
        working notes are separate and are not automatically promoted to shared
        knowledge.
      </p>
    </div>
  );
}
