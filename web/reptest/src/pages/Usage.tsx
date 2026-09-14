import { IntegrationLogo } from "@/components/integration-logo";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, ChevronDown, Copy, Download, Gauge, Layers, Sparkles, Target, Terminal, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Segmented } from "@/components/ui";
import { CapTag, StateBadge } from "@/components/work-bits";
import { capabilityTag, usageRuns, workItems, type UsageRun } from "@/lib/data";

const fmtTok = (n: number | null) => (n === null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));
const money = (n: number) => `$${n.toFixed(2)}`;
const tokensOf = (r: UsageRun) => (r.inTok ?? 0) + (r.outTok ?? 0);

/* Segmented progress, from the wallet target cards */
function SegBar({ value, segments = 5, tone = "accent" }: { value: number; segments?: number; tone?: "accent" | "warn" | "danger" }) {
  const filled = Math.min(1, Math.max(0, value)) * segments;
  const color = tone === "accent" ? "var(--accent)" : tone === "warn" ? "var(--warn)" : "var(--danger)";
  return (
    <div className="flex gap-1" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: segments }, (_, i) => {
        const part = Math.min(1, Math.max(0, filled - i));
        return (
          <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-sm bg-neutral-soft">
            <span className="block h-full rounded-sm" style={{ width: `${part * 100}%`, background: color }} />
          </span>
        );
      })}
    </div>
  );
}

function Head({ icon: Icon, title, right }: { icon: typeof Wallet; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-surface text-foreground"><Icon className="h-4 w-4" /></span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {right}
    </div>
  );
}

const PHASE_COLORS: Record<string, string> = {
  Investigation: "var(--accent)",
  Checks: "var(--ok)",
  Proposal: "color-mix(in srgb, var(--accent) 55%, var(--surface))",
  Memory: "var(--warn)",
  Audit: "var(--border-strong)",
};

export function UsagePage() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("week");
  const [work, setWork] = useState("REL-142");

  const runs = usageRuns;
  const covered = runs.filter((r) => r.cost !== null);
  const sum = (rs: UsageRun[]) => rs.reduce((s, r) => s + (r.cost ?? 0), 0);
  const hasUnknown = (rs: UsageRun[]) => rs.some((r) => r.cost === null);
  const byRuntime = (rt: UsageRun["runtime"]) => runs.filter((r) => r.runtime === rt);

  /* per work item */
  const workRuns = runs.filter((r) => r.work === work);
  const workCost = sum(workRuns);
  const workTokens = workRuns.reduce((s, r) => s + tokensOf(r), 0);
  const workVerified = workRuns.filter((r) => r.outcome === "Verified").length;
  const workItem = workItems.find((w) => w.id === work);
  const unmeasured = workRuns.filter((r) => r.inTok === null).length;
  const attempts = useMemo(() => workRuns.filter((r) => r.inTok !== null).slice().sort((a, b) => a.started.localeCompare(b.started)).map((r) => ({ ...r, tokK: Math.round(tokensOf(r) / 1000) })), [workRuns]);
  const maxAttempt = attempts.reduce((m, r) => (r.tokK > m.tokK ? r : m), attempts[0]);

  /* by phase */
  const phases = useMemo(() => {
    const m = new Map<string, number>();
    runs.forEach((r) => m.set(r.phase, (m.get(r.phase) ?? 0) + (r.cost ?? 0)));
    return [...m.entries()].map(([name, value]) => ({ name, value: Number(value.toFixed(2)) })).sort((a, b) => b.value - a.value);
  }, [runs]);
  const phaseTotal = phases.reduce((s, p) => s + p.value, 0);

  /* allocation by work item */
  const allocation = workItems
    .map((w) => {
      const rs = runs.filter((r) => r.work === w.id);
      return { w, cost: sum(rs), tokens: rs.reduce((s, r) => s + tokensOf(r), 0), runs: rs.length, unknown: hasUnknown(rs), verified: rs.filter((r) => r.outcome === "Verified").length };
    })
    .filter((a) => a.runs > 0)
    .sort((a, b) => b.cost - a.cost);
  const allocTotal = allocation.reduce((s, a) => s + a.cost, 0);
  const totalVerified = allocation.reduce((s, a) => s + a.verified, 0);

  const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--foreground)" };

  const caps = [
    { name: "Hermes / Moonshot", sub: "Investigation runtime", icon: Sparkles, rs: byRuntime("Hermes"), cap: 25 },
    { name: "Pi / Kimi", sub: "Terminal review", icon: Terminal, rs: byRuntime("Pi"), cap: 5 },
    { name: "Mem0", sub: "Private notes service", icon: Layers, rs: byRuntime("Mem0"), cap: 2 },
    { name: "Workspace", sub: "All runtimes, this week", icon: Wallet, rs: runs, cap: 60 },
  ];

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Usage</h1>
          <p className="max-w-prose text-sm text-muted">What each agent spent, on which problem, and whether it produced a verified outcome. Unknown is never shown as zero.</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented ariaLabel="Period" value={period} onChange={setPeriod} options={[{ value: "today", label: "Today" }, { value: "week", label: "This week" }, { value: "month", label: "30 days" }]} />
          <Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /> Export</Button>
          <CapTag tag={capabilityTag.usageUnified} />
        </div>
      </div>

      {/* Row 1 — caps per runtime */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {caps.map((c) => {
          const spent = sum(c.rs);
          const pct = spent / c.cap;
          const Icon = c.icon;
          return (
            <div key={c.name} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-2.5">
                {c.name === "Hermes / Moonshot" ? <IntegrationLogo provider="hermes" size={32} /> : <span className="grid h-8 w-8 place-items-center rounded-md border border-border"><Icon className="h-4 w-4" /></span>}
                <div className="min-w-0"><div className="truncate text-sm font-medium">{c.name}</div><div className="truncate text-xs text-muted">{c.sub}</div></div>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="tnum text-2xl font-semibold tracking-tight">{spent === 0 && hasUnknown(c.rs) ? "—" : money(spent)}</span>
                <span className="text-xs text-muted">of {money(c.cap)} cap</span>
                {hasUnknown(c.rs) ? <Badge tone="neutral" className="ml-auto">{spent === 0 ? "not reported" : "+ unreported"}</Badge> : null}
              </div>
              <div className="mt-2.5"><SegBar value={pct} tone={pct > 0.9 ? "danger" : pct > 0.7 ? "warn" : "accent"} /></div>
              <div className="mt-1.5 text-xs text-muted">{spent === 0 && hasUnknown(c.rs) ? "Usage not reported by this service" : <><span className="tnum">{Math.round(pct * 100)}%</span> of cooperative cap · not prepaid credit</>}</div>
            </div>
          );
        })}
      </div>

      {/* Row 2 — one problem / cost per attempt / by phase */}
      <div className="grid gap-3 xl:grid-cols-[minmax(240px,3fr)_minmax(0,5fr)_minmax(0,5fr)]">
        <div className="rounded-lg border border-border bg-surface">
          <Head icon={Target} title="Spend on one problem" />
          <div className="px-4">
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Work item">
              {allocation.map((a) => (
                <button key={a.w.id} role="radio" aria-checked={work === a.w.id} onClick={() => setWork(a.w.id)} className={cn("t-control mono rounded-md border px-2 py-1 text-xs", work === a.w.id ? "border-transparent bg-foreground text-background" : "border-border hover:border-border-strong")}>{a.w.id}</button>
              ))}
            </div>
            <div className="mt-5 grid gap-1">
              <div className="truncate text-xs text-muted">{workItem?.title}</div>
              <div className="flex flex-wrap items-center gap-2">
                {workItem ? <StateBadge state={workItem.state} live={workItem.live} /> : null}
                <Badge tone="neutral"><span className="tnum">{workRuns.length}</span> attempts</Badge>
              </div>
              <div className="tnum mt-2 text-3xl font-semibold tracking-tight">{money(workCost)}</div>
              <div className="text-xs text-muted"><span className="tnum">{fmtTok(workTokens)}</span> tokens · {workVerified} verified outcome{workVerified === 1 ? "" : "s"}{hasUnknown(workRuns) ? " · 1 run cost not reported" : ""}</div>
            </div>
          </div>
          <div className="px-4 pb-4 pt-4 text-xs text-muted">Cost is attributed to the work record the run was started for, not to the agent's total.</div>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <Head icon={Gauge} title="Cost per attempt" right={<div className="text-right text-xs text-muted"><div className="tnum text-foreground">{money(workCost)} total</div><div className="tnum">{fmtTok(workTokens)} tokens</div></div>} />
          <div className="h-56 px-2 pb-3" role="img" aria-label={`Bar chart of tokens per run for ${work}; the most expensive run is highlighted`}>
            <ResponsiveContainer>
              <BarChart data={attempts} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--accent)" strokeWidth="1.2" opacity="0.5" /></pattern>
                </defs>
                <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="id" tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} unit="k" />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v: unknown, _n: unknown, p: { payload?: typeof attempts[number] }) => { const r = p.payload!; return [`${v}k tokens · ${r.cost === null ? "cost not reported" : money(r.cost)} · ${r.phase} → ${r.outcome}`, r.id]; }} />
                <Bar dataKey="tokK" fill="url(#hatch)" stroke="var(--accent)" strokeWidth={1} radius={[3, 3, 0, 0]} label={{ position: "top", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => `${v}k` }}>
                  {attempts.map((r) => <Cell key={r.id} stroke={r.id === maxAttempt?.id ? "var(--danger)" : "var(--accent)"} strokeDasharray={r.id === maxAttempt?.id ? "4 3" : undefined} strokeWidth={r.id === maxAttempt?.id ? 1.5 : 1} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm border border-dashed border-danger align-middle" />Most expensive attempt: <span className="mono text-foreground">{maxAttempt?.id}</span> ({maxAttempt?.phase}, {maxAttempt?.outcome === "None" ? "no outcome yet" : maxAttempt?.outcome.toLowerCase()})</span>
            <span className="ml-auto">Bars scale by measured tokens, not dollars{unmeasured ? ` · ${unmeasured} run without measured tokens omitted` : ""}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <Head icon={Layers} title="Where the money went" right={<button className="t-control flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-surface-2">All work <ChevronDown className="h-3 w-3" /></button>} />
          <div className="grid items-center gap-2 px-4 pb-4 sm:grid-cols-[180px_1fr]">
            <div className="relative mx-auto h-[176px] w-[176px]" role="img" aria-label="Donut chart of spend by phase">
                <PieChart width={176} height={176}>
                  <Pie data={phases.filter((p) => p.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={56} outerRadius={80} paddingAngle={3} cornerRadius={4} stroke="none" isAnimationActive={false}>
                    {phases.map((p) => <Cell key={p.name} fill={PHASE_COLORS[p.name] ?? "var(--border-strong)"} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => money(Number(v))} />
                </PieChart>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="tnum text-lg font-semibold">{money(phaseTotal)}</div><div className="text-[11px] text-muted">covered spend</div></div></div>
            </div>
            <ul className="divide-y divide-border">
              {phases.map((p) => (
                <li key={p.name} className="flex items-center gap-2 py-1.5 text-sm"><span className="h-2.5 w-2.5 rounded-full" style={{ background: PHASE_COLORS[p.name] }} /><span className="flex-1">{p.name}</span>{p.value > 0 ? <><span className="tnum text-xs text-muted">{Math.round((p.value / phaseTotal) * 100)}%</span><span className="tnum w-14 text-right">{money(p.value)}</span></> : <Badge tone="neutral">not reported</Badge>}</li>
              ))}
              <li className="py-1.5 text-xs text-muted">Excludes {runs.length - covered.length} runs with cost not reported</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Row 3 — by problem / agents / efficiency */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,4fr)]">
        <div className="rounded-lg border border-border bg-surface">
          <Head icon={Target} title="Spend by problem" />
          <div className="px-4 pb-2">
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between"><span className="tnum text-2xl font-semibold tracking-tight">{money(allocTotal)}</span><Badge tone="ok"><span className="tnum">{totalVerified}</span> verified outcomes</Badge></div>
              <div className="text-xs text-muted">Covered spend across {allocation.length} work records</div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted"><span>Allocation</span><span>100% of covered</span></div>
            <div className="mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-sm" aria-hidden>
              {allocation.map((a, i) => <span key={a.w.id} style={{ width: `${(a.cost / allocTotal) * 100}%`, background: i === 0 ? "var(--foreground)" : i === 1 ? "var(--accent)" : "color-mix(in srgb, var(--accent) 35%, transparent)" }} />)}
            </div>
            <ul className="divide-y divide-border">
              {allocation.map((a) => (
                <li key={a.w.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5">
                  <span className="mono grid h-9 w-9 place-items-center rounded-md border border-border text-[10px]">{a.w.id.replace("REL-", "")}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.w.title}</span><span className="block text-xs text-muted">{a.runs} runs · <span className="tnum">{fmtTok(a.tokens)}</span> tokens · {a.verified ? `${a.verified} verified` : a.w.state === "blocked" ? "blocked" : "no verified outcome yet"}</span></span>
                  <span className="text-right"><span className="tnum block text-sm font-medium">{money(a.cost)}</span><span className={cn("tnum block text-xs", a.verified ? "text-ok" : "text-muted")}>{a.verified ? `${money(a.cost / a.verified)} per verified` : a.unknown ? "partly unreported" : "—"}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <Head icon={Bot} title="Agents" right={<Button size="sm" variant="secondary">Connect runtime</Button>} />
          <div className="px-4">
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between"><span className="tnum text-2xl font-semibold tracking-tight">{fmtTok(runs.reduce((s, r) => s + tokensOf(r), 0))}</span><Badge tone="neutral">tokens this week</Badge></div>
              <div className="text-xs text-muted">Across 2 runtimes and 1 service</div>
            </div>
            <div className="mt-3 grid gap-3 pb-4">
              {([
                { name: "Hermes", model: "kimi-k3", provider: "Moonshot", status: "Investigating REL-139", tone: "ok", rs: byRuntime("Hermes"), dark: true },
                { name: "Pi", model: "kimi-k3", provider: "Moonshot", status: "Not yet tested", tone: "warn", rs: byRuntime("Pi"), dark: false },
              ] as const).map((a) => (
                <div key={a.name} className={cn("grid gap-4 rounded-lg border p-4", a.dark ? "border-transparent bg-foreground text-background" : "border-border bg-surface")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold">{a.name === "Hermes" ? <IntegrationLogo provider="hermes" size={24} /> : <Sparkles className="h-4 w-4" />} {a.name}</span>
                    <Badge tone={a.tone} dot>{a.status}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><div className={cn("text-[11px]", a.dark ? "text-background/60" : "text-muted")}>Model</div><div className="mono">{a.model}</div></div>
                    <div><div className={cn("text-[11px]", a.dark ? "text-background/60" : "text-muted")}>Provider</div><div>{a.provider}</div></div>
                    <div><div className={cn("text-[11px]", a.dark ? "text-background/60" : "text-muted")}>Runs</div><div className="tnum">{a.rs.length}</div></div>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="tnum text-xl font-semibold">{money(sum(a.rs))}</span>
                    <span className={cn("tnum text-xs", a.dark ? "text-background/60" : "text-muted")}>{fmtTok(a.rs.reduce((s, r) => s + tokensOf(r), 0))} tokens{hasUnknown(a.rs) ? " · +unreported" : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <Head icon={Gauge} title="Efficiency" />
          <div className="grid gap-3 px-4 pb-4">
            <div>
              <div className="text-base font-semibold">Cost per verified outcome</div>
              <div className="text-sm text-muted">Spend divided by outcomes with a real receipt — not by agent activity volume.</div>
            </div>
            <ul className="grid gap-1.5 text-sm">
              <li className="flex items-center justify-between"><span>This week</span><span className="tnum font-medium">{money(allocTotal / Math.max(1, totalVerified))}</span></li>
              <li className="flex items-center justify-between"><span>Tokens per attempt (median)</span><span className="tnum font-medium">{fmtTok(157_610)}</span></li>
              <li className="flex items-center justify-between"><span>Attempts without an outcome</span><span className="tnum font-medium">{runs.filter((r) => r.outcome === "None").length} of {runs.length}</span></li>
              <li className="flex items-center justify-between"><span>Savings vs baseline</span><Badge tone="neutral">No recorded baseline</Badge></li>
            </ul>
            <p className="text-xs text-muted">A savings claim needs a recorded baseline, comparable task and model, a measurement method, and preserved outcome quality.</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
              <code className="mono flex-1 truncate text-xs">relay usage export --week --by work,phase</code>
              <button className="text-muted hover:text-foreground" aria-label="Copy command"><Copy className="h-3.5 w-3.5" /></button>
            </div>
            <Button variant="default" className="w-full">Record a baseline for REL-139</Button>
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">All runs (audit table)</summary>
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr className="border-b border-border">{["Run", "Work", "Runtime", "Phase", "Outcome", "Started", "Duration", "Input", "Output", "Cache", "Cost"].map((h) => <th key={h} className={cn("px-4 py-2 font-medium", ["Duration", "Input", "Output", "Cache", "Cost"].includes(h) && "text-right")}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="cell-pad mono px-4">{r.id}</td><td className="cell-pad px-4">{r.work}</td><td className="cell-pad px-4 text-xs">{r.runtime} · {r.provider}</td><td className="cell-pad px-4 text-xs">{r.phase}</td>
                  <td className="cell-pad px-4"><Badge tone={r.outcome === "Verified" ? "ok" : r.outcome === "Blocked" ? "danger" : r.outcome === "Proposal" ? "accent" : "neutral"}>{r.outcome}</Badge></td>
                  <td className="cell-pad tnum px-4 text-xs text-muted">{r.started}</td><td className="cell-pad tnum px-4 text-right text-xs">{r.durationMin ? `${r.durationMin} min` : "—"}</td>
                  <td className="cell-pad tnum px-4 text-right">{fmtTok(r.inTok)}</td><td className="cell-pad tnum px-4 text-right">{fmtTok(r.outTok)}</td><td className="cell-pad tnum px-4 text-right">{fmtTok(r.cacheTok)}</td>
                  <td className="cell-pad px-4 text-right">{r.cost === null ? <Badge tone="neutral">Cost not reported</Badge> : <span className="inline-flex items-center gap-1.5"><span className="tnum">{money(r.cost)}</span>{r.costKind === "estimate" ? <Badge tone="warn">estimate</Badge> : <Badge tone="ok">provider</Badge>}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
