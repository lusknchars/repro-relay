import { useEffect, useRef, useState } from "react";
import { RefreshCw, ArrowLeft, Play, Square, Search } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui";
import { IntegrationLogo } from "@/components/integration-logo";
import {
  api,
  useLoad,
  useWorkspace,
  when,
  errorText,
  type Case,
  type InvestigationRun,
} from "@/lib/live";
import { cn } from "@/lib/utils";

type Evidence = {
  id: string;
  statement?: string;
  event_type?: string;
  summary?: string;
  producer?: string;
  producer_sequence?: number;
  data?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  received_at: string;
  latest_review?: { decision: string };
  sources_available?: boolean;
};
type EvidencePage = { items: Evidence[]; next_cursor?: number | null };
const active = (r: InvestigationRun) =>
  !["completed", "failed", "cancelled"].includes(r.status);
function Records({ value }: { value: unknown }) {
  return (
    <pre className="mono overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
function Detail({ item, onBack }: { item: Case; onBack: () => void }) {
  const workspace = useWorkspace();
  const runs = useLoad(
    () => api<InvestigationRun[]>(`/cases/${item.id}/runs`),
    [item.id],
    5000,
  );
  const [chosen, setChosen] = useState("");
  const run = runs.data?.find((r) => r.id === chosen) ?? runs.data?.[0];
  const [pane, setPane] = useState("findings");
  const [after, setAfter] = useState(0);
  useEffect(() => setAfter(0), [pane, run?.id]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [reviewer, setReviewer] = useState(
    workspace.data?.account.profile?.name || "",
  );
  const keys = useRef(new Map<string, string>());
  const details = useLoad(
    async () => {
      if (pane === "context")
        return run
          ? Promise.resolve({
              snapshot: "Context supplied to this attempt",
              case_revision: run.case_revision,
              context_stale: run.context_stale,
              context: run.context,
            })
          : api(`/cases/${item.id}/context`);
      if (pane === "changes") return api(`/cases/${item.id}/repairs`);
      if (!run) return { items: [] };
      return api<EvidencePage>(
        `/runs/${run.id}/${pane === "findings" ? "findings" : pane === "activity" ? "activity" : "journal"}?after=${after}`,
      );
    },
    [item.id, item.revision, run?.id, run?.version, pane, after],
    10000,
  );
  async function action(label: string, path: string, body?: unknown) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    const identity = path + JSON.stringify(body);
    const key = keys.current.get(identity) || crypto.randomUUID();
    keys.current.set(identity, key);
    try {
      await api(path, "POST", body, key);
      setNotice(`${label} recorded.`);
      runs.refresh();
      details.refresh();
      workspace.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const canWrite =
    workspace.data?.account.enabled &&
    workspace.data?.account.role !== "viewer";
  const page = details.data as EvidencePage | undefined;
  const events = page?.items || [];
  return (
    <section
      className="flex min-w-0 flex-1 flex-col overflow-auto"
      aria-label="Selected work"
    >
      <header className="grid gap-2 border-b border-border bg-surface p-4">
        <Button className="justify-self-start md:hidden" onClick={onBack}>
          <ArrowLeft size={14} />
          Work history
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="mono text-xs text-muted">
            {item.id} · revision {item.revision}
          </span>
          <Badge>{item.status.replace(/_/g, " ")}</Badge>
        </div>
        <h2 className="text-lg font-semibold">{item.title}</h2>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span>{item.project}</span>
          <span className="mono break-all">
            {item.build || "Build not recorded"}
          </span>
          <span>Updated {when(item.updated_at)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <IntegrationLogo provider="hermes" size={20} />
          <span className="text-sm">
            {run
              ? `${run.execution_kind === "local_validation" ? "Local validation" : "Hermes"} · ${run.status}`
              : runs.loading
                ? "Loading attempts…"
                : "No investigation started"}
          </span>
          <Button
            size="sm"
            pending={busy === "Start investigation"}
            disabled={
              !canWrite ||
              !!busy ||
              !workspace.data?.runner.available ||
              !!runs.error ||
              !runs.data ||
              runs.data.some(active)
            }
            onClick={() =>
              void action("Start investigation", `/cases/${item.id}/runs`, {
                revision: item.revision,
                max_seconds: 120,
              })
            }
          >
            <Play size={13} />
            Investigate · 2 min limit
          </Button>
          {run && active(run) && (
            <Button
              size="sm"
              disabled={!canWrite || !!busy}
              onClick={() =>
                void action("Stop requested", `/runs/${run.id}/stop`)
              }
            >
              <Square size={13} />
              Request stop
            </Button>
          )}
          {run?.status === "attention" && (
            <Button
              disabled={!canWrite || !!busy}
              onClick={() =>
                void action("Reconcile", `/runs/${run.id}/reconcile`)
              }
            >
              Reconcile
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              runs.refresh();
              details.refresh();
              workspace.refresh();
            }}
          >
            <RefreshCw size={13} />
            Refresh
          </Button>
        </div>
        {!workspace.data?.runner.available && (
          <p className="text-xs text-muted">
            {workspace.data?.runner.reason || "Runtime connection unavailable."}{" "}
            Open Settings for connection steps.
          </p>
        )}
        <p role="status" className="text-xs text-ok">
          {notice}
        </p>
        {(error || runs.error) && (
          <p role="alert" className="text-sm text-danger">
            {error || runs.error}
          </p>
        )}
      </header>
      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.1fr)]">
        <section className="grid min-w-0 grid-cols-1 content-start gap-4 [overflow-wrap:anywhere] border-b border-border p-4 xl:border-r xl:border-b-0">
          <h3 className="text-sm font-semibold">Conversation and decisions</h3>
          <article className="rounded-md border border-border p-3">
            <Badge tone="outline">Reported behavior</Badge>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {item.description}
            </p>
            <p className="mt-2 text-xs text-muted">Expected: {item.expected}</p>
            <p className="mt-2 break-all text-xs text-muted">
              Target: {item.url}
            </p>
          </article>
          {item.observations.map((o) => (
            <article key={o.id} className="rounded-md border border-border p-3">
              <div className="text-xs text-muted">
                {o.author} · Human observation · {when(o.at)}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{o.observed}</p>
              <Badge tone="outline">{o.result.replace(/_/g, " ")}</Badge>
            </article>
          ))}
          {runs.data?.length ? (
            <label className="grid gap-1 text-xs text-muted">
              Investigation attempt
              <select
                className="min-w-0 w-full rounded-md border border-border bg-surface p-2 text-foreground"
                value={run?.id || ""}
                onChange={(e) => setChosen(e.target.value)}
              >
                {runs.data.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.execution_kind === "local_validation"
                      ? "Local validation"
                      : "Hermes"}{" "}
                    · {r.status} · {when(r.created_at)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-muted">
              Your existing report supplies the investigation context. No new
              prompt is required.
            </p>
          )}
          {run && (
            <article className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <IntegrationLogo provider="hermes" size={20} />
                {run.execution_kind === "local_validation"
                  ? "Imported local validation"
                  : "Hermes result"}
                <Badge>{run.status}</Badge>
              </div>
              <p className="text-xs text-muted">{run.detail}</p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {run.output || "No output recorded yet."}
              </p>
              <p className="text-xs text-muted">
                Last checked {when(run.checked_at)} · Build{" "}
                {run.build || "unknown"}
              </p>
            </article>
          )}
          {run?.status === "completed" &&
            run.execution_kind !== "local_validation" && (
              <section className="grid gap-2 rounded-md border border-border p-3">
                <h3 className="text-sm font-semibold">
                  Review this investigation
                </h3>
                <p className="text-xs text-muted">
                  Records your assessment of this run. A review does not merge
                  code or send a message.
                </p>
                <Input
                  aria-label="Reviewer"
                  placeholder="Your name"
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                />
                <textarea
                  aria-label="Review feedback"
                  placeholder="Review feedback"
                  className="min-h-20 rounded-md border border-border bg-surface p-2 text-sm"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  {[
                    ["accepted", "Accept result"],
                    ["needs_changes", "Request changes"],
                    ["dismissed", "Dismiss"],
                  ].map(([decision, label]) => (
                    <Button
                      key={decision}
                      size="sm"
                      disabled={
                        !canWrite ||
                        !!busy ||
                        run.context_stale ||
                        reviewer.trim().length < 2 ||
                        !feedback.trim()
                      }
                      pending={busy === label}
                      onClick={() =>
                        void action(label, `/runs/${run.id}/reviews`, {
                          case_revision: item.revision,
                          run_version: run.version,
                          reviewer,
                          decision,
                          feedback,
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {run.context_stale && (
                  <p className="text-xs text-warn">
                    Source context changed. Investigate the current revision
                    before reviewing.
                  </p>
                )}
              </section>
            )}
        </section>
        <section className="min-w-0 p-4">
          <div
            className="mb-4 flex flex-wrap gap-1"
            role="tablist"
            aria-label="Investigation evidence"
          >
            {[
              "findings",
              "changes",
              "tests",
              "activity",
              "tools",
              "context",
            ].map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={p === pane}
                onClick={() => setPane(p)}
                className={cn(
                  "t-control rounded-md px-3 py-2 text-xs capitalize",
                  p === pane
                    ? "bg-accent-soft text-accent-text"
                    : "text-muted hover:bg-surface-2",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          {details.loading && <p role="status">Loading recorded evidence…</p>}
          {details.error && (
            <p role="alert" className="text-danger">
              {details.error}
            </p>
          )}
          {details.data !== undefined && (
            <div role="tabpanel" className="grid gap-3">
              {pane === "context" || pane === "changes" ? (
                <Records value={details.data} />
              ) : (
                <>
                  {events
                    .filter(
                      (e) => pane !== "tests" || e.event_type === "test_result",
                    )
                    .map((e) => (
                      <article
                        key={e.id}
                        className="grid gap-2 rounded-md border border-border p-3"
                      >
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="outline">
                            {e.event_type || "Agent finding"}
                          </Badge>
                          <span className="text-xs text-muted">
                            {when(e.received_at)}
                          </span>
                        </div>
                        {(e.statement || e.summary) && (
                          <p className="text-sm">{e.statement || e.summary}</p>
                        )}
                        {e.data && (
                          <div className="text-sm">
                            {typeof e.data.name === "string" && (
                              <p>{e.data.name}</p>
                            )}
                            {typeof e.data.status === "string" && (
                              <Badge tone="outline">
                                {pane === "activity" ? "State: " : "Reported: "}
                                {e.data.status}
                              </Badge>
                            )}
                            {typeof e.data.detail === "string" && (
                              <p className="mt-2 text-muted">{e.data.detail}</p>
                            )}
                          </div>
                        )}
                        {e.environment && (
                          <p className="text-xs text-muted">
                            Environment:{" "}
                            {String(e.environment.name || "Not reported")} ·{" "}
                            {String(
                              e.environment.capture_mode ||
                                "Unknown capture mode",
                            )}
                          </p>
                        )}
                        <details className="text-xs text-muted">
                          <summary className="cursor-pointer">
                            {pane === "activity"
                              ? "Inspect activity record"
                              : "Inspect source receipt"}
                          </summary>
                          <Records value={e} />
                        </details>
                        {e.latest_review && (
                          <Badge>{e.latest_review.decision}</Badge>
                        )}
                      </article>
                    ))}
                  {!events.filter(
                    (e) => pane !== "tests" || e.event_type === "test_result",
                  ).length && (
                    <p className="rounded-md border border-border p-4 text-sm text-muted">
                      No {pane} recorded for this attempt.
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    {pane === "activity"
                      ? `Activity after record ${after}, up to 100 entries. Lifecycle and reported usage are saved together. Earlier runs begin with a migration snapshot.`
                      : `Evidence after record ${after}, up to 50 entries. Test receipts retain their reported environment; model output alone is not a passing test.`}
                  </p>
                  <div className="flex gap-2">
                    {after > 0 && (
                      <Button size="sm" onClick={() => setAfter(0)}>
                        First page
                      </Button>
                    )}
                    {page?.next_cursor != null && (
                      <Button
                        size="sm"
                        onClick={() => setAfter(page.next_cursor!)}
                      >
                        Next page
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
export function WorkPage() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("case") || "",
  );
  const [listOpen, setListOpen] = useState(!selected);
  useEffect(() => {
    const openSearch = () => {
      setListOpen(true);
      window.setTimeout(
        () =>
          document
            .querySelector<HTMLInputElement>('[aria-label="Search work"]')
            ?.focus(),
        0,
      );
    };
    window.addEventListener("relay:search-work", openSearch);
    return () => window.removeEventListener("relay:search-work", openSearch);
  }, []);
  const cases = workspace.data?.cases || [];
  const linked = useLoad(
    () =>
      selected
        ? api<Case>(`/cases/${encodeURIComponent(selected)}`)
        : Promise.resolve(null),
    [selected],
    15000,
  );
  const item = selected
    ? cases.find((c) => c.id === selected) ||
      (linked.data?.id === selected ? linked.data : undefined)
    : cases[0];
  const list = cases.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      (c.id + " " + c.title + " " + c.project)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Work history"
        className={cn(
          "flex min-h-0 w-full flex-none flex-col border-r border-border bg-surface md:w-[360px] lg:w-[400px]",
          !listOpen && "hidden md:flex",
        )}
      >
        <div className="grid gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold">Work</h1>
            <Badge tone="outline">Recorded work</Badge>
          </div>
          <Input
            aria-label="Search work"
            placeholder="Search work…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {["all", "new", "blocked", "reproduced", "needs_context"].map(
              (f) => (
                <button
                  key={f}
                  aria-pressed={filter === f}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    filter === f
                      ? "bg-accent-soft text-accent-text"
                      : "text-muted",
                  )}
                  onClick={() => setFilter(f)}
                >
                  {f.replace(/_/g, " ")}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {workspace.loading && (
            <p className="p-4 text-sm" role="status">
              Connecting to your workspace…
            </p>
          )}
          {workspace.error && (
            <div className="p-4">
              <p role="alert" className="text-sm text-danger">
                {workspace.error}
              </p>
              <Button onClick={workspace.refresh}>Retry connection</Button>
            </div>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              className={cn(
                "t-control grid w-full gap-2 border-b border-l-2 border-border p-4 text-left hover:bg-surface-2",
                c.id === item?.id
                  ? "border-l-accent bg-accent-soft/40"
                  : "border-l-transparent",
              )}
              onClick={() => {
                setSelected(c.id);
                setListOpen(false);
                history.replaceState(
                  null,
                  "",
                  `/?case=${encodeURIComponent(c.id)}`,
                );
              }}
            >
              <span className="text-xs text-muted">
                {c.id} · {c.project}
              </span>
              <span className="text-sm font-medium">{c.title}</span>
              <span className="text-xs text-muted">
                {c.status.replace(/_/g, " ")} · {when(c.updated_at)}
              </span>
            </button>
          ))}
          {workspace.data && !list.length && (
            <p className="p-4 text-sm text-muted">
              No matching reports. Reports received through your configured
              intake appear here.
            </p>
          )}
        </div>
        <div className="border-t border-border p-3 text-xs text-muted">
          {cases.length} records
          {workspace.data?.moreCases ? " · Latest 100 shown" : ""} · Refreshes
          every 15 seconds
        </div>
      </section>
      <div
        className={cn("min-w-0 flex-1", listOpen ? "hidden md:flex" : "flex")}
      >
        {item ? (
          <Detail key={item.id} item={item} onBack={() => setListOpen(true)} />
        ) : (
          <section className="p-6 text-sm text-muted">
            {linked.error ||
              (linked.loading && selected
                ? "Loading the linked report…"
                : "Select a report to inspect its evidence. Configure Hermes and Plow in Settings.")}
          </section>
        )}
      </div>
    </div>
  );
}
