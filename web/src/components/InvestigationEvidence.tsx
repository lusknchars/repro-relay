import { useEffect, useRef, useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { apiBase, message } from '../lib/api'
import { Button } from './ui/button'
import { reportedTests, testStatuses, testStatusLabels, type TestStatus } from '../lib/test-triage'
import './investigation-evidence.css'

type Environment = { name: string; browser: string; browser_version: string; os: string; os_version: string; device: string; emulated: boolean; capture_mode: string }
type EvidenceRecord = {
  id: string; sequence: number; received_at: string; captured_at?: string;
  summary?: string; event_type?: string; producer?: string; producer_sequence?: number;
  name?: string; media_type?: string; size_bytes?: number; sha256?: string; available?: boolean; content?: string;
  kind?: string; statement?: string; build?: string; verification?: string; sources_available?: boolean;
  artifact_ids?: string[]; event_ids?: string[]; superseded_by?: string | null; environment?: Environment;
  latest_review?: { decision: string; feedback: string; reviewer: string; received_at: string } | null;
  source_stale_on_arrival?: boolean; late?: boolean; data?: unknown;
}
type Page = { items: EvidenceRecord[]; next_cursor: number | null }
type Section = 'journal' | 'artifacts' | 'findings'
type PageState = Page & { loading: boolean; unavailable: boolean; error: string }
const initial = (): PageState => ({ items: [], next_cursor: null, loading: false, unavailable: false, error: '' })
const titles: Record<Section, string> = { journal: 'Evidence journal', artifacts: 'Stored test logs and artifacts', findings: 'Evidence-backed findings' }
const captureLabels: Record<string, string> = { fixture: 'Protocol fixture', runtime_reported: 'Runtime reported', human_recorded: 'Human recorded', local_validation: 'Local validation' }
const time = (value?: string) => value ? new Date(value).toLocaleString() : 'Not recorded'
async function readEvidence<T>(path: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(`${apiBase}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Evidence could not be loaded. Retry when the API is available.')
  }
  return response.json()
}
function EnvironmentDetails({ value }: { value?: Environment }) {
  if (!value) return null
  const known = (part: string) => !['not run', 'not measured', 'unknown', ''].includes(part.trim().toLowerCase())
  const parts = [captureLabels[value.capture_mode] || value.capture_mode, value.name,
    [value.os, value.os_version].filter(known).join(' '),
    [value.browser, value.browser_version].filter(known).join(' '),
    known(value.device) ? value.device : '', value.emulated ? 'Emulated' : '']
  return <p className="iw-caption">{parts.filter(Boolean).join(' · ')}</p>
}

export function InvestigationEvidence({ runId, runVersion, checkedAt, localValidation }: { runId: string; runVersion: number; checkedAt?: string; localValidation: boolean }) {
  const [pages, setPages] = useState<Record<Section, PageState>>({ journal: initial(), artifacts: initial(), findings: initial() })
  const [generation, setGeneration] = useState(0)
  const [testFilter, setTestFilter] = useState<TestStatus | 'all' | 'attention'>('attention')
  const [opened, setOpened] = useState<EvidenceRecord | null>(null)
  const [opening, setOpening] = useState('')
  const [artifactError, setArtifactError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const requests = useRef(new Set<Section>())
  const artifactRequest = useRef(0)
  const inspector = useRef<HTMLElement | null>(null)
  const artifactTrigger = useRef<HTMLElement | null>(null)
  const selectedRun = useRef(runId)
  const tests = reportedTests(pages.journal.items)
  const visibleTests = tests.filter(test => testFilter === 'all' || (testFilter === 'attention' ? test.status !== 'passed' : test.status === testFilter))

  async function load(section: Section, after: number | null, signal: AbortSignal) {
    if (requests.current.has(section)) return
    requests.current.add(section)
    setPages(old => ({ ...old, [section]: { ...old[section], loading: true, error: '' } }))
    try {
      let page = await readEvidence<Page>(`/runs/${encodeURIComponent(runId)}/${section}?limit=${section === 'journal' ? 100 : 20}${after == null ? '' : `&after=${after}`}`, signal)
      // Reload the extent the user already opened, so heartbeats do not collapse
      // test coverage back to the first page. Each request stays API-bounded.
      const previousCount = selectedRun.current === runId ? pages[section].items.length : 0
      while (after == null && page?.next_cursor != null && page.items.length < previousCount && !signal.aborted) {
        const next = await readEvidence<Page>(`/runs/${encodeURIComponent(runId)}/${section}?limit=100&after=${page.next_cursor}`, signal)
        if (!next) break
        page = { items: [...page.items, ...next.items], next_cursor: next.next_cursor }
      }
      if (signal.aborted) return
      setPages(old => ({ ...old, [section]: {
        items: after == null ? page?.items || [] : [...old[section].items, ...(page?.items || []).filter(item => !old[section].items.some(existing => existing.id === item.id))],
        next_cursor: page?.next_cursor ?? null, loading: false, unavailable: page == null, error: '',
      } }))
    } catch (reason) {
      if (!signal.aborted) setPages(old => ({ ...old, [section]: { ...old[section], loading: false, error: message(reason) } }))
    } finally { if (!signal.aborted) requests.current.delete(section) }
  }
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort; requests.current = new Set()
    const changedRun = selectedRun.current !== runId
    if (changedRun) {
      setOpened(null); setTestFilter('attention'); selectedRun.current = runId
    }
    setOpening(''); setArtifactError(''); artifactRequest.current++
    // Keep an inspected log open across coordinator heartbeats, but refresh its
    // availability so revoked contents are not retained on screen.
    if (!changedRun && opened) {
      const requestId = artifactRequest.current
      void readEvidence<EvidenceRecord>(`/artifacts/${encodeURIComponent(opened.id)}`, abort.signal).then(artifact => {
        if (!abort.signal.aborted && requestId === artifactRequest.current) setOpened(artifact ?? { ...opened, available: false, content: undefined })
      }).catch(() => {
        if (!abort.signal.aborted && requestId === artifactRequest.current) setOpened({ ...opened, available: false, content: undefined })
      })
    }
    if (changedRun) setPages({ journal: initial(), artifacts: initial(), findings: initial() })
    for (const section of ['findings', 'journal', 'artifacts'] as const) void load(section, null, abort.signal)
    return () => { abort.abort(); artifactRequest.current++ }
    // Same-state polls update checkedAt without changing the run version.
    // Refresh their new receipts too; discard requests on selection change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, runVersion, checkedAt, generation])

  useEffect(() => { if (opened) inspector.current?.focus() }, [opened?.id])

  async function openArtifact(id: string) {
    const signal = controller.current?.signal
    if (!signal) return
    artifactTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const requestId = ++artifactRequest.current
    setOpening(id); setArtifactError(''); setOpened(null)
    try {
      const artifact = await readEvidence<EvidenceRecord>(`/artifacts/${encodeURIComponent(id)}`, signal)
      if (signal.aborted || requestId !== artifactRequest.current) return
      if (artifact == null) setArtifactError('This artifact is unavailable in the current workspace.')
      else setOpened(artifact)
    } catch (reason) { if (!signal.aborted && requestId === artifactRequest.current) setArtifactError(message(reason)) }
    finally { if (!signal.aborted && requestId === artifactRequest.current) setOpening('') }
  }
  function artifacts(ids?: string[]) {
    return ids?.length ? <div className="ie-artifact-links">{ids.map(id => <Button key={id} size="sm" variant="outline" pending={opening === id} onClick={() => void openArtifact(id)}><FileText />{pages.artifacts.items.find(item => item.id === id)?.name || `Open artifact ${id}`}</Button>)}</div> : null
  }
  return <section className="iw-evidence" aria-label="Investigation evidence">
    <div className="iw-section-heading"><h3>Recorded work and evidence</h3><Button variant="ghost" size="sm" onClick={() => setGeneration(value => value + 1)}><RefreshCw />Refresh evidence</Button></div>
    <p className="iw-caption">{localValidation ? 'These records contain locally executed validation and its saved output. They do not establish a live Hermes or provider integration.' : 'Source records are separate from the agent’s narrative. An accepted review is not independent verification of a fix.'}</p>
    <section className="ie-triage iw-details" aria-label="Test triage">
      <h3>Test triage</h3>
      <p className="iw-caption">Recorded test outcomes for this investigation. A reported start is not a live heartbeat or proof that a test is still running.</p>
      <div className="ie-test-filters" role="group" aria-label="Filter recorded tests">
        <Button size="sm" variant="outline" aria-pressed={testFilter === 'attention'} onClick={() => setTestFilter('attention')}>Needs attention · {tests.filter(test => test.status !== 'passed').length}</Button>
        <Button size="sm" variant="outline" aria-pressed={testFilter === 'all'} onClick={() => setTestFilter('all')}>All · {tests.length}</Button>
        {testStatuses.map(status => <Button key={status} size="sm" variant="outline" aria-pressed={testFilter === status} onClick={() => setTestFilter(status)}>{testStatusLabels[status]} · {tests.filter(test => test.status === status).length}</Button>)}
      </div>
      {pages.journal.next_cursor != null && <p className="iw-warning">Partial history: counts cover loaded records only. Load more journal events below to include more tests and later outcomes.</p>}
      {pages.journal.loading && <p className="iw-caption" role="status">Refreshing recorded tests…</p>}
      {pages.journal.error || pages.journal.unavailable ? <p className="iw-warning">Test history could not be checked. Use the evidence journal retry below when available.</p> : !pages.journal.loading && !tests.length ? <p className="iw-caption">No structured test results have been reported. Logs and the agent’s summary remain available below; they do not establish a passed test. Accessibility and Windows/Edge checks are unreported until their own receipts arrive.</p> : !pages.journal.loading && !visibleTests.length ? <p className="iw-caption">{testFilter === 'attention' ? 'No loaded tests need attention. Passed results remain available under Passed or All.' : 'No loaded tests match this filter.'}</p> : null}
      {visibleTests.map(test => <article key={JSON.stringify([test.event.producer, test.testId])} className="ie-test-record">
        <div className="iw-section-heading"><strong>{test.name}</strong><span className="iw-tag">{testStatusLabels[test.status]}</span></div>
        {test.detail && <p>{test.detail}</p>}
        <EnvironmentDetails value={test.event.environment} />
        <p className="iw-caption">{test.event.producer} · Captured {time(test.event.captured_at)} · Received {time(test.event.received_at)}</p>
        {test.event.source_stale_on_arrival && <p className="iw-warning">Source context had changed when this result arrived.</p>}
        <Button size="sm" variant="outline" onClick={() => {
          const source = document.getElementById(`evidence-${test.event.id}`)
          const details = source?.closest('details'); if (details) details.open = true
          source?.focus(); source?.scrollIntoView({ block: 'start', behavior: 'instant' })
        }}>Inspect source event</Button>
        {artifacts(test.event.artifact_ids)}
      </article>)}
    </section>
    {(['findings', 'journal', 'artifacts'] as const).map(section => {
      const page = pages[section]
      return <details key={section} className="iw-details" open><summary>{titles[section]} <span>{page.items.length}{page.next_cursor == null ? '' : '+'}</span></summary>
        {page.loading && !page.items.length && <p className="iw-caption" aria-live="polite">Loading {titles[section].toLowerCase()}…</p>}
        {page.unavailable && <p className="iw-caption">This API does not expose {titles[section].toLowerCase()} for the selected run.</p>}
        {page.error && <div className="iw-warning"><p>{page.error}</p><Button size="sm" variant="outline" onClick={() => { const signal = controller.current?.signal; if (signal) void load(section, page.next_cursor, signal) }}>Retry {section}</Button></div>}
        {!page.loading && !page.error && !page.unavailable && !page.items.length && <p className="iw-caption">No {titles[section].toLowerCase()} have been recorded.</p>}
        {page.items.map(item => <article key={item.id} id={`evidence-${item.id}`} tabIndex={-1} className="iw-review-record ie-record">
          {section === 'findings' ? <>
            <div><strong>{item.kind === 'hypothesis' ? 'Hypothesis' : item.kind === 'observed_symptom' ? 'Observed symptom' : item.kind}</strong><span className="iw-tag">{item.superseded_by ? 'Superseded' : item.latest_review?.decision === 'accepted' ? 'Review accepted · not verified' : item.latest_review?.decision === 'rejected' ? 'Review rejected' : 'Awaiting review'}</span></div>
            <p>{item.statement}</p><small>Build {item.build} · {time(item.received_at)}</small>
            {item.sources_available === false && <p className="iw-warning">One or more sources are unavailable or revoked. Do not rely on this finding as current evidence.</p>}
            {item.latest_review && <blockquote><p>{item.latest_review.feedback}</p><small>{item.latest_review.reviewer} · Locally supplied reviewer</small></blockquote>}
            {!!item.event_ids?.length && <details><summary>Source event references ({item.event_ids.length})</summary><ul>{item.event_ids.map(id => <li key={id}>{pages.journal.items.find(event => event.id === id)?.summary || id}</li>)}</ul></details>}
            {artifacts(item.artifact_ids)}
          </> : section === 'journal' ? <>
            <div><strong>{item.event_type?.replaceAll('_', ' ') || 'Evidence event'}</strong><small>#{item.sequence}</small></div><p>{item.summary}</p><EnvironmentDetails value={item.environment} />
            <small>Captured {time(item.captured_at)} · Received {time(item.received_at)}</small>
            {item.source_stale_on_arrival && <p className="iw-warning">The run’s source context had changed when this event arrived.</p>}
            <details><summary>Event provenance and data</summary><p className="iw-caption">Producer {item.producer} · Producer sequence {item.producer_sequence}{item.late ? ' · Received after the run ended' : ''}</p><pre>{JSON.stringify(item.data ?? {}, null, 2)}</pre></details>{artifacts(item.artifact_ids)}
          </> : <>
            <div><strong>{item.name}</strong><span>{item.available === false ? 'Revoked / unavailable' : `${item.size_bytes?.toLocaleString() ?? 'Unknown'} bytes`}</span></div><EnvironmentDetails value={item.environment} />
            <Button size="sm" variant="outline" disabled={item.available === false} pending={opening === item.id} onClick={() => void openArtifact(item.id)}><FileText />Inspect stored log</Button>
          </>}
        </article>)}
        {page.next_cursor != null && <Button variant="outline" pending={page.loading} disabled={page.loading} onClick={() => { const signal = controller.current?.signal; if (signal) void load(section, page.next_cursor, signal) }}>Load more {section}</Button>}
      </details>
    })}
    {opening && <p className="iw-caption" aria-live="polite">Loading stored artifact…</p>}
    {artifactError && <p className="iw-warning" aria-live="polite">{artifactError}</p>}
    {opened && <section className="ie-inspector iw-details" aria-label="Stored artifact contents" tabIndex={-1} ref={inspector}>
      <div className="iw-section-heading"><h3>{opened.name}</h3><Button variant="ghost" size="sm" onClick={() => { artifactRequest.current++; setOpened(null); artifactTrigger.current?.focus() }}>Close log</Button></div>
      <EnvironmentDetails value={opened.environment} /><dl><dt>Stored bytes</dt><dd>{opened.size_bytes?.toLocaleString() ?? 'Unknown'}</dd><dt>Media type</dt><dd>{opened.media_type}</dd><dt>SHA-256</dt><dd className="ie-digest">{opened.sha256}</dd><dt>Captured</dt><dd>{time(opened.captured_at)}</dd></dl>
      {opened.available === false || opened.content == null ? <p className="iw-warning">Artifact content is unavailable or has been revoked.</p> : <pre tabIndex={0} aria-label="Artifact text">{opened.content}</pre>}
    </section>}
  </section>
}
