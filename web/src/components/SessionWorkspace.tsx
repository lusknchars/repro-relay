import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, ChevronDown, FileText, GitBranch, Pause, Play, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { message, request } from '../lib/api'
import { Button } from './ui/button'
import { ApprovalButton, type ApprovalState } from './ui/approval-button'
import './session-workspace.css'

type Result = { input_bytes: number; candidate_bytes: number; saved_bytes: number; quality_check: string; scope: string }
type Proposal = { id: string; version: number; state: string; attempts: number; result: Result | null }
type Audit = { id: string; repository: string; revision: string; created_at: string; file_count: number; bytes: number; duplicate_bytes: number; files: { path: string; sha256: string; bytes: number; duplicate: boolean }[]; proposal: Proposal | null }
type Feed = { control: { version: number; paused: boolean; repository: string | null; last_seen: string | null; connected: boolean; latest_scan: string | null }; items: Audit[] }
type Archive = { id: string; title: string; first_prompt: string; latest_turn: string; turn_count: number }
const labels: Record<string, string> = { pending: 'Ready for review', queued: 'Evaluation queued', evaluating: 'Evaluating context pack', accepted: 'Candidate approved', declined: 'Declined', stale: 'Snapshot changed', failed: 'Evaluation interrupted' }
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const size = (n: number) => `${n.toLocaleString()} bytes`
export function SessionWorkspace({ guest }: { guest: boolean | undefined }) {
  if (guest) return <section className="sw-guest"><h2>Autonomous work runs in your local workspace</h2><p>The guest workspace cannot connect a repository harness.</p></section>
  return <AutonomousWork />
}
function AutonomousWork() {
  const [feed, setFeed] = useState<Feed | null>(null)
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('audit') || '')
  const [query, setQuery] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [readError, setReadError] = useState('')
  const [approval, setApproval] = useState<{ id: string; state: ApprovalState } | null>(null)
  const [busy, setBusy] = useState(false); const [generation, setGeneration] = useState(0)
  const [pane, setPane] = useState<'history' | 'review' | 'monitor'>('review')
  const [archive, setArchive] = useState<Archive[] | null>(null); const [archiveOpen, setArchiveOpen] = useState(false)
  const inFlight = useRef(false)
  useEffect(() => {
    const c = new AbortController(); let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try { const value = await request<Feed>('/autonomy', { signal: c.signal }); if (!c.signal.aborted) { setFeed(value); setReadError('') } }
      catch (e) { if (!c.signal.aborted) setReadError(message(e)) }
      finally { if (!c.signal.aborted) timer = setTimeout(poll, 5000) }
    }
    void poll(); return () => { c.abort(); clearTimeout(timer) }
  }, [generation])
  const current = feed?.items.find(i => i.id === selected) || feed?.items[0]
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.delete('session')
    if (current) url.searchParams.set('audit', current.id); else url.searchParams.delete('audit')
    history.replaceState(null, '', url)
  }, [current?.id])
  async function change(path: string, body: object, success: string) {
    if (inFlight.current) return false
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try { await request(path, { method: 'POST', body: JSON.stringify(body) }); setNotice(success); return true }
    catch (e) { setError(`${message(e)} The current state is being refreshed.`); return false }
    finally { setGeneration(v => v + 1); setBusy(false); inFlight.current = false }
  }
  async function showArchive() {
    setArchiveOpen(v => !v)
    if (!archive) try { const v = await request<{ items: Archive[] }>('/work-sessions'); setArchive(v.items) } catch (e) { setError(message(e)) }
  }
  const status = readError ? 'Connection unavailable' : feed?.control.paused ? 'Monitoring paused' : feed?.control.connected ? 'Watching agent instructions' : 'Harness disconnected'
  const items = feed?.items.filter(i => `${i.repository} ${i.revision} ${i.proposal ? labels[i.proposal.state] : 'audit complete'}`.toLowerCase().includes(query.toLowerCase())) || []
  const pending = feed?.items.filter(i => i.proposal?.state === 'pending').length || 0
  const canDecide = !busy && !readError && !!feed?.control.connected && !feed.control.paused && current?.id === feed.control.latest_scan
  return <section className="session-workspace" data-pane={pane} aria-label="Autonomous work">
    <nav className="sw-mobile-nav" aria-label="Work panels">{(['history', 'review', 'monitor'] as const).map(p => <Button key={p} variant={pane === p ? 'secondary' : 'ghost'} aria-pressed={pane === p} onClick={() => setPane(p)}>{p === 'history' ? 'Activity' : p === 'review' ? 'Review' : 'Monitor'}</Button>)}</nav>
    <aside className="sw-history" aria-label="Automatic work history">
      <header><div><h2>Work history</h2><p>{feed ? `${feed.items.length} recorded · ${pending} to review` : 'Loading work…'}</p></div><Button variant="ghost" size="icon" aria-label="Refresh work" onClick={() => setGeneration(v => v + 1)}><RefreshCw /></Button></header>
      <label className="sw-search"><Search aria-hidden="true" /><input aria-label="Search work" placeholder="Search activity…" maxLength={200} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="sw-history-list">{items.map(i => <button key={i.id} className={`sw-history-item ${current?.id === i.id ? 'sw-selected' : ''}`} aria-current={current?.id === i.id ? 'true' : undefined} onClick={() => { setSelected(i.id); setPane('review'); setNotice('') }}><span className="sw-eyebrow">{i.proposal ? labels[i.proposal.state] : 'AUDIT COMPLETE'}</span><strong>{i.proposal ? 'Duplicate instruction content' : 'Agent context inspected'}</strong><span>{i.file_count} files · {date(i.created_at)}</span><small><GitBranch />{i.revision.slice(0, 8)}</small></button>)}{feed && !items.length && <p className="sw-list-empty">{query ? 'No activity matches this search.' : 'Repository audits will appear here automatically.'}</p>}</div>
      <div className="sw-archive"><Button variant="ghost" onClick={() => void showArchive()} aria-expanded={archiveOpen}><FileText />Earlier notes<ChevronDown /></Button>{archiveOpen && <div>{archive ? archive.length ? archive.map(s => <details key={s.id}><summary>{s.title}</summary><p>{s.first_prompt}</p>{s.turn_count > 1 && <p>{s.latest_turn}</p>}<small>Saved note preview. No work was started by this note.</small></details>) : <p>No earlier notes.</p> : <p>Loading notes…</p>}</div>}</div>
    </aside>
    <section className="sw-review" aria-label="Work review">
      <header className="sw-review-heading"><span className="sw-eyebrow">CONTINUOUS IMPROVEMENT</span><h2>Work starts automatically.<br />You review the evidence.</h2><p>Watching for repeated instructions that may waste context. Discovery runs without a task prompt.</p></header>
      {(error || readError) && <div role="alert" className="sw-error">{error || readError}<Button variant="ghost" onClick={() => { setError(''); setGeneration(v => v + 1) }}>Refresh state</Button></div>}
      {notice && <p role="status" className="sw-notice">{notice}</p>}
      {!feed ? <p role="status">Loading autonomous work…</p> : !current ? <div className="sw-empty"><Activity /><h3>{feed.control.paused ? 'Monitoring is paused' : 'Waiting for the repository harness'}</h3><p>{feed.control.paused ? 'Resume monitoring to collect repository changes automatically.' : 'Once the local harness connects, it will inspect tracked agent instructions and collect evidence here.'}</p><p className="sw-muted">No task title, prompt, or change description is needed.</p></div> : <>
        <div className="sw-audit-heading"><span className="sw-status">{current.proposal ? labels[current.proposal.state] : 'Audit complete'}</span><h3>{current.proposal ? 'Reusable context candidate' : 'No duplicate instruction files found'}</h3><p>{current.proposal ? `${size(current.duplicate_bytes)} repeat across instruction files. The automatic evaluator compares a shared-body representation while retaining every source path.` : `The harness inspected ${current.file_count} tracked instruction files. This check found no repeated whole-file content to consolidate.`}</p></div>
        <div className="sw-stats"><div><span>Inspected</span><strong>{current.file_count} files</strong></div><div><span>Instruction content</span><strong>{size(current.bytes)}</strong></div><div><span>Model calls</span><strong>0</strong></div></div>
        <section className="sw-evidence"><h3>Collected evidence</h3><p className="sw-muted">{current.repository} · {date(current.created_at)}</p><p className="sw-muted">Snapshot includes tracked working-tree content at commit {current.revision.slice(0, 12)}.</p>{current.files.map(f => <details key={f.path}><summary><FileText /><span>{f.path}</span><small>{f.duplicate ? 'Repeated content' : size(f.bytes)}</small></summary><p>Content SHA-256</p><code>{f.sha256}</code><p>{size(f.bytes)} · Source remains unchanged</p></details>)}{!current.files.length && <p>No tracked AGENTS.md, CLAUDE.md, or SKILL.md files were found.</p>}</section>
        {current.proposal?.result && <section className="relay-card sw-result"><h3>Evaluation result</h3><dl><div><dt>Original pack</dt><dd>{size(current.proposal.result.input_bytes)}</dd></div><div><dt>Candidate pack</dt><dd>{size(current.proposal.result.candidate_bytes)}</dd></div><div><dt>Measured storage reduction</dt><dd>{size(current.proposal.result.saved_bytes)}</dd></div><div><dt>LLM token savings</dt><dd>Not measured</dd></div></dl><p><ShieldCheck />{current.proposal.result.quality_check}</p><small>{current.proposal.result.scope}</small></section>}
        {current.proposal && ['pending', 'accepted'].includes(current.proposal.state) && <section className="relay-card sw-decision"><h3>{current.proposal.state === 'accepted' ? 'Candidate approved' : 'Keep this evaluated candidate?'}</h3><p>{current.proposal.state === 'accepted' ? 'This exact evaluated candidate is available for context retrieval while its snapshot remains current. No agent consumes it yet.' : 'The automatic check is complete. Approve to make this exact candidate available to a connected context adapter, or decline to retain only its history. No agent consumes it yet.'}</p><div className="sw-actions"><ApprovalButton label="Approve candidate" successLabel="Candidate approved" state={current.proposal.state === 'accepted' ? 'success' : approval?.id === current.id ? approval.state : 'neutral'} disabled={!canDecide} onClick={async () => { const id = current.id; setApproval({ id, state: 'loading' }); const ok = await change(`/autonomy/proposals/${current.proposal!.id}/decision`, { version: current.proposal!.version, decision: 'approve' }, 'Candidate approved for context retrieval. The repository is unchanged.'); setApproval({ id, state: ok ? 'success' : 'error' }) }} /><Button variant="outline" disabled={!canDecide || current.proposal.state === 'accepted' || (approval?.id === current.id && approval.state === 'success')} onClick={() => void change(`/autonomy/proposals/${current.proposal!.id}/decision`, { version: current.proposal!.version, decision: 'decline' }, 'Candidate declined. Its evaluation history is retained.')}><X />Decline</Button></div>{!canDecide && !busy && <small>Decisions require the current snapshot and a connected, unpaused harness.</small>}</section>}
        {current.proposal && ['queued','evaluating','declined','stale','failed'].includes(current.proposal.state) && <div className="relay-card sw-callout"><strong>{labels[current.proposal.state]}</strong><p>{({ queued: 'The harness will evaluate this candidate automatically on its next cycle.', accepted: 'The evaluated candidate is available for context retrieval while its snapshot remains current. No agent adapter consumes it yet.', evaluating: 'A worker holds a bounded evaluation lease. Its result will appear here automatically.', declined: 'This candidate will not be offered to a context adapter. Your decision and its evaluation are retained.', stale: 'The repository snapshot changed. Review the newest audit before approving work.', failed: 'The worker exhausted its recovery attempts. Inspect the harness connection before continuing.' })[current.proposal.state]}</p></div>}
      </>}
    </section>
    <aside className="sw-monitor" aria-label="Repository monitor"><header><Activity /><h2>Repository monitor</h2><span className="sw-status">{feed ? status : 'Checking connection…'}</span></header><section><h3>Context quality and cost</h3><p>Inspect tracked instructions when their content or Git revision changes. Keep the evidence and decisions across restarts.</p><dl><div><dt>Discovery</dt><dd>Automatic</dd></div><div><dt>Evaluation</dt><dd>Automatic, read-only</dd></div><div><dt>Source changes</dt><dd>Disabled</dd></div><div><dt>Paid model calls</dt><dd>Disabled</dd></div></dl></section>{feed && <Button variant="outline" disabled={busy} onClick={() => void change('/autonomy/control', { version: feed.control.version, paused: !feed.control.paused }, feed.control.paused ? 'Monitoring resumed.' : 'Monitoring paused. In-flight evaluations can no longer publish.')}>
      {feed.control.paused ? <Play /> : <Pause />}{feed.control.paused ? 'Resume monitoring' : 'Pause monitoring'}</Button>}{feed?.control.last_seen && <p className="sw-muted">Last harness check {date(feed.control.last_seen)}</p>}<section><h3>Connected harness</h3><p>Local context harness · v1</p><p className="sw-muted">Tracked AGENTS.md, CLAUDE.md and SKILL.md files. Audits and evaluations run every 15 seconds while the harness is connected.</p></section><section><h3>Execution boundary</h3><p className="sw-muted">This harness performs read-only context checks. Hermes code changes, task-specific context selection, and model quality comparisons need a separate execution adapter.</p></section><p className="sw-footnote"><ArrowRight />Leave this view open or come back later. Monitoring runs outside the browser.</p></aside>
  </section>
}
