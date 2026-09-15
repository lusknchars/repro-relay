import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Bot,
  Download,
  Gauge,
  Layers,
  Sparkles,
  Target,
  Terminal,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui";
import { RuntimeUsagePanel } from "@/components/runtime-usage";
import {
  desktop,
  errorText,
  useWorkspace,
  when,
  type RunSummary,
} from "@/lib/live";

type Period = "today" | "week" | "month" | "all";
const periods = {
  today: "Today",
  week: "This week",
  month: "30 days",
  all: "All loaded",
};
const measured = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const money = (value: number | null) =>
  value === null
    ? "Not reported"
    : `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;
const compact = (value: number | null) =>
  value === null
    ? "Not reported"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
function tokens(run: RunSummary): number | null {
  if (measured(run.usage?.total_tokens)) return run.usage.total_tokens;
  return measured(run.usage?.input_tokens) && measured(run.usage?.output_tokens)
    ? run.usage.input_tokens + run.usage.output_tokens
    : null;
}
function sum(values: (number | null | undefined)[]) {
  const known = values.filter(measured);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
}
const spend = (runs: RunSummary[]) =>
  sum(runs.map((run) => run.usage?.cost_usd));
const tokenSum = (runs: RunSummary[]) => sum(runs.map(tokens));
function Panel({
  title,
  icon: Icon,
  right,
  children,
}: {
  title: string;
  icon: typeof Gauge;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-glass-panel
      className="min-w-0 border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 p-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-7 w-7 place-items-center border border-border">
            <Icon size={15} />
          </span>
          {title}
        </h2>
        {right}
      </header>
      {children}
    </section>
  );
}
function Stats({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-3 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-muted">{label}</dt>
          <dd className="text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function UsagePage({
  onWork,
  onSettings,
}: {
  onWork: (id: string) => void;
  onSettings: () => void;
}) {
  const { data, error, loading, refresh } = useWorkspace();
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [period, setPeriod] = useState<Period>("week");
  const [selected, setSelected] = useState("");
  const [breakdown, setBreakdown] = useState("all");
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (period === "week")
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(start.getUTCDate() - 29);
  const runs = (data?.runs || []).filter(
    (run) =>
      run.execution_kind !== "local_validation" &&
      (period === "all" || Date.parse(run.created_at) >= start.getTime()) &&
      Date.parse(run.created_at) <= now.getTime(),
  );
  const costCount = runs.filter((run) => measured(run.usage?.cost_usd)).length;
  const tokenCount = runs.filter((run) => tokens(run) !== null).length;
  const covered = spend(runs);
  const work = [...new Set(runs.map((run) => run.case_id))]
    .map((id) => ({
      id,
      item: data?.cases.find((item) => item.id === id),
      runs: runs.filter((run) => run.case_id === id),
    }))
    .sort((a, b) => (spend(b.runs) ?? -1) - (spend(a.runs) ?? -1));
  const current = work.find((item) => item.id === selected) || work[0];
  const attempts = current?.runs || [];
  const expensive = attempts
    .filter((run) => measured(run.usage?.cost_usd))
    .sort((a, b) => b.usage!.cost_usd! - a.usage!.cost_usd!)[0];
  const chart = attempts
    .filter((run) => tokens(run) !== null)
    .slice()
    .reverse()
    .map((run) => ({
      id: run.id,
      tokens: tokens(run),
      cost: run.usage?.cost_usd ?? null,
    }));
  const values = runs
    .map(tokens)
    .filter(measured)
    .sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length
    ? values.length % 2
      ? values[middle]
      : (values[middle - 1] + values[middle]) / 2
    : null;
  const breakdownRuns = breakdown === "selected" ? attempts : runs;
  const breakdownSpend = spend(breakdownRuns);
  const providers = [
    ...new Set(runs.map((run) => run.usage?.provider).filter(Boolean)),
  ];
  const models = [
    ...new Set(runs.map((run) => run.usage?.model).filter(Boolean)),
  ];
  async function exportUsage() {
    setExporting(true);
    setNotice("");
    try {
      const content = JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          period,
          period_start_utc: period === "all" ? null : start.toISOString(),
          truncated: data?.moreRuns ?? false,
          scope:
            "Loaded Hermes attempts; Pi, Mem0 and local validation excluded",
          covered_cost_usd: covered,
          cost_reported_runs: costCount,
          total_runs: runs.length,
          phase_attribution: null,
          verified_outcomes: null,
          runs,
        },
        null,
        2,
      );
      const name = "repro-relay-usage.json";
      if (desktop)
        setNotice(
          (await invoke<boolean>("save_packet", { content, name }))
            ? "Usage report exported."
            : "Export cancelled.",
        );
      else {
        const url = URL.createObjectURL(
          new Blob([content], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("Usage report downloaded.");
      }
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="usage-reference grid gap-3 p-4 md:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Usage</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            What each agent spent, on which problem, and what the records
            support. Unknown is never shown as zero.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex flex-wrap border border-border bg-surface-2 p-0.5"
            aria-label="Usage period"
          >
            {(Object.keys(periods) as Period[]).map((value) => (
              <button
                key={value}
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
                className={`t-control px-2 py-1.5 text-xs ${period === value ? "bg-surface text-foreground shadow-sm" : "text-muted"}`}
              >
                {periods[value]}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => { refresh(); setRuntimeRevision(n => n + 1); }}>
            Refresh usage
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!data || exporting}
            onClick={exportUsage}
          >
            <Download size={14} />
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>
      </header>
      <RuntimeUsagePanel revision={runtimeRevision} />
      {error && (
        <p
          role="alert"
          className="border border-danger/40 bg-danger-soft p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {loading && !data && <p role="status">Loading usage…</p>}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            name: "Hermes",
            sub: "Investigation runtime",
            icon: Sparkles,
            cost: covered,
            observed: true,
          },
          {
            name: "Pi",
            sub: "Terminal review",
            icon: Terminal,
            cost: null,
            observed: false,
          },
          {
            name: "Mem0",
            sub: "Private notes service",
            icon: Layers,
            cost: null,
            observed: false,
          },
          {
            name: "Workspace",
            sub: `Loaded runtime records · ${periods[period].toLowerCase()}`,
            icon: Wallet,
            cost: covered,
            observed: true,
          },
        ].map((item) => (
          <section
            data-glass-panel
            key={item.name}
            className="min-w-0 border border-border bg-surface p-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-8 w-8 place-items-center border border-border">
                <item.icon size={16} />
              </span>
              <span>
                {item.name}
                <span className="block text-xs font-normal text-muted">
                  {item.sub}
                </span>
              </span>
            </h2>
            <div className="mt-3 grid gap-1">
              <strong className="usage-metric">
                {money(item.cost)}
              </strong>
              <span className="text-xs text-muted">
                {item.observed ? "covered spend" : "billing unavailable"}
              </span>
            </div>
            <div className="mt-3 flex h-1.5 gap-1" aria-hidden>
              {[0, 1, 2, 3, 4].map((index) => (
                <span key={index} className="flex-1 bg-surface-2" />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {item.observed
                ? `${costCount} of ${runs.length} attempts report cost. No configured cap.`
                : "Usage not reported by this service."}
            </p>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">
        {data?.moreRuns
          ? "Latest 100 workspace attempts only; period totals may be incomplete. "
          : ""}
        Periods use UTC; this week starts Monday. Local validation is excluded.
        Pi and Mem0 billing are not reported here.
      </p>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,5fr)_minmax(0,5fr)]">
        <Panel title="Spend on one problem" icon={Target}>
          <div className="px-3 pb-4">
            <label className="grid gap-1 text-xs text-muted">
              Work record
              <select
                aria-label="Work record"
                value={current?.id || ""}
                onChange={(event) => setSelected(event.target.value)}
                className="min-w-0 w-full border border-border bg-surface px-2 py-1.5 text-foreground"
              >
                <option value="" disabled>
                  Select work
                </option>
                {work.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item?.title || item.id}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="mt-3 flex max-h-20 flex-wrap gap-1 overflow-auto"
              aria-label="Work items"
            >
              {work.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  aria-pressed={current?.id === item.id}
                  className={`t-control max-w-full truncate border px-2 py-1 text-xs ${current?.id === item.id ? "border-transparent bg-foreground text-background" : "border-border"}`}
                >
                  {item.id}
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted">
              {current?.item?.title ||
                current?.id ||
                "No Hermes attempts in this period."}
            </p>
            <p className="mt-2 text-xs text-muted">
              {attempts.length} attempts
              {current?.item ? ` · ${current.item.status}` : ""}
            </p>
            <p className="usage-metric mt-3">
              {money(spend(attempts))}
            </p>
            <p className="mt-1 text-xs text-muted">
              {compact(tokenSum(attempts))} tokens ·{" "}
              {attempts.filter((run) => !measured(run.usage?.cost_usd)).length}{" "}
              costs not reported
            </p>
            <p className="mt-4 text-xs text-muted">
              Cost belongs to the work record the run started for. Run
              completion does not establish a verified outcome.
            </p>
            {current && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() => onWork(current.id)}
              >
                Open work record
              </Button>
            )}
          </div>
        </Panel>
        <Panel
          title="Cost per attempt"
          icon={Gauge}
          right={
            <div className="text-right text-xs text-muted">
              <p>{money(spend(attempts))} total</p>
              <p>{compact(tokenSum(attempts))} tokens</p>
            </div>
          }
        >
          <div
            className="h-56 px-2 pb-3"
            role="img"
            aria-label="Tokens per attempt; exact costs and tokens in the audit table"
          >
            {chart.length ? (
              <ResponsiveContainer>
                <BarChart
                  data={chart}
                  margin={{ top: 20, left: -12, right: 8 }}
                >
                  <defs>
                    <pattern
                      id="usage-hatch"
                      width="6"
                      height="6"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="6"
                        stroke="var(--accent)"
                        strokeWidth="1.2"
                        opacity="0.5"
                      />
                    </pattern>
                  </defs>
                  <CartesianGrid
                    stroke="var(--border)"
                    vertical={false}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="id"
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickFormatter={(value) => String(value).slice(-8)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) => compact(value)}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--foreground)",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="tokens"
                    fill="url(#usage-hatch)"
                    stroke="var(--accent)"
                    isAnimationActive={false}
                  >
                    {chart.map((item) => (
                      <Cell
                        key={item.id}
                        stroke={
                          item.id === expensive?.id
                            ? "var(--danger)"
                            : "var(--accent)"
                        }
                        strokeDasharray={
                          item.id === expensive?.id ? "4 3" : undefined
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="grid h-full place-items-center text-center text-sm text-muted">
                No measured token totals in this selection.
              </p>
            )}
          </div>
          <div className="border-t border-border p-3 text-xs text-muted">
            <p className="break-all">
              Highest reported cost:{" "}
              {expensive
                ? `${expensive.id} · ${money(expensive.usage?.cost_usd ?? null)}`
                : "Not reported"}
            </p>
            <p className="mt-1">
              Bars scale by measured tokens, not dollars.{" "}
              {attempts.length - chart.length} attempts without totals omitted.
            </p>
          </div>
        </Panel>
        <Panel
          title="Where the money went"
          icon={Layers}
          right={
            <select
              aria-label="Spend breakdown scope"
              value={breakdown}
              onChange={(event) => setBreakdown(event.target.value)}
              className="border border-border bg-surface p-1 text-xs"
            >
              <option value="all">All work</option>
              <option value="selected">Selected work</option>
            </select>
          }
        >
          <div className="grid items-center gap-2 px-3 pb-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <div
              className="relative mx-auto h-[160px] w-[160px]"
              role="img"
              aria-label="Reported spend; phase attribution unavailable"
            >
              {breakdownSpend !== null && breakdownSpend > 0 ? (
                <PieChart width={160} height={160}>
                  <Pie
                    data={[{ value: breakdownSpend }]}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={53}
                    outerRadius={73}
                    fill="var(--accent)"
                    stroke="none"
                    isAnimationActive={false}
                  />
                </PieChart>
              ) : (
                <div className="absolute inset-2 rounded-full border-[18px] border-border" />
              )}
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <strong className="text-sm">{money(breakdownSpend)}</strong>
                  <p className="text-[11px] text-muted">covered spend</p>
                </div>
              </div>
            </div>
            <ul className="min-w-0 divide-y divide-border text-xs">
              <li className="flex justify-between gap-2 py-2">
                <span>Unallocated phase</span>
                <span>{money(breakdownSpend)}</span>
              </li>
              {["Investigation", "Checks", "Proposal", "Audit", "Memory"].map(
                (label) => (
                  <li
                    key={label}
                    className="flex justify-between gap-2 py-2 text-muted"
                  >
                    <span>{label}</span>
                    <span>Not reported</span>
                  </li>
                ),
              )}
            </ul>
          </div>
          <p className="border-t border-border p-3 text-xs text-muted">
            Phase costs are not supplied by the current telemetry. Excludes{" "}
            {
              breakdownRuns.filter((run) => !measured(run.usage?.cost_usd))
                .length
            }{" "}
            attempts with unreported cost.
          </p>
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,4fr)]">
        <Panel title="Spend by problem" icon={Target}>
          <div className="px-3 pb-3">
            <div className="border border-border bg-surface-2 p-3">
              <strong className="usage-metric">
                {money(covered)}
              </strong>
              <p className="text-xs text-muted">
                Covered spend across {work.length} work records
              </p>
            </div>
            <div className="mt-3 flex justify-between text-xs text-muted">
              <span>Allocation</span>
              <span>
                {covered !== null && covered > 0
                  ? "100% of covered spend"
                  : "No positive spend reported"}
              </span>
            </div>
            <div className="mt-1 flex h-1.5 gap-0.5 bg-surface-2" aria-hidden>
              {covered !== null &&
                covered > 0 &&
                work.map((item, index) => (
                  <span
                    key={item.id}
                    style={{
                      width: `${((spend(item.runs) || 0) / covered) * 100}%`,
                      background:
                        index === 0 ? "var(--foreground)" : "var(--accent)",
                      opacity: index < 2 ? 1 : 0.4,
                    }}
                  />
                ))}
            </div>
            <div className="mt-2 max-h-72 divide-y divide-border overflow-auto">
              {work.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelected(item.id)}
                  className="t-control grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 py-3 text-left hover:bg-surface-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.item?.title || item.id}
                    </span>
                    <span className="block text-xs text-muted">
                      {item.runs.length} runs · {compact(tokenSum(item.runs))}{" "}
                      tokens
                    </span>
                  </span>
                  <span className="text-right text-sm">
                    {money(spend(item.runs))}
                    <span className="block text-xs text-muted">
                      {item.runs.some((run) => !measured(run.usage?.cost_usd))
                        ? "Partly unreported"
                        : "Reported"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {!work.length && (
              <p className="py-5 text-sm text-muted">
                No work with Hermes usage in this period.
              </p>
            )}
          </div>
        </Panel>
        <Panel
          title="Agents"
          icon={Bot}
          right={
            <Button size="sm" onClick={onSettings}>
              Connect runtime
            </Button>
          }
        >
          <div className="grid gap-3 px-3 pb-3">
            <div className="border border-border bg-surface-2 p-3">
              <strong className="usage-metric">
                {compact(tokenSum(runs))}
              </strong>
              <p className="text-xs text-muted">
                Reported tokens · {tokenCount} of {runs.length} attempts
              </p>
            </div>
            <div className="grid gap-4 bg-foreground p-3 text-background">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <strong>Hermes</strong>
                <span className="text-xs">
                  {!data
                    ? "Status unavailable"
                    : data.runner.available
                      ? "Runtime available"
                      : "Runtime unavailable"}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div className="min-w-0">
                  <dt className="opacity-60">Model</dt>
                  <dd className="break-words">
                    {models.join(", ") || "Not reported"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="opacity-60">Provider</dt>
                  <dd className="break-words">
                    {providers.join(", ") || "Not reported"}
                  </dd>
                </div>
                <div>
                  <dt className="opacity-60">Runs</dt>
                  <dd>{runs.length}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="usage-metric">{money(covered)}</strong>
                <span className="text-xs opacity-60">
                  {compact(tokenSum(runs))} tokens
                </span>
              </div>
            </div>
            <div className="border border-border p-3">
              <h3 className="text-sm font-semibold">Pi</h3>
              <p className="mt-2 text-xs text-muted">
                Terminal usage stays in its host. Model, provider, runs and
                spend are not reported here.
              </p>
            </div>
          </div>
        </Panel>
        <Panel title="Efficiency" icon={Gauge}>
          <div className="grid gap-3 px-3 pb-4">
            <div>
              <h3 className="text-base font-semibold">
                Cost per verified outcome
              </h3>
              <p className="mt-1 text-xs text-muted">
                Requires an attributable verification receipt, not a completed
                agent run.
              </p>
            </div>
            <Stats
              rows={[
                [periods[period], "Not available"],
                ["Tokens per attempt (median)", compact(median)],
                ["Cost coverage", `${costCount} of ${runs.length} attempts`],
                ["Verified outcomes", "Not reported"],
                ["Savings vs baseline", "No recorded baseline"],
              ]}
            />
            <p className="text-xs text-muted">
              A savings claim needs a comparable baseline and preserved outcome
              quality. Baseline recording is not available in this view.
            </p>
            <Button
              className="w-full"
              disabled={!current}
              onClick={() => current && onWork(current.id)}
            >
              Review work evidence
            </Button>
          </div>
        </Panel>
      </div>
      <details open className="min-w-0 border border-border bg-surface">
        <summary className="cursor-pointer p-3 text-sm font-semibold">
          All runs (audit table)
        </summary>
        <div
          className="overflow-x-auto border-t border-border"
          tabIndex={0}
          role="region"
          aria-label="Usage audit table"
        >
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="text-muted">
              <tr>
                {[
                  "Run",
                  "Work",
                  "Runtime / provider",
                  "State",
                  "Verified outcome",
                  "Started",
                  "Duration",
                  "Input",
                  "Output",
                  "Cache read",
                  "Cost",
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 font-mono">{run.id}</td>
                  <td className="px-3 py-2">
                    <button
                      className="text-accent-text underline"
                      onClick={() => onWork(run.case_id)}
                    >
                      {run.case_id}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    Hermes · {run.usage?.provider || "Not reported"}
                  </td>
                  <td className="px-3 py-2">{run.status}</td>
                  <td className="px-3 py-2 text-muted">Not reported</td>
                  <td className="px-3 py-2">{when(run.created_at)}</td>
                  <td className="px-3 py-2 text-muted">Not reported</td>
                  {[
                    run.usage?.input_tokens,
                    run.usage?.output_tokens,
                    run.usage?.cached_input_tokens,
                  ].map((value, index) => (
                    <td key={index} className="px-3 py-2 text-right">
                      {measured(value)
                        ? value.toLocaleString()
                        : "Not reported"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    {money(
                      measured(run.usage?.cost_usd) ? run.usage.cost_usd : null,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!runs.length && (
            <p className="p-4 text-sm text-muted">
              {data
                ? "No Hermes attempts in this period."
                : "Usage records unavailable."}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
