import { useState } from "react";
import { RuntimeUsagePanel } from "@/components/runtime-usage";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button } from "@/components/ui";
import { useWorkspace, when } from "@/lib/live";
export function UsagePage() {
  const { data, error, loading, refresh } = useWorkspace();
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [selected, setSelected] = useState("all");
  const runs = (data?.runs || []).filter(
    (r) =>
      r.execution_kind !== "local_validation" &&
      (selected === "all" || r.case_id === selected),
  );
  const measured = runs.filter((r) => typeof r.usage?.cost_usd === "number");
  const sum = measured.reduce((total, r) => total + r.usage!.cost_usd!, 0);
  const tokens = runs.filter(
    (r) =>
      typeof r.usage?.input_tokens === "number" ||
      typeof r.usage?.output_tokens === "number",
  );
  const chart = runs
    .slice()
    .reverse()
    .map((r) => ({
      id: r.id,
      cost: r.usage?.cost_usd ?? null,
      input: r.usage?.input_tokens ?? null,
      output: r.usage?.output_tokens ?? null,
    }));
  return (
    <div className="grid gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-sm text-muted">
            Recorded Hermes tokens and provider-reported cost, by attempt.
          </p>
        </div>
        <Button onClick={() => { refresh(); setRuntimeRevision(n => n + 1); }}>Refresh usage</Button>
      </header>
      <RuntimeUsagePanel revision={runtimeRevision} />
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading usage…</p>}
      <label className="grid max-w-md gap-1 text-xs text-muted">
        Work record
        <select
          className="rounded-md border border-border bg-surface p-2 text-foreground"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="all">All loaded work</option>
          {data?.cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          [
            "Recorded spend",
            measured.length ? `$${sum.toFixed(4)}` : "Not reported",
          ],
          ["Cost coverage", `${measured.length} of ${runs.length} attempts`],
          ["Token coverage", `${tokens.length} of ${runs.length} attempts`],
        ].map(([label, value]) => (
          <section
            key={label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h2 className="text-sm text-muted">{label}</h2>
            <p className="mt-3 text-2xl font-semibold">{value}</p>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">
        {data?.moreRuns ? "Latest 100 workspace attempts only. " : ""}Missing
        measurements stay unknown. Local validation is excluded. Repeated
        polling snapshots are counted once per attempt. Pi and Mem0 billing are
        not reported here.
      </p>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["cost", "tokens"] as const).map((kind) => (
          <section
            key={kind}
            className="min-w-0 rounded-lg border border-border bg-surface p-4"
          >
            <h2 className="mb-4 text-sm font-semibold">
              {kind === "cost"
                ? "Reported cost (USD)"
                : "Input and output tokens"}
            </h2>
            {runs.length ? (
              <div
                className="h-64"
                role="img"
                aria-label={
                  kind === "cost"
                    ? "Cost per attempt; exact values in table below"
                    : "Tokens per attempt; exact values in table below"
                }
              >
                <ResponsiveContainer>
                  <BarChart data={chart}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="id" hide />
                    <YAxis
                      width={55}
                      tick={{ fontSize: 11, fill: "var(--muted)" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        color: "var(--foreground)",
                      }}
                    />
                    {kind === "cost" ? (
                      <Bar dataKey="cost" fill="var(--accent)" />
                    ) : (
                      <>
                        <Bar dataKey="input" fill="var(--accent)" />
                        <Bar dataKey="output" fill="var(--ok)" />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted">
                No Hermes attempts recorded.
              </p>
            )}
          </section>
        ))}
      </div>
      <section className="overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="p-4 text-left font-semibold">
            Recorded attempts
          </caption>
          <thead className="text-xs text-muted">
            <tr>
              {[
                "Attempt",
                "Model / provider",
                "State",
                "Input",
                "Output",
                "USD",
              ].map((h) => (
                <th className="px-4 py-2" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-4">
                  <div className="mono">{r.id}</div>
                  <div className="text-xs text-muted">{when(r.created_at)}</div>
                </td>
                <td className="p-4">
                  {r.usage?.model || "Not reported"}
                  <div className="text-xs text-muted">
                    {r.usage?.provider || "Not reported"}
                  </div>
                </td>
                <td className="p-4">
                  <Badge>{r.status}</Badge>
                </td>
                <td className="p-4">{r.usage?.input_tokens ?? "Unknown"}</td>
                <td className="p-4">{r.usage?.output_tokens ?? "Unknown"}</td>
                <td className="p-4">
                  {r.usage?.cost_usd?.toFixed(4) ?? "Unknown"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
