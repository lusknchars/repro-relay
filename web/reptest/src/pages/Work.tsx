import "./Work.css";
import { CaseEnvironment } from "@/components/case-environment";
import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  ArrowLeft,
  Play,
  Square,
  TriangleAlert,
  Link2,
  ChevronRight,
} from "lucide-react";
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
type RunReview = {
  id: string;
  run_id: string;
  reviewer: string;
  decision: string;
  feedback: string;
  created_at: string;
};
type Repair = {
  id: string;
  status: string;
  input: { base_commit: string; allowed_paths: string[]; environment: string };
  approved_by: string | null;
};
function remembered(key: string, fallback: string) {
  try {
    return sessionStorage.getItem(`relay.work.${key}`) || fallback;
  } catch {
    return fallback;
  }
}
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
  const reviews = useLoad(
    () => api<RunReview[]>(`/cases/${item.id}/run-reviews`),
    [item.id],
    10000,
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
      reviews.refresh();
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
  const needsAttention = run && ["failed", "attention"].includes(run.status);
  const runReviews =
    reviews.data?.filter((review) => review.run_id === run?.id) || [];
  const warning = run?.context_stale
    ? {
        title: "Evidence changed since this attempt",
        detail:
          "The report or its context has changed. Investigate the current revision before reviewing this result.",
      }
    : needsAttention
      ? {
          title: "Investigation needs attention",
          detail: run.detail || "Inspect the recorded attempt before retrying.",
        }
      : workspace.data &&
          !workspace.data.runner.available &&
          !(run && active(run))
        ? {
            title: "Hermes runtime unavailable",
            detail:
              workspace.data.runner.reason ||
              "Connect the investigation runtime in Settings to start work. Saved evidence remains available.",
          }
        : null;
  return (
    <section
      className="work-detail flex min-w-0 flex-1 flex-col"
      aria-label="Selected work"
    >
      <header className="work-heading grid gap-2 border-b border-border bg-surface px-4 py-3">
        <Button className="justify-self-start md:hidden" onClick={onBack}>
          <ArrowLeft size={14} /> Work history
        </Button>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
            <span title={item.id} className="mono max-w-28 shrink-0 truncate text-xs text-muted">{item.id}</span>
            <h2 className="min-w-0 break-words text-base font-semibold">
              {item.title}
            </h2>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              const url = new URL(location.href);
              url.search = new URLSearchParams({ case: item.id }).toString();
              try {
                await navigator.clipboard.writeText(url.href);
                setNotice(
                  "Work link copied. Teammates need access to this workspace.",
                );
              } catch {
                setNotice(`Work link: ${url.href}`);
              }
            }}
          >
            <Link2 size={13} /> Share link
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <span>{item.project}</span>
          <span>Revision {item.revision}</span>
          <span className="mono break-all">
            {item.build || "Build not recorded"}
          </span>
          <span>Report: {item.status.replace(/_/g, " ")}</span>
          <span>Last confirmed {when(run?.checked_at || item.updated_at)}</span>
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
        <p role="status" className="text-xs text-ok">
          {notice}
        </p>
        {(error || runs.error) && (
          <p role="alert" className="text-sm text-danger">
            {error || runs.error}
          </p>
        )}
      </header>
      {warning && (
        <div
          role="status"
          aria-label="Investigation warning"
          className={cn(
            "work-warning flex flex-wrap items-start gap-2 border-b px-4 py-3 text-sm",
            needsAttention
              ? "border-danger/20 bg-danger/5 text-danger"
              : "border-warn/20 bg-warn/5",
          )}
        >
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <strong className="font-medium">{warning.title}</strong>
            <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
              {warning.detail}
            </p>
          </div>
          <a
            href="/?view=settings"
            className="shrink-0 border border-border bg-surface px-2 py-1 text-xs text-foreground hover:border-border-strong"
          >
            Open connections
          </a>
        </div>
      )}
      <div className="work-panes grid min-h-0 flex-1">
        <section
          aria-label="Work conversation"
          className="work-conversation flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere] border-b border-border p-4"
        >
          <h3 className="text-sm font-semibold">Conversation and decisions</h3>
          <article className="work-message">
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
            <article key={o.id} className="work-message">
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
            <article className="work-message grid gap-2">
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
          {reviews.error && (
            <p className="text-xs text-danger" role="alert">
              Review history: {reviews.error}
            </p>
          )}
          {runReviews.map((review) => (
            <article key={review.id} className="work-message">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <strong>{review.reviewer}</strong>
                <time>{when(review.created_at)}</time>
                <Badge tone="outline">
                  {review.decision.replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {review.feedback}
              </p>
            </article>
          ))}
          <CaseEnvironment key={item.id} item={item} canWrite={!!canWrite} />
          {run?.status === "completed" &&
            run.execution_kind !== "local_validation" && (
              <section className="work-review mt-auto grid gap-2 border-t border-border pt-4">
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
        <section
          aria-label="Evidence inspector"
          className="work-inspector min-w-0 p-4"
        >
          <div
            className="work-tabs mb-4 flex flex-wrap gap-4 border-b border-border"
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
                id={`work-tab-${p}`}
                aria-controls="work-evidence-panel"
                tabIndex={p === pane ? 0 : -1}
                aria-selected={p === pane}
                onKeyDown={(event) => {
                  const tabs = [
                    "findings",
                    "changes",
                    "tests",
                    "activity",
                    "tools",
                    "context",
                  ];
                  let next = tabs.indexOf(p);
                  if (event.key === "ArrowRight")
                    next = (next + 1) % tabs.length;
                  else if (event.key === "ArrowLeft")
                    next = (next + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  setPane(tabs[next]);
                  document.getElementById(`work-tab-${tabs[next]}`)?.focus();
                }}
                onClick={() => setPane(p)}
                className={cn(
                  "t-control border-b-2 px-0 py-2 text-xs capitalize",
                  p === pane
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {p === "context" ? "Context used" : p}
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
            <div
              role="tabpanel"
              id="work-evidence-panel"
              aria-labelledby={`work-tab-${pane}`}
              className="grid gap-3"
            >
              {pane === "context" ? (
                <>
                  <h3 className="text-sm font-semibold">Context used</h3>
                  <p className="text-xs text-muted">
                    {run
                      ? "Frozen context supplied to the selected attempt."
                      : "Current report context. No attempt has started."}
                  </p>
                  <Records value={details.data} />
                </>
              ) : pane === "changes" ? (
                <>
                  <h3 className="text-sm font-semibold">Isolated changes</h3>
                  {Array.isArray(details.data) &&
                    (details.data as Repair[]).map((plan) => (
                      <article
                        key={plan.id}
                        className="border border-border p-3 text-sm"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <strong>{plan.id}</strong>
                          <Badge tone="outline">
                            {plan.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          Base {plan.input.base_commit} ·{" "}
                          {plan.input.environment}
                        </p>
                        <ul className="my-2 space-y-1 font-mono text-xs">
                          {plan.input.allowed_paths.map((path) => (
                            <li key={path}>{path}</li>
                          ))}
                        </ul>
                        <p className="text-xs text-muted">
                          {plan.approved_by
                            ? `Approval recorded by ${plan.approved_by}`
                            : "No approval recorded"}
                        </p>
                        <details className="mt-3 text-xs">
                          <summary className="cursor-pointer">
                            Inspect repair record
                          </summary>
                          <Records value={plan} />
                        </details>
                      </article>
                    ))}
                  {Array.isArray(details.data) && !details.data.length && (
                    <p className="text-sm text-muted">
                      No repair plan recorded for this report.
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    A recorded plan is not proof of execution or a verified fix.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">
                      {pane === "findings"
                        ? "Findings and evidence"
                        : pane === "tests"
                          ? "Test receipts"
                          : pane === "activity"
                            ? "Recorded activity"
                            : "Tool records"}
                    </h3>
                    <span className="text-[11px] text-muted">
                      Selected attempt
                    </span>
                  </div>
                  {events
                    .filter(
                      (e) => pane !== "tests" || e.event_type === "test_result",
                    )
                    .map((e) => (
                      <article
                        key={e.id}
                        className="work-evidence-row grid gap-2 border border-border p-3"
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
                    <p className="border border-border p-4 text-sm text-muted">
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
  const [query, setQuery] = useState(() => remembered("query", ""));
  const [filter, setFilter] = useState(() => remembered("filter", "all"));
  useEffect(() => {
    try {
      sessionStorage.setItem("relay.work.query", query);
      sessionStorage.setItem("relay.work.filter", filter);
    } catch {
      /* In-memory filtering still works. */
    }
  }, [query, filter]);
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
  const isWorking = (id: string) =>
    workspace.data?.runs.some((run) => run.case_id === id && run.active);
  const isBlocked = (id: string) => {
    const latest = workspace.data?.runs.find((run) => run.case_id === id);
    return latest && ["failed", "attention"].includes(latest.status);
  };
  const matchesFilter = (c: Case, f: string) =>
    f === "all" ||
    (f === "working"
      ? isWorking(c.id)
      : f === "blocked"
        ? c.status === "blocked" || isBlocked(c.id)
        : c.status === f);
  const list = cases.filter(
    (c) =>
      matchesFilter(c, filter) &&
      (c.id + " " + c.title + " " + c.project)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function selectCase(id: string) {
    setSelected(id);
    setListOpen(false);
    history.replaceState(null, "", `/?case=${encodeURIComponent(id)}`);
  }
  return (
    <div
      className="work-desk flex h-full min-h-0"
      onKeyDown={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement ||
          (event.target as HTMLElement).isContentEditable
        )
          return;
        if (event.key !== "j" && event.key !== "k") return;
        const index = list.findIndex((c) => c.id === item?.id);
        const next = list[index + (event.key === "j" ? 1 : -1)];
        if (next) {
          event.preventDefault();
          selectCase(next.id);
        }
      }}
    >
      <section
        aria-label="Work history"
        className={cn(
          "work-history flex min-h-0 w-full flex-none flex-col border-r border-border bg-surface",
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
            {[
              "all",
              "new",
              "working",
              "blocked",
              "reproduced",
              "needs_context",
            ].map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                className={cn(
                  "border border-border px-1.5 py-1 text-[11px] capitalize",
                  filter === f
                    ? "bg-accent-soft text-accent-text"
                    : "text-muted",
                )}
                onClick={() => setFilter(f)}
              >
                {f.replace(/_/g, " ")}{" "}
                <span className="tnum">
                  {cases.filter((c) => matchesFilter(c, f)).length}
                </span>
              </button>
            ))}
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
                "work-history-row t-control grid w-full gap-1.5 border-b border-l-2 border-border px-3 py-3 text-left hover:bg-surface-2",
                c.id === item?.id
                  ? "border-l-accent bg-accent-soft/40"
                  : "border-l-transparent",
              )}
              aria-pressed={c.id === item?.id}
              onClick={() => selectCase(c.id)}
            >
              <span className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">
                  {c.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 border px-1 py-0.5 text-[10px]",
                    isBlocked(c.id) || c.status === "blocked"
                      ? "border-danger/20 bg-danger/5 text-danger"
                      : isWorking(c.id)
                        ? "border-ok/20 bg-ok/5 text-ok"
                        : "border-border text-muted",
                  )}
                >
                  {isBlocked(c.id)
                    ? "Attention"
                    : isWorking(c.id)
                      ? "Working"
                      : c.status.replace(/_/g, " ")}
                </span>
              </span>
              <span className="line-clamp-1 text-xs text-muted">
                {c.description}
              </span>
              <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                <span className="truncate">
                  {c.id} · {when(c.updated_at)}
                </span>
                <ChevronRight size={12} className="shrink-0" />
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
          <p className="mt-1 text-[11px]">
            Filters survive refresh · J / K to move
          </p>
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
