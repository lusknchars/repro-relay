import { lazy, Suspense, useState } from 'react'
import { Download, ReceiptText } from 'lucide-react'
import type { InvestigationRun } from '../types'
import { Button } from './ui/button'
import './investigation-cost.css'
const UsageCharts = lazy(() => import('./UsageCharts').then(module => ({ default: module.UsageCharts })))

const number = (value?: number) => value == null ? 'Not reported' : value.toLocaleString()
const money = (value?: number) => value == null ? 'Not reported' : value === 0 ? '$0.00' : value < .000001 ? '<$0.000001' : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded'
const terminal = (run: InvestigationRun) => ['completed','failed','cancelled'].includes(run.status)

export function InvestigationCost({ run, runs }: { run: InvestigationRun; runs: InvestigationRun[] }) {
  const [exportError, setExportError] = useState('')
  const [exportNotice, setExportNotice] = useState('')
  const usage = run.usage; const audit = run.usage_audit
  const local = run.execution_kind === 'local_validation'
  const investigations = runs.filter(r => r.execution_kind !== 'local_validation')
  const priced = investigations.filter(r => r.usage?.cost_usd != null)
  const subtotal = priced.reduce((sum, r) => sum + r.usage!.cost_usd!, 0)
  const active = investigations.filter(r => !terminal(r)).length
  const fields = [
    ['input_tokens','Input tokens'], ['output_tokens','Output tokens'], ['total_tokens','Total tokens'],
    ['cached_input_tokens','Cached input tokens'], ['cache_write_input_tokens','Cache-write input tokens'],
    ['reasoning_output_tokens','Reasoning output tokens'], ['model_calls','Model calls'], ['tool_calls','Tool calls'],
  ] as const
  async function download() {
    setExportError(''); setExportNotice('')
    const report = { schema_version: 1, exported_at: new Date().toISOString(), attribution: local ? 'local_validation' : 'runtime_reported',
      run_id: run.id, remote_id: run.remote_id, case_id: run.case_id, case_revision: run.case_revision, build: run.build,
      context_hash: run.context_hash ?? null, context: run.context, status: run.status, checked_at: run.checked_at, usage: usage ?? null,
      usage_audit: audit ?? null, accounting: 'Last reported cumulative values per run. Do not add receipt snapshots. Missing fields remain unknown. Not a reconciled provider bill.',
      limits: { hard_spend_cap: false, cooperative_timeout_seconds: run.max_seconds },
      case_coverage: { runs: investigations.length, runs_with_cost: priced.length, reported_subtotal_usd: priced.length ? subtotal : null },
      coordinator_events: run.events, tool_cost_attribution: 'Not available. Counts are not execution receipts.' }
    const content = JSON.stringify(report, null, 2)
    try {
      if ('__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core')
        const saved = await invoke<boolean>('save_packet', { content, name: `relay-cost-${run.id}.json` })
        setExportNotice(saved ? 'Cost report saved.' : 'Export cancelled.')
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = `relay-cost-${run.id}.json`; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setExportNotice('Cost report download started.')
      }
    } catch { setExportError('The report could not be saved. Try again.') }
  }
  return <section className="relay-card investigation-cost" aria-label="Investigation cost inspector">
    <div className="iw-section-heading"><h3><ReceiptText aria-hidden="true" />Hermes usage and cost</h3></div>
    <p className="iw-caption">{local ? 'Imported local validation. Hermes usage does not apply to this record.' : terminal(run) ? 'Run ended. These are the last values Hermes reported, not a reconciled provider bill.' : 'Investigation in progress. Reported usage can change before the run ends.'}</p>
    {!local && <Suspense fallback={<p role="status">Loading usage charts…</p>}><UsageCharts run={run} runs={runs}/></Suspense>}
    {!local && <>
      <div className="cost-total"><span>Reported cost · USD</span><strong>{money(usage?.cost_usd)}</strong><small>Cost last observed: {date(audit?.fields_observed_at.cost_usd)}</small></div>
      {usage?.cost_usd == null && <p className="iw-caption">Hermes has not supplied a dollar cost. Token counts alone cannot establish the charge.</p>}
      <details className="iw-details"><summary>Token breakdown and model</summary><dl className="cost-breakdown"><div><dt>Reported model</dt><dd>{usage?.model || 'Not reported'}</dd></div><div><dt>Provider</dt><dd>{usage?.provider || 'Not reported'}</dd></div>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd title={`Last observed: ${date(audit?.fields_observed_at[key])}`}>{number(usage?.[key])}</dd></div>)}</dl>
      <p className="iw-caption">The model label may identify a runtime profile rather than a billing model. Cache and reasoning counters may overlap input/output totals. They are never added again. Tool-call counts do not identify actions or their individual cost; inspect recorded evidence in the investigation.</p></details>
      <details className="iw-details"><summary>Usage reporting history</summary><p className="iw-caption">Last valid report: {date(audit?.observed_at)}. Each field retains its last reading when omitted from a later report.</p>
        <dl className="cost-breakdown">{Object.entries(audit?.fields_observed_at || {}).map(([key, at]) => <div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{date(at)}</dd></div>)}</dl>
        {audit?.receipts.length ? <><p className="iw-caption">{audit.receipts.length} changed reports retained · {audit.omitted_receipts} earlier reports omitted. Cumulative snapshots are never summed.</p><ol className="cost-receipts">{[...audit.receipts].reverse().map((receipt, i) => <li key={`${receipt.observed_at}-${i}`}><time>{date(receipt.observed_at)}</time>{receipt.revised_downward.length > 0 && <p className="iw-warning">Runtime revised values downward: {receipt.revised_downward.join(', ')}.</p>}<pre>{JSON.stringify(receipt.reported, null, 2)}</pre></li>)}</ol></> : <p className="iw-caption">No timestamped usage reports. Older records may contain totals without reporting history.</p>}
      </details>
    </>}
    <details className="iw-details"><summary>This case's investigation spend</summary><p className="cost-subtotal">{money(priced.length ? subtotal : undefined)}</p><p className="iw-caption">Reported subtotal from {priced.length} of {investigations.length} saved investigations. {active} still active or unresolved. Includes failed and cancelled runs with reported cost; excludes imported validation. Missing costs are not zero. Up to 100 saved runs are included.</p></details>
    <details className="iw-details"><summary>Run identity and cost limits</summary><dl className="cost-breakdown"><div><dt>Relay run</dt><dd>{run.id}</dd></div><div><dt>Hermes run</dt><dd>{run.remote_id || 'Not recorded'}</dd></div><div><dt>Source build</dt><dd>{run.build || 'Not recorded'}</dd></div><div><dt>Case revision</dt><dd>{run.case_revision}</dd></div><div><dt>Context SHA-256</dt><dd>{run.context_hash || 'Not recorded'}</dd></div><div><dt>Time limit</dt><dd>{local ? 'Not applicable' : `${run.max_seconds} seconds`}</dd></div></dl><p className="iw-caption">Relay requests a cooperative stop at the time limit. A hard dollar cap is not enforced here. Provider pricing, subscription charges, and per-tool costs are not inferred.</p></details>
    <details className="iw-details"><summary>Export audit file</summary><p className="iw-caption">Optional JSON export for your records. Charts and exact values are available above.</p><Button variant="outline" onClick={() => void download()}><Download />Download cost report</Button>
    {exportNotice && <p role="status" className="iw-caption">{exportNotice}</p>}
    {exportError && <p role="alert" className="iw-warning">{exportError}</p>}</details>
  </section>
}
