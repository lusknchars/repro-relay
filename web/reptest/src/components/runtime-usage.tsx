import { Activity } from "lucide-react";
import { api, useLoad, when } from "@/lib/live";

type Counters = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  model_calls: number | null;
};
type RuntimeUsage = {
  available: boolean;
  reason?: string;
  observed_at?: string;
  last_activity_at?: string | null;
  totals?: Counters;
  models?: (Counters & { model: string })[];
};
const number = (value: number | null | undefined) =>
  value == null ? "Not reported" : value.toLocaleString("en-US");

export function RuntimeUsagePanel({ revision }: { revision: number }) {
  const { data, loading, error } = useLoad(
    () => api<RuntimeUsage>("/usage/runtime"),
    [revision],
    15000,
  );
  const totals = data?.available ? data.totals : undefined;
  return (
    <section
      aria-label="Hermes runtime usage"
      data-glass-panel
      className="min-w-0 border border-border bg-surface p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity size={16} /> Hermes runtime usage
        </h2>
        <span className="text-xs text-muted">All time · dedicated local runtime</span>
      </header>
      {loading && !data && <p role="status" className="mt-3 text-sm text-muted">Reading runtime usage…</p>}
      {error && <p role="status" className="mt-3 text-sm text-muted">{error}</p>}
      {!loading && !error && !totals && (
        <p role="status" className="mt-3 text-sm text-muted">{data?.reason || "No runtime usage reported yet."}</p>
      )}
      {totals && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {([
              ["Tokens including cache", totals.total_tokens],
              ["Input", totals.input_tokens],
              ["Output", totals.output_tokens],
              ["Cache read", totals.cache_read_tokens],
              ["Cache write", totals.cache_write_tokens],
              ["Model requests", totals.model_calls],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0 border-l-2 border-accent/40 pl-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 break-words text-xl font-semibold tabular-nums">{number(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs">
            {data?.models?.map(model => (
              <span key={model.model}><strong>{model.model}</strong> · {number(model.total_tokens)} tokens</span>
            ))}
            <span className="text-muted">Dollar cost: Not reported</span>
            <span className="text-muted">Last activity: {data?.last_activity_at ? when(data.last_activity_at) : "Not reported"}</span>
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted">
        Includes chat, direct API requests and investigations recorded by this Hermes runtime.
        These cumulative totals may overlap the work records below; they are not added to case costs.
        Work filters apply below. Agent Index reporting runs separately.
      </p>
    </section>
  );
}
