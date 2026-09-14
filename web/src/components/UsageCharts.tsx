import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { InvestigationRun } from '../types'
import { Button } from './ui/button'

const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const display = (value: number | null, cost: boolean) => value === null ? 'Not reported' : cost ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : value.toLocaleString()
const short = (value: number) => Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value)
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }

export function UsageCharts({ run, runs }: { run: InvestigationRun; runs: InvestigationRun[] }) {
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const cost = metric === 'cost'
  const field = cost ? 'cost_usd' : 'total_tokens'
  const local = run.execution_kind === 'local_validation'
  const receipts = run.usage_audit?.receipts || []
  const samples = receipts.map(receipt => ({
    label: new Date(receipt.observed_at).toLocaleTimeString(),
    timestamp: Date.parse(receipt.observed_at),
    at: new Date(receipt.observed_at).toLocaleString(),
    value: numeric(receipt.reported[field]),
    revised: receipt.revised_downward.includes(field),
  }))
  const hasHistory = samples.some(sample => sample.value !== null)
  // A total can outlive its retained reports. Show it without inventing a timeline.
  if (!hasHistory && numeric(run.usage?.[field]) !== null) {
    samples.length = 0
    const observedAt = run.usage_audit?.fields_observed_at[field]
    samples.push({ label: 'Latest total', timestamp: 0, at: observedAt ? new Date(observedAt).toLocaleString() : 'Observation time not recorded', value: numeric(run.usage?.[field]), revised: false })
  }
  const comparison = runs.filter(item => item.execution_kind !== 'local_validation')
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((item, index) => ({ label: `${index + 1}`, id: item.id, status: item.status, value: numeric(item.usage?.[field]) }))
  const known = comparison.filter(item => item.value !== null).length
  const hasSamples = !local && samples.some(sample => sample.value !== null)
  const amount = (value: number) => cost ? `$${short(value)}` : short(value)
  return <section className="usage-charts" aria-label="Hermes usage charts">
    <div className="usage-chart-toolbar"><div><h4>Usage at a glance</h4><p className="iw-caption">Selected investigation and saved runs in this case.</p></div><div role="group" aria-label="Chart metric"><Button size="sm" variant={cost ? 'outline' : 'default'} aria-pressed={!cost} onClick={() => setMetric('tokens')}>Tokens</Button><Button size="sm" variant={cost ? 'default' : 'outline'} aria-pressed={cost} onClick={() => setMetric('cost')}>Cost · USD</Button></div></div>
    <div className="usage-chart-panel">
      <h4>{cost ? 'Reported cost over time' : 'Total tokens over time'}</h4>
      {hasSamples ? <>
        <div className="usage-chart-canvas" role="img" aria-label={`${cost ? 'Cost' : 'Token'} timeline with ${samples.filter(s => s.value !== null).length} reported readings. Exact values are in Chart data below.`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 400, height: 190 }}>
            <LineChart data={samples} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3"/>
              <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={value => hasHistory ? new Date(Number(value)).toLocaleTimeString() : 'Latest total'} tick={{ fontSize: 10, fill: 'var(--muted)' }} minTickGap={35}/>
              <YAxis width={55} domain={[0, 'auto']} tickFormatter={amount} allowDecimals={cost} tick={{ fontSize: 10, fill: 'var(--muted)' }}/>
              <Tooltip contentStyle={tooltipStyle} labelFormatter={value => hasHistory ? new Date(Number(value)).toLocaleString() : 'Latest saved total'} formatter={value => [display(numeric(Number(value)), cost), cost ? 'USD' : 'Total tokens']}/>
              <Line dataKey="value" name={cost ? 'USD' : 'Total tokens'} type="linear" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="iw-caption">{hasHistory ? 'Cumulative readings, never added together. Missing readings leave gaps.' : 'Latest saved total. No retained timeline for this metric.'}{samples.some(s => s.revised) ? ' Hermes revised a reading downward; the chart preserves that correction.' : ''}{run.usage_audit?.omitted_receipts ? ` ${run.usage_audit.omitted_receipts} earlier reports are outside the retained history.` : ''}</p>
      </> : <p className="usage-chart-empty">{local ? 'This record is local validation. Select a Hermes investigation to see its usage.' : cost ? 'Waiting for Hermes to report dollar cost. Token counts are not a dollar estimate.' : 'Waiting for Hermes to report total tokens. The chart appears when a reading arrives.'}</p>}
    </div>
    <div className="usage-chart-panel">
      <h4>{cost ? 'Cost by investigation' : 'Tokens by investigation'}</h4>
      {known ? <div className="usage-chart-canvas" role="img" aria-label={`${cost ? 'Cost' : 'Token'} comparison: ${known} of ${comparison.length} investigations reported. Exact values are in Chart data below.`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 400, height: 190 }}>
          <BarChart data={comparison} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3"/>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }}/>
            <YAxis width={55} domain={[0, 'auto']} tickFormatter={amount} allowDecimals={cost} tick={{ fontSize: 10, fill: 'var(--muted)' }}/>
            <Tooltip contentStyle={tooltipStyle} labelFormatter={label => `Investigation ${label}`} formatter={value => [display(numeric(Number(value)), cost), cost ? 'USD' : 'Total tokens']}/>
            <Bar dataKey="value" name={cost ? 'USD' : 'Total tokens'} fill="var(--brand)" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}/>
          </BarChart>
        </ResponsiveContainer>
      </div> : <p className="usage-chart-empty">No saved Hermes investigations have reported {cost ? 'cost' : 'total tokens'} yet.</p>}
      <p className="iw-caption">{known} of {comparison.length} investigations reported {cost ? 'cost' : 'total tokens'}. Oldest to newest, including failed and cancelled runs. Local validation is excluded; missing values are not zero.</p>
    </div>
    <details className="iw-details"><summary>Chart data</summary>
      {!local && <><h4>Selected run readings</h4><ol className="usage-data-list">{samples.map((sample, index) => <li key={index}><span>{sample.at}{sample.revised ? ' · revised downward' : ''}</span><strong>{display(sample.value, cost)}</strong></li>)}</ol>{!samples.length && <p className="iw-caption">No readings reported.</p>}</>}
      <h4>Saved investigations</h4><ol className="usage-data-list">{comparison.map(item => <li key={item.id}><span>{item.label}. {item.id} · {item.status}</span><strong>{display(item.value, cost)}</strong></li>)}</ol>
    </details>
  </section>
}
