import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Database,
  Pause,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { api, useLoad, useWorkspace } from "@/lib/live";
import { cn } from "@/lib/utils";
import "./monitoring.css";

const latencyBands = [
  { label: "Fast", range: "<100 ms", limit: 100, bars: 1, tone: "fast" },
  {
    label: "Moderate",
    range: "100–<500 ms",
    limit: 500,
    bars: 2,
    tone: "moderate",
  },
  { label: "Slow", range: "≥500 ms", limit: Infinity, bars: 3, tone: "slow" },
];

function LatencyBars({ bars }: { bars: number }) {
  return (
    <span className="latency-bars" aria-hidden="true">
      {[1, 2, 3].map((bar) => (
        <i key={bar} data-filled={bar <= bars} />
      ))}
    </span>
  );
}

function RequestLatency({ ms }: { ms: number }) {
  const band =
    Number.isFinite(ms) && ms >= 0
      ? latencyBands.find((band) => ms < band.limit)
      : undefined;
  return (
    <span
      className="request-latency"
      data-latency={band?.tone ?? "unknown"}
      title={
        band
          ? `${band.label}: ${band.range}. Relay API handler time.`
          : "Duration unavailable"
      }
    >
      <LatencyBars bars={band?.bars ?? 0} />
      <span>
        {band
          ? `${ms.toLocaleString(undefined, { maximumFractionDigits: 2 })} ms`
          : "—"}
      </span>
      <span className="latency-label">{band?.label ?? "Unknown"}</span>
    </span>
  );
}
type Event = {
  id: number;
  at: string;
  method: string;
  endpoint: string;
  status: number;
  duration_ms: number;
};
type Snapshot = {
  started_at: string;
  checked_at: string;
  total_captured: number;
  retained: number;
  capacity: number;
  events: Event[];
  traffic: { at: string; count: number }[];
  retention: string;
  database: {
    status: string;
    storage_bytes: number | null;
    probe_ms: number | null;
    pool_open: number;
    pool_idle: number;
    pool_max: number;
    detail?: string;
  };
};
const stamp = (at: string) =>
  new Date(at).toLocaleTimeString([], { hour12: false });
const number = (v: number) => v.toLocaleString();
const bytes = (v: number | null) =>
  v === null
    ? "Unavailable"
    : v >= 1024 ** 3
      ? `${(v / 1024 ** 3).toFixed(2)} GB`
      : `${(v / 1024 ** 2).toFixed(1)} MB`;
const tone = (status: number) =>
  status >= 500 ? "danger" : status >= 400 ? "warn" : "info";
function Limit({
  label,
  value,
  max,
  note,
}: {
  label: string;
  value: number;
  max: number;
  note: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex justify-between gap-3 text-xs">
        <span>{label}</span>
        <span className="font-mono">
          {number(value)} / {number(max)}
        </span>
      </div>
      <progress
        className="h-1.5 w-full accent-[var(--accent)]"
        value={value}
        max={max}
        aria-label={label}
      />
      <p className="text-[11px] text-muted">{note}</p>
    </div>
  );
}
export function MonitoringPage({ onWork }: { onWork: (id: string) => void }) {
  const data = useLoad(() => api<Snapshot>("/monitoring"), [], 3000);
  const workspace = useWorkspace();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [paused, setPaused] = useState<Event[] | null>(null);
  const [cleared, setCleared] = useState(0);
  const [selected, setSelected] = useState<Event>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [!!selected]);
  useEffect(() => {
    setCleared(0);
    setPaused(null);
  }, [data.data?.started_at]);
  const snapshot = data.data;
  const matches = (e: Event) =>
    (status === "all" ||
      (status === "errors" ? e.status >= 400 : e.status < 400)) &&
    `${e.method} ${e.endpoint} ${e.status}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const events = (snapshot?.events || []).filter(matches);
  const consoleEvents = (paused ?? snapshot?.events ?? [])
    .filter((e) => e.id > cleared && matches(e))
    .slice(0, 40);
  const db = snapshot?.database;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(today.getTime() - (6 - i) * 86400000),
  );
  const traffic = new Map(
    snapshot?.traffic.map((t) => [Date.parse(t.at), t.count]) || [],
  );
  const maximum = Math.max(1, ...traffic.values());
  return (
    <div className="grid min-w-0 gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Monitoring</h1>
          <p className="mt-1 text-sm text-muted">
            Relay API requests, database health and investigation evidence.
          </p>
        </div>
        <Button onClick={data.refresh} pending={data.loading}>
          <RefreshCw size={14} />
          Refresh monitoring
        </Button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <Activity size={14} />
          Local Relay service · summaries refresh every 3 seconds
        </span>
        <span>
          {snapshot
            ? `Capture started ${new Date(snapshot.started_at).toLocaleString()}`
            : "Waiting for telemetry"}
        </span>
      </div>
      {data.error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
        >
          {data.error}
        </p>
      )}
      {!snapshot && data.loading && (
        <p role="status">Loading operational telemetry…</p>
      )}
      <Card className="min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 p-4">
          <span className="rounded-md bg-surface-2 p-2">
            <Database size={17} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Database instance</h2>
            <p className="text-xs text-muted">
              The PostgreSQL database used by this Relay service.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="bg-surface-2 text-muted">
              <tr>
                {[
                  "Database / Engine",
                  "Probe round trip",
                  "Pool busy / open",
                  "Database storage",
                  "Status",
                ].map((t) => (
                  <th key={t} className="px-4 py-3 font-medium">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="px-4 py-4 font-medium">Relay / PostgreSQL</td>
                <td className="px-4 font-mono">
                  {db?.probe_ms != null
                    ? `${db.probe_ms.toFixed(1)} ms`
                    : "Unavailable"}
                </td>
                <td className="px-4 font-mono">
                  {db
                    ? `${Math.max(0, db.pool_open - db.pool_idle)} / ${db.pool_open}`
                    : "Unavailable"}
                </td>
                <td className="px-4 font-mono">
                  {bytes(db?.storage_bytes ?? null)}
                </td>
                <td className="px-4">
                  <Badge
                    dot
                    tone={
                      db?.status === "available"
                        ? "ok"
                        : db
                          ? "danger"
                          : "outline"
                    }
                  >
                    {db?.status === "available"
                      ? "Available"
                      : db
                        ? "Probe failed"
                        : "Not checked"}
                  </Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
          {db?.detail ||
            "Probe time includes connection acquisition. Pool counts belong to Relay; cluster replicas, database QPS and provider storage quotas are not measured."}
        </p>
      </Card>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-2.5 text-muted" />
          <input
            aria-label="Search request logs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search endpoints, methods or status…"
            className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm"
          />
        </label>
        <select
          aria-label="Request status filter"
          className="rounded-md border border-border bg-surface px-3 text-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All requests</option>
          <option value="errors">Errors · 4xx and 5xx</option>
          <option value="success">Success and redirects</option>
        </select>
      </div>
      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Terminal size={16} />
            Live console{" "}
            <span className="text-xs font-normal text-muted">
              ·{" "}
              {paused ? "View paused" : `${consoleEvents.length} recent events`}
            </span>
          </h2>
          <div className="flex gap-2">
            <Button
              size="icon"
              aria-label={paused ? "Resume live console" : "Pause live console"}
              onClick={() =>
                setPaused(paused ? null : [...(snapshot?.events || [])])
              }
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </Button>
            <Button
              size="icon"
              aria-label="Clear console view"
              onClick={() =>
                setCleared(
                  Math.max(
                    0,
                    ...(paused ?? snapshot?.events ?? []).map((e) => e.id),
                  ),
                )
              }
            >
              <Trash2 size={14} />
            </Button>
          </div>
        </div>
        <div className="latency-legend" aria-label="Request latency legend">
          <span>Handler time</span>
          {latencyBands.map((band) => (
            <span key={band.tone} data-latency={band.tone}>
              <LatencyBars bars={band.bars} />
              {band.label} {band.range}
            </span>
          ))}
        </div>
        <div
          className="max-h-80 min-h-52 overflow-auto font-mono text-xs"
          aria-label="Request console"
        >
          {consoleEvents.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelected(e)}
              className="grid w-full min-w-[600px] grid-cols-[85px_60px_45px_minmax(0,1fr)_190px] items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
            >
              <span className="text-muted">{stamp(e.at)}</span>
              <span>{e.method}</span>
              <span
                className={e.status >= 400 ? "text-danger" : "text-foreground"}
              >
                {e.status}
              </span>
              <span className="truncate text-muted">{e.endpoint}</span>
              <RequestLatency ms={e.duration_ms} />
            </button>
          ))}
          {!consoleEvents.length && (
            <p className="p-4 text-muted">
              {paused
                ? "No events in this paused view."
                : snapshot
                  ? "No matching requests in this view. Use Relay to capture API activity."
                  : "Console unavailable until telemetry loads."}
            </p>
          )}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
          Pause and clear affect this view only. Collection continues. Request
          bodies, headers, query strings and account routes are excluded.
        </p>
      </Card>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1.05fr_.8fr]">
        <Card className="min-w-0 overflow-hidden">
          <div className="p-4">
            <h2 className="text-sm font-semibold">Recent requests</h2>
            <p className="mt-1 text-xs text-muted">
              Status and handler time for captured API calls.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[390px] text-left text-xs">
              <thead className="border-y border-border bg-surface-2">
                <tr>
                  {["Method", "Endpoint", "Status", "Duration"].map((t) => (
                    <th className="p-3 font-medium" key={t}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 6).map((e) => (
                  <tr key={e.id} className="border-b border-border/60">
                    <td className="p-3 font-mono text-[10px]">{e.method}</td>
                    <td className="max-w-[150px] truncate p-3">
                      <button
                        className="underline-offset-2 hover:underline"
                        onClick={() => setSelected(e)}
                        title={e.endpoint}
                      >
                        {e.endpoint.replace("/api/v1", "")}
                      </button>
                    </td>
                    <td className="p-3">
                      <Badge tone={tone(e.status)}>{e.status}</Badge>
                    </td>
                    <td className="p-3 font-mono">
                      {e.duration_ms.toFixed(0)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!events.length && (
              <p className="p-4 text-xs text-muted">
                No matching captured requests.
              </p>
            )}
          </div>
        </Card>
        <Card className="min-w-0 p-4">
          <div className="mb-4 flex justify-between gap-2">
            <h2 className="text-sm font-semibold">Captured traffic</h2>
            <span className="text-[10px] text-muted">Low ░▒▓ High</span>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[320px] grid-cols-[32px_repeat(8,minmax(0,1fr))] gap-1">
              <span />
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="text-center text-[9px] text-muted">
                  {String(i * 3).padStart(2, "0")}–
                  {String((i + 1) * 3).padStart(2, "0")}
                </span>
              ))}
              {days.map((day) => (
                <div key={day.toISOString()} className="contents">
                  <span className="self-center text-[10px] text-muted">
                    {day.toLocaleDateString(undefined, {
                      weekday: "short",
                      timeZone: "UTC",
                    })}
                  </span>
                  {Array.from({ length: 8 }, (_, hour) => {
                    const at = day.getTime() + hour * 10800000;
                    const count = traffic.get(at) || 0;
                    const observed =
                      !!snapshot &&
                      at + 10800000 > Date.parse(snapshot.started_at) &&
                      at <= Date.parse(snapshot.checked_at);
                    const label = `${day.toISOString().slice(0, 10)} ${hour * 3}:00 UTC · ${observed ? `${count} captured requests` : "No capture coverage"}`;
                    return (
                      <div
                        key={hour}
                        tabIndex={0}
                        role="img"
                        aria-label={label}
                        title={label}
                        className={cn(
                          "h-7 rounded-sm border",
                          observed
                            ? "border-transparent"
                            : "border-dashed border-border",
                        )}
                        style={
                          observed
                            ? {
                                backgroundColor: `color-mix(in srgb, var(--foreground) ${8 + (count / maximum) * 80}%, var(--surface))`,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Last 7 days · UTC · counts since this API process started. Dashed
            cells have no capture coverage. Monitoring polls are excluded.
          </p>
        </Card>
        <Card className="grid content-start gap-5 p-4">
          <div>
            <h2 className="text-sm font-semibold">Service limits</h2>
            <p className="mt-1 text-xs text-muted">
              Configured capacities, measured locally.
            </p>
          </div>
          {snapshot && db ? (
            <>
              <Limit
                label="Open database pool"
                value={db.pool_open}
                max={db.pool_max}
                note="Application pool capacity; not a database account quota."
              />
              <Limit
                label="Request summary buffer"
                value={snapshot.retained}
                max={snapshot.capacity}
                note="Oldest summaries rotate out when full."
              />
              <p className="text-xs text-muted">
                {number(snapshot.total_captured)} requests captured since
                startup. Up to 200 recent summaries are returned per refresh.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted">Awaiting service measurements.</p>
          )}
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Investigation evidence</h2>
        <p className="mt-1 text-xs text-muted">
          Open a work record for its build, reported conditions, findings and
          verification receipts. These service logs are not diagnostics from the
          investigated application.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {workspace.data?.cases.slice(0, 4).map((c) => (
            <button
              key={c.id}
              onClick={() => onWork(c.id)}
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border p-3 text-left hover:bg-surface-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{c.title}</span>
                <span className="block truncate font-mono text-[10px] text-muted">
                  Build {c.build} · {c.status}
                </span>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
        {!workspace.data?.cases.length && (
          <p className="mt-3 text-xs text-muted">No work records loaded.</p>
        )}
      </Card>
      <p className="text-[11px] text-muted">{snapshot?.retention}</p>
      <dialog
        ref={dialog}
        aria-label="Request details"
        onClose={() => setSelected(undefined)}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/50"
      >
        {selected && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Request details</h2>
              <Button
                aria-label="Close request details"
                size="icon"
                onClick={() => setSelected(undefined)}
              >
                <X size={16} />
              </Button>
            </div>
            <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 text-sm">
              <dt className="text-muted">Time</dt>
              <dd>{new Date(selected.at).toLocaleString()}</dd>
              <dt className="text-muted">Method</dt>
              <dd>{selected.method}</dd>
              <dt className="text-muted">Route</dt>
              <dd className="break-all font-mono text-xs">
                {selected.endpoint}
              </dd>
              <dt className="text-muted">HTTP status</dt>
              <dd>
                <Badge tone={tone(selected.status)}>{selected.status}</Badge>
              </dd>
              <dt className="text-muted">Handler time</dt>
              <dd>{selected.duration_ms.toFixed(2)} ms</dd>
            </dl>
            <p className="mt-4 text-xs text-muted">
              Route parameters are redacted. A successful HTTP request is not
              proof that an investigation or fix passed.
            </p>
          </>
        )}
      </dialog>
    </div>
  );
}
