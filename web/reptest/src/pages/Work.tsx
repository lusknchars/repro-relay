import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, ChevronRight, ExternalLink, FileText, GitBranch, History, Paperclip, RefreshCw, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, EmptyState, Input, Kbd, Segmented, Separator, Tabs } from "@/components/ui";
import { CapTag, LastConfirmed, SourceBadge, StateBadge } from "@/components/work-bits";
import { activity, capabilityTag, changedFiles, contextUsed, conversation, evidence, patchLines, tests, workItems, type WorkItem } from "@/lib/data";

type Filter = "all" | "decision" | "working" | "blocked" | "finished";
type Pane = "findings" | "changes" | "tests" | "activity" | "context";

const filterOf = (f: Filter) => (w: WorkItem) => f === "all" ? true : f === "finished" ? w.state === "finished" || w.state === "history" : w.state === f;

/* ---------------- list ---------------- */
function WorkRow({ item, selected, onSelect }: { item: WorkItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "row-pad t-control grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-l-2 px-3 text-left hover:bg-surface-2",
        selected ? "border-l-accent bg-accent-soft/60" : "border-l-transparent"
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="mono whitespace-nowrap text-[11px] text-faint">{item.id}</span>
          <span className="truncate text-sm font-medium">{item.title}</span>
        </div>
        <div className="truncate text-xs text-muted">{item.impact}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StateBadge state={item.state} live={item.live} />
        <span className="tnum text-[11px] text-faint">{item.lastChangeAt.split(", ")[1] ?? item.lastChangeAt}</span>
      </div>
      <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted">
        <span className="truncate">{item.lastChange}</span>
        <span className="text-faint">·</span>
        <span className="flex-none">{item.actor}</span>
        <span className="ml-auto flex-none text-foreground">{item.nextAction}</span>
        <ChevronRight className="h-3 w-3 flex-none text-faint" />
      </div>
    </button>
  );
}

/* ---------------- workspace panes ---------------- */
function Findings({ evidenceChanged }: { evidenceChanged: boolean }) {
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Finding</h3>
        <p className="max-w-prose text-sm leading-6">
          The CSV export never finishes for accounts that have archived projects. The worker builds the statement schema from active projects only, then joins line items that still reference archived project IDs. The join returns null and the serializer waits forever.
        </p>
        <p className="max-w-prose text-sm text-muted">Impact: 12 owners cannot download monthly statements. Started with the archive feature on 11 Sep.</p>
        <div className="flex items-center gap-2"><SourceBadge source="Agent proposal" /><span className="text-xs text-muted">Accepted by Luskzz · 13 Sep, 18:10</span></div>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Evidence</h3>
          <span className="text-xs text-muted">Every claim links to an artifact</span>
        </div>
        <ul className="divide-y divide-border rounded-md border border-border">
          {evidence.map((e) => (
            <li key={e.id} className="cell-pad grid grid-cols-[1fr_auto] items-center gap-2 px-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{e.label}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <SourceBadge source={e.source} />
                  <span className="mono">{e.build}</span>
                  <span className="tnum">{e.time}</span>
                </div>
              </div>
              <a href="#" onClick={(ev) => ev.preventDefault()} className="t-control mono inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-accent-text hover:bg-accent-soft">
                <Paperclip className="h-3 w-3" /> {e.artifact.split("/").pop()}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Still uncertain</h3>
        <ul className="grid gap-1.5 text-sm">
          <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-warn" /> Mobile Safari download is only covered by a Chromium 390px viewport simulation, not a physical iPhone test.</li>
          <li className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-warn" /> PDF rounding check is blocked on staging-eu; unrelated to this change but shares the fixture.</li>
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Suggested next action</h3>
        <div className={cn("grid gap-1 rounded-md border p-3 text-sm", evidenceChanged ? "border-warn bg-warn-soft/40" : "border-border")}>
          <div className="font-medium">Approve isolated fix in worktree wt-142-a</div>
          <div className="text-xs text-muted">Scope: 3 files in services/export · runs <span className="mono">pnpm test:ci</span> only · no merge, no messages, no memory publish.</div>
          {evidenceChanged && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-warn"><RefreshCw className="h-3 w-3" /> Evidence changed since this proposal was written. Review the current version before deciding.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function Changes() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><GitBranch className="h-3.5 w-3.5" /> Main checkout</div>
          <div className="mono text-muted">~/code/acme-billing · main@8f21c0e</div>
          <div className="mt-1 text-muted">Untouched. Opening the repository does not change this case's target.</div>
        </div>
        <div className="rounded-md border border-accent bg-accent-soft/40 p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><GitBranch className="h-3.5 w-3.5" /> Isolated worktree</div>
          <div className="mono text-muted">.relay/worktrees/wt-142-a · wt-142-a@e0a5b3f</div>
          <div className="mt-1 text-muted">Base main@8f21c0e · allowed: <span className="mono">pnpm test:ci</span> · validation env staging-eu</div>
        </div>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {changedFiles.map((f) => (
          <li key={f.path} className="cell-pad flex items-center gap-3 px-3 text-sm">
            <FileText className="h-3.5 w-3.5 flex-none text-muted" />
            <span className="mono truncate">{f.path}</span>
            <span className="tnum ml-auto text-xs text-ok">+{f.add}</span>
            <span className="tnum text-xs text-danger">−{f.del}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
          <span className="mono">services/export/worker.ts</span>
          <span className="text-muted">Patch · scrolls inside this region</span>
        </div>
        <div className="mono overflow-x-auto py-1" role="region" aria-label="Patch for services/export/worker.ts" tabIndex={0}>
          {patchLines.map((l, i) => (
            <div key={i} className={cn("grid grid-cols-[3rem_1rem_1fr] px-3 leading-6", l.t === "add" && "diff-add", l.t === "del" && "diff-del")}>
              <span className="tnum text-faint select-none">{l.n}</span>
              <span className={cn("select-none", l.t === "add" ? "text-ok" : l.t === "del" ? "text-danger" : "text-faint")}>{l.t === "add" ? "+" : l.t === "del" ? "−" : " "}</span>
              <span className="whitespace-pre">{l.s}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">Shown because a real patch exists in the worktree. A proposal without a patch shows a proposed-change summary instead of a diff.</p>
    </div>
  );
}

function TestsPane() {
  const [onlyProblems, setOnlyProblems] = useState(true);
  const rows = tests.filter((t) => !onlyProblems || t.result !== "Passed");
  const tone = (r: string) => (r === "Passed" ? "ok" : r === "Failed" ? "danger" : r === "Running" ? "info" : r === "Blocked" ? "danger" : "warn");
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Segmented size="sm" ariaLabel="Test filter" value={onlyProblems ? "problems" : "all"} onChange={(v) => setOnlyProblems(v === "problems")} options={[{ value: "problems", label: "Failed, blocked, missing" }, { value: "all", label: "All checks" }]} />
        <span className="tnum text-xs text-muted">14 passed on wt-142-a@e0a5b3f · Windows 11 / Edge 130</span>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Check</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 font-medium">Environment</th>
              <th className="px-3 py-2 font-medium">Build</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Artifact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => (
              <tr key={t.name}>
                <td className="cell-pad mono px-3">{t.name}</td>
                <td className="cell-pad px-3"><Badge tone={tone(t.result) as never} dot>{t.result}</Badge></td>
                <td className="cell-pad px-3 text-xs">{t.env}</td>
                <td className="cell-pad mono px-3 text-xs">{t.build}</td>
                <td className="cell-pad px-3"><SourceBadge source={t.source} /></td>
                <td className="cell-pad tnum px-3 text-xs text-muted">{t.time}</td>
                <td className="cell-pad px-3">{t.artifact ? <a href="#" onClick={(e) => e.preventDefault()} className="mono text-[11px] text-accent-text hover:underline">{t.artifact.split("/").pop()}</a> : <span className="text-xs text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityPane() {
  return (
    <ol className="grid gap-0">
      {activity.map((a, i) => (
        <li key={i} className="grid grid-cols-[6.5rem_1rem_1fr] gap-x-2 text-sm">
          <span className="tnum pt-1.5 text-xs text-muted">{a.at}</span>
          <span className="relative flex justify-center">
            <span className="absolute top-0 bottom-0 w-px bg-border" aria-hidden />
            <span className={cn("relative mt-2.5 h-2 w-2 rounded-full border-2 border-surface", a.kind === "decision" ? "bg-accent" : a.kind === "conclusion" ? "bg-ok" : a.kind === "system" ? "bg-faint" : "bg-border-strong")} />
          </span>
          <div className="pb-4 pt-1">
            <div>{a.text}</div>
            <div className="text-xs text-muted">{a.actor} · {a.kind}</div>
          </div>
        </li>
      ))}
      <li className="grid grid-cols-[6.5rem_1rem_1fr] gap-x-2 text-xs text-muted">
        <span />
        <span />
        <span>Observable actions and concise conclusions only. Private model reasoning is not shown as an execution trace.</span>
      </li>
    </ol>
  );
}

function ContextPane() {
  const included = contextUsed.filter((c) => c.included);
  const total = included.reduce((s, c) => s + (c.tokens ?? 0), 0);
  const tone = (l: string) => (l === "Source evidence" ? "neutral" : l === "Reviewed knowledge" ? "ok" : "warn");
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">Context used by run-77 <span className="text-muted">(frozen packet, 14 Sep 13:31)</span></div>
        <div className="flex items-center gap-2"><span className="tnum text-xs text-muted">{total.toLocaleString()} tokens measured</span><CapTag tag={capabilityTag.contextUsed} /></div>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {contextUsed.map((c, i) => (
          <li key={i} className={cn("cell-pad grid grid-cols-[1fr_auto] items-center gap-2 px-3 text-sm", !c.included && "opacity-60")}>
            <div className="min-w-0">
              <div className="truncate">{c.label}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge tone={tone(c.layer) as never}>{c.layer}</Badge>
                {c.reason ? <span>Included: {c.reason}</span> : <span>Excluded</span>}
                <span>· {c.freshness}</span>
              </div>
            </div>
            <span className="tnum text-xs text-muted">{c.tokens ? c.tokens.toLocaleString() : "—"}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">A later run can receive updated context. This packet does not change while run-77 is in flight. Saving a note never marks it as consumed by an agent.</p>
    </div>
  );
}

/* ---------------- decision bar ---------------- */
type Submit = "idle" | "checking" | "started" | "unknown" | "stopping";

function DecisionBar({ evidenceChanged, onRefresh }: { evidenceChanged: boolean; onRefresh: () => void }) {
  const [submit, setSubmit] = useState<Submit>("idle");

  const approve = () => {
    setSubmit("checking");
    // Prototype only: real implementation reads a server receipt. No random-success demo behavior.
    window.setTimeout(() => setSubmit("started"), 1400);
  };

  if (evidenceChanged) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-warn bg-warn-soft/50 px-4 py-2.5 text-sm">
        <RefreshCw className="h-4 w-4 text-warn" />
        <span className="font-medium">Evidence changed since this approval</span>
        <span className="text-muted">Worker file moved to wt-142-a@f11c9d2. The previous review is outdated.</span>
        <Button variant="default" size="sm" className="ml-auto" onClick={onRefresh}>Review current version</Button>
      </div>
    );
  }

  if (submit === "started") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2.5 text-sm">
        <Badge tone="ok" dot>Running</Badge>
        <span>Isolated fix executing in wt-142-a</span>
        <LastConfirmed text="server accepted request rq-9a12" at="just now" />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSubmit("stopping")}><Square className="h-3 w-3" /> Request stop</Button>
        </div>
      </div>
    );
  }
  if (submit === "stopping") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2.5 text-sm">
        <Badge tone="warn" dot>Stopping</Badge>
        <span>Confirmation pending — the runtime has not yet acknowledged the stop.</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSubmit("idle")}>Inspect status</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2.5">
      <div className="mr-auto grid text-xs text-muted">
        <span>Approving runs <span className="mono">pnpm test:ci</span> in <span className="mono">wt-142-a@e0a5b3f</span>. Nothing is merged, published or sent.</span>
        <span>Accepting the finding earlier did not authorize this edit.</span>
      </div>
      <Button size="sm" variant="ghost">Request another check</Button>
      <Button size="sm" variant="outline">Accept finding</Button>
      <Button size="sm" variant="default" pending={submit === "checking"} onClick={approve} disabled={submit === "checking"}>
        {submit === "checking" ? "Checking whether the action started" : "Approve isolated fix"}
      </Button>
    </div>
  );
}

/* ---------------- page ---------------- */
export function WorkPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("REL-142");
  const [pane, setPane] = useState<Pane>("findings");
  const [evidenceChanged, setEvidenceChanged] = useState(false);
  const [reply, setReply] = useState("");
  const [listOpen, setListOpen] = useState(true);

  const list = useMemo(() => workItems.filter(filterOf(filter)).filter((w) => (query ? (w.title + w.impact + w.id).toLowerCase().includes(query.toLowerCase()) : true)), [filter, query]);
  const selected = workItems.find((w) => w.id === selectedId) ?? workItems[0];
  const isHistorical = selected.state === "history" || selected.state === "finished";

  const counts = {
    decision: workItems.filter(filterOf("decision")).length,
    working: workItems.filter(filterOf("working")).length,
    blocked: workItems.filter(filterOf("blocked")).length,
    finished: workItems.filter(filterOf("finished")).length,
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Work list (stable) */}
      <section className={cn("flex min-h-0 w-full flex-none flex-col border-r border-border bg-surface md:w-[360px] lg:w-[400px]", !listOpen && "hidden md:flex")} aria-label="Work history">
        <div className="grid gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold">Work</h1>
            <CapTag tag={capabilityTag.workList} />
          </div>
          <Input placeholder="Search work…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search work" />
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter work">
            {([
              ["all", "All", workItems.length],
              ["decision", "Needs your decision", counts.decision],
              ["working", "Working", counts.working],
              ["blocked", "Blocked", counts.blocked],
              ["finished", "Finished", counts.finished],
            ] as [Filter, string, number][]).map(([v, l, n]) => (
              <button
                key={v}
                role="radio"
                aria-checked={filter === v}
                onClick={() => setFilter(v)}
                className={cn("t-control flex h-6 items-center gap-1 rounded-sm border px-1.5 text-xs", filter === v ? "border-accent bg-accent-soft text-accent-text" : "border-border text-muted hover:text-foreground")}
              >
                {l} <span className="tnum">{n}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Today: one evidence-linked recommendation from actual records */}
        <div className="border-b border-border px-3 py-2.5">
          <div className="text-[11px] font-medium text-faint">Today</div>
          <button onClick={() => { setSelectedId("REL-142"); setPane("findings"); }} className="t-control mt-1 grid w-full gap-0.5 rounded-md border border-border p-2.5 text-left hover:border-border-strong">
            <div className="text-sm font-medium">Approve the export fix before Northwind's month-end run</div>
            <div className="text-xs text-muted">Unblocks 12 owners · matches project goal "statements never silently fail" · smallest step: review the 3-file patch.</div>
            <div className="mt-1 flex items-center gap-1 text-xs text-accent-text">From REL-142 evidence <ArrowUpRight className="h-3 w-3" /></div>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <div className="p-3">
              <EmptyState title="No work matches" description="Clear the search or change the filter. Monitoring is still running." action={<Button size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button>} />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {list.map((w) => (
                <WorkRow key={w.id} item={w} selected={w.id === selected.id} onSelect={() => { setSelectedId(w.id); setListOpen(false); }} />
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted">Selection and filters survive refresh · <Kbd>J</Kbd> <Kbd>K</Kbd> to move</div>
      </section>

      {/* Selected work */}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", listOpen && "hidden md:flex")} aria-label="Selected work">
        <div className="border-b border-border bg-surface px-4 py-3">
          <button className="mb-1 text-xs text-accent-text md:hidden" onClick={() => setListOpen(true)}>← Work list</button>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="mono whitespace-nowrap text-xs text-faint">{selected.id}</span>
                <h2 className="truncate text-base font-semibold">{selected.title}</h2>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>Impact: <span className="text-foreground">{selected.impact}</span></span>
                <span>Owner: {selected.owner}</span>
                <span className="mono">{selected.build}</span>
                <span>{selected.env}</span>
                <span>{selected.runtime} · {selected.model}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StateBadge state={selected.state} live={selected.live} />
                {isHistorical ? (
                  <Badge tone="outline"><History className="h-3 w-3" /> Opened from history · {selected.lastChangeAt}</Badge>
                ) : null}
                <LastConfirmed text={selected.lastChange} at={selected.lastChangeAt} />
              </div>
            </div>
            <div className="flex flex-none items-center gap-2">
              {isHistorical ? (
                <Button size="sm" variant="secondary" onClick={() => setSelectedId("REL-142")}>View active work</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEvidenceChanged((v) => !v)} title="Prototype control: simulate a source change after approval">
                  {evidenceChanged ? "Undo evidence change" : "Simulate evidence change"}
                </Button>
              )}
              <Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /> Share link</Button>
            </div>
          </div>
        </div>

        {selected.state === "blocked" ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-danger/40 bg-danger-soft/40 px-4 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-danger" />
            <span className="font-medium">Model request blocked: provider credit balance</span>
            <span className="text-muted">Moonshot rejected the request. Mem0 and Hermes are not the cause; your work is preserved.</span>
            <Button size="sm" variant="default" className="ml-auto">Open Moonshot billing</Button>
            <Button size="sm" variant="outline">Change provider</Button>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(280px,5fr)_minmax(0,7fr)]">
          {/* Conversation and decisions */}
          <div className="flex min-h-0 flex-col border-b border-border max-md:max-h-[42vh] md:border-b-0 md:border-r">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <h3 className="text-sm font-semibold">Conversation and decisions</h3>
              <CapTag tag={capabilityTag.conversation} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
              <ol className="grid gap-3 pb-3">
                {conversation.map((t) => (
                  <li key={t.id} className={cn("grid gap-1", t.who === "system" && "text-xs text-muted")}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={cn("font-medium", t.who === "agent" ? "text-accent-text" : t.who === "system" ? "text-muted" : "text-foreground")}>{t.name}</span>
                      <span className="tnum text-faint">{t.at}</span>
                      {t.decision ? <Badge tone="accent">{t.decision}</Badge> : null}
                    </div>
                    <p className={cn("max-w-prose text-sm leading-6", t.who === "system" && "text-xs leading-5")}>{t.text}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="border-t border-border p-3">
              <div className="flex gap-2">
                <Input placeholder="Reply or direct the work (optional)" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply" />
                <Button size="md" variant="default" disabled={!reply.trim()} aria-label="Send reply"><Send className="h-3.5 w-3.5" /></Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">No diagnosis form. The record already holds the issue, evidence and revision.</p>
            </div>
          </div>

          {/* Agent work */}
          <div className="flex min-h-0 flex-col">
            <div className="px-4 pt-3">
              <Tabs
                value={pane}
                onChange={setPane}
                tabs={[
                  { value: "findings", label: "Findings" },
                  { value: "changes", label: "Changes", count: changedFiles.length },
                  { value: "tests", label: "Tests", count: tests.filter((t) => t.result !== "Passed").length },
                  { value: "activity", label: "Activity" },
                  { value: "context", label: "Context used" },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {pane === "findings" && <Findings evidenceChanged={evidenceChanged} />}
              {pane === "changes" && <Changes />}
              {pane === "tests" && <TestsPane />}
              {pane === "activity" && <ActivityPane />}
              {pane === "context" && <ContextPane />}
            </div>
          </div>
        </div>

        {selected.state === "decision" ? <DecisionBar evidenceChanged={evidenceChanged} onRefresh={() => setEvidenceChanged(false)} /> : null}
        {selected.state === "working" ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-2.5 text-sm">
            <Badge tone="ok" dot>Investigating</Badge>
            <LastConfirmed text="compared idempotency keys on 3 retries" at="14 Sep, 13:55" />
            <span className="text-xs text-muted">A spinner means pending, not a percentage.</span>
            <Button size="sm" variant="outline" className="ml-auto"><Square className="h-3 w-3" /> Request stop</Button>
          </div>
        ) : null}
        <Separator className="hidden" />
      </section>
    </div>
  );
}
