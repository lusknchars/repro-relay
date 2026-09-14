import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Copy, FileText, GitBranch, MessageSquare, Mic, Plus, RefreshCw, Search } from 'lucide-react'
import { apiBase, message, request } from '../lib/api'
import type { Case, InvestigationRun } from '../types'
import { runLabels } from '../lib/investigation'
import { Button } from './ui/button'
import { InvestigationEvidence } from './InvestigationEvidence'
import hermesLogo from '../assets/hermes-logo.webp'
import './session-workspace.css'

type WorkSession = { id: string; title: string; project: string; version: number; case_id: string | null; parent_id: string | null; parent_version: number | null; created_at: string; updated_at: string; turns: { id: string; body: string; at: string }[] }
type Summary = Pick<WorkSession, 'id' | 'title' | 'project' | 'version' | 'case_id' | 'parent_id' | 'updated_at'> & { turn_count: number; first_prompt: string; latest_turn: string }
type Listing = { items: Summary[]; total: number; projects: string[] }
type Write = { path: string; body: Record<string, unknown>; kind: 'create' | 'note' }
const mission = 'Improve agent context quality and reduce token cost. Preserve relevant evidence, exclude stale or revoked memory, and compare each candidate with the current context before accepting a change.'
const date = (v: string) => new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const pendingKey = 'relay-local-session-pending'
function storedPending(): Write | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) || 'null')
    if (!value || !value.body || typeof value.body !== 'object' || typeof value.body.request_id !== 'string') return null
    if (value.kind === 'create' && value.path === '/work-sessions') return value
    if (value.kind === 'note' && typeof value.path === 'string' && /^\/work-sessions\/[A-Za-z0-9_-]+\/notes$/.test(value.path)) return value
  } catch { /* A malformed retry record cannot dispatch work. */ }
  return null
}

export function SessionWorkspace({ cases, guest, openWork }: { cases: Case[]; guest: boolean; openWork: (id: string) => void }) {
  return guest ? <section className="sw-guest"><MessageSquare /><h2>Sessions need a local workspace</h2><p>Your guest case workspace remains available. Persistent work sessions and agent controls run in the local application.</p></section> : <LocalSessions cases={cases} openWork={openWork} />
}
function LocalSessions({ cases, openWork }: { cases: Case[]; openWork: (id: string) => void }) {
  const [listing, setListing] = useState<Listing>({ items: [], total: 0, projects: [] })
  const [query, setQuery] = useState(''); const [project, setProject] = useState(''); const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('session') || '')
  const [detail, setDetail] = useState<WorkSession | null>(null)
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState(''); const [listError, setListError] = useState(''); const [notice, setNotice] = useState('')
  const [generation, setGeneration] = useState(0); const [expanded, setExpanded] = useState('')
  const [creating, setCreating] = useState(false); const [parent, setParent] = useState<WorkSession | null>(null)
  const [title, setTitle] = useState(''); const [newProject, setNewProject] = useState('Repro Relay'); const [prompt, setPrompt] = useState(''); const [caseId, setCaseId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Write | null>(storedPending); const [busy, setBusy] = useState(false)
  const [mobilePane, setMobilePane] = useState<'history' | 'conversation' | 'work'>('history')
  const conversationHeading = useRef<HTMLHeadingElement>(null); const titleInput = useRef<HTMLInputElement>(null)
  const writing = useRef(false); const detailGeneration = useRef(0)
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setListError('')
    const timer = setTimeout(() => {
      request<Listing>(`/work-sessions?q=${encodeURIComponent(query)}&project=${encodeURIComponent(project)}&offset=${offset}`, { signal: c.signal })
        .then(v => { if (!c.signal.aborted) { setListing(v); if (offset > 0 && !v.items.length) setOffset(0) } })
        .catch(e => { if (!c.signal.aborted) setListError(message(e)) })
        .finally(() => { if (!c.signal.aborted) setLoading(false) })
    }, 180)
    return () => { c.abort(); clearTimeout(timer) }
  }, [query, project, offset, generation])
  useEffect(() => {
    const url = new URL(location.href)
    if (selected) url.searchParams.set('session', selected); else url.searchParams.delete('session')
    history.replaceState(null, '', url)
    if (!selected) return
    const c = new AbortController(); const epoch = ++detailGeneration.current
    setDetail(null); setDetailLoading(true)
    request<WorkSession>(`/work-sessions/${encodeURIComponent(selected)}`, { signal: c.signal })
      .then(v => { if (!c.signal.aborted && epoch === detailGeneration.current) setDetail(v) })
      .catch(e => { if (!c.signal.aborted) setError(message(e)) })
      .finally(() => { if (!c.signal.aborted) setDetailLoading(false) })
    return () => c.abort()
  }, [selected, generation])
  useEffect(() => { if (creating) titleInput.current?.focus() }, [creating])
  function resume(id: string) { setSelected(id); setCreating(false); setMobilePane('conversation'); setError(''); setNotice(''); setTimeout(() => conversationHeading.current?.focus(), 0) }
  function newSession(source: WorkSession | null = null) {
    if (busy || pending) return
    setParent(source); setTitle(source ? `${source.title.slice(0,145)} · continued` : ''); setNewProject(source?.project || 'Repro Relay'); setPrompt(''); setCaseId(source?.case_id || ''); setCreating(true); setMobilePane('conversation'); setError(''); setNotice('')
  }
  async function write(action: Write) {
    if (writing.current) return
    writing.current = true; setBusy(true); setError(''); setNotice(''); setPending(action)
    try { sessionStorage.setItem(pendingKey, JSON.stringify(action)) } catch { /* In-memory retry remains available. */ }
    try {
      const response = await fetch(`${apiBase}${action.path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.body) })
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}))
        if (response.status >= 400 && response.status < 500) {
          setPending(null); sessionStorage.removeItem(pendingKey)
          if (response.status === 409) setGeneration(v => v + 1)
        }
        throw new Error(problem.detail || 'The session could not be saved. Retry the same request.')
      }
      const saved: WorkSession = await response.json()
      setPending(null); sessionStorage.removeItem(pendingKey); ++detailGeneration.current
      if (action.kind === 'note') setDrafts(d => ({ ...d, [saved.id]: '' }))
      setSelected(saved.id); setDetail(saved); setCreating(false); setMobilePane('conversation'); setGeneration(v => v + 1)
      setNotice(action.kind === 'create' ? 'Session created. Its prompt is saved; no agent was started.' : 'Note saved. It has not been sent to an agent.')
    } catch (e) { setError(message(e)) } finally { writing.current = false; setBusy(false) }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.') } catch { setError('Clipboard access is unavailable. Select the text to copy it.') } }
  function exportLog(s: WorkSession) {
    const text = [`# ${s.title}`, `Project: ${s.project}`, 'Saved local notes. No agent execution is implied.', s.parent_id ? `Continues ${s.parent_id} at revision ${s.parent_version}. Earlier history remains in that session.` : '', ...s.turns.map(t => `## You · ${t.at}\n\n${t.body}`)].join('\n\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); const link = document.createElement('a'); link.href = url; link.download = `${s.id}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Session log downloaded.')
  }
  return <section className="session-workspace" aria-label="Agent session workspace" data-pane={mobilePane}>
    <nav className="sw-mobile-nav" aria-label="Session panels">{(['history', 'conversation', 'work'] as const).map(p => <Button key={p} variant={mobilePane === p ? 'secondary' : 'ghost'} aria-pressed={mobilePane === p} onClick={() => setMobilePane(p)}>{p === 'history' ? 'History' : p === 'conversation' ? 'Conversation' : 'Agent work'}</Button>)}</nav>
    <aside className="sw-history" aria-label="Agent session history">
      <header><div><h2>Agent session history</h2><p>{listing.total} saved · Local workspace</p></div><Button variant="ghost" size="icon" aria-label="Refresh sessions" onClick={() => setGeneration(v => v + 1)}><RefreshCw /></Button></header>
      <div className="sw-filters"><label className="sw-search"><Search aria-hidden="true" /><input aria-label="Search sessions" placeholder="Search sessions…" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setOffset(0) }} /></label><label><span className="sw-sr">Session project</span><select aria-label="Session project" value={project} onChange={e => { setProject(e.target.value); setOffset(0) }}><option value="">All projects</option>{listing.projects.map(p => <option key={p}>{p}</option>)}</select></label><Button variant="outline" disabled={busy || !!pending} onClick={() => newSession()}><Plus />New session</Button></div>
      {listError && <p className="sw-error" role="alert">{listError}</p>}
      <div className="sw-history-list" aria-busy={loading}>
        {loading && <p className="sw-muted">Loading session history…</p>}
        {!loading && !listing.items.length && <div className="sw-list-empty"><MessageSquare /><p>{query || project ? 'No sessions match these filters.' : 'Your work starts here.'}</p><small>{query || project ? 'Try another search or project.' : 'Save an objective, return to its conversation, and keep the work attached.'}</small></div>}
        {listing.items.map(s => <article key={s.id} className={`sw-history-item ${selected === s.id && !creating ? 'sw-selected' : ''}`}>
          <div className="sw-row"><button className="sw-session-title" aria-current={selected === s.id ? 'true' : undefined} onClick={() => resume(s.id)}>{s.title}</button><Button size="icon" variant="ghost" aria-label={`Preview ${s.title}`} aria-expanded={expanded === s.id} onClick={() => setExpanded(expanded === s.id ? '' : s.id)}><ChevronDown className={expanded === s.id ? 'sw-rotated' : ''} /></Button></div>
          <p className="sw-snippet">You: {s.latest_turn}</p><div className="sw-session-meta"><MessageSquare /><span>{s.turn_count} {s.turn_count === 1 ? 'note' : 'notes'}</span><span>· {date(s.updated_at)}</span></div><div className="sw-tags"><span><GitBranch />{s.project}</span><span>Saved notes</span></div>
          {expanded === s.id && <div className="sw-preview"><Button variant="secondary" onClick={() => resume(s.id)}>Resume session<ArrowRight /></Button><span className="sw-eyebrow">First prompt · preview</span><p>{s.first_prompt}</p><Button variant="ghost" size="sm" onClick={() => void copy(s.first_prompt)}><Copy />Copy preview</Button><span className="sw-eyebrow">Latest turn · you</span><p>{s.latest_turn}</p></div>}
        </article>)}
      </div>
      <footer><span>{listing.total ? `${offset + 1}–${Math.min(offset + 40, listing.total)} of ${listing.total}` : '0 sessions'}</span><Button size="icon" variant="ghost" aria-label="Previous sessions" disabled={offset === 0 || loading} onClick={() => setOffset(v => Math.max(0, v - 40))}><ArrowLeft /></Button><Button size="icon" variant="ghost" aria-label="Next sessions" disabled={offset + 40 >= listing.total || loading} onClick={() => setOffset(v => v + 40)}><ArrowRight /></Button></footer>
    </aside>
    <section className="sw-conversation" aria-label="Session conversation">
      <header className="sw-conversation-heading"><div><span className="sw-eyebrow">{creating ? 'NEW SESSION' : detail?.project || 'CONTINUOUS IMPROVEMENT'}</span><h2 ref={conversationHeading} tabIndex={-1}>{creating ? 'Give the work a direction' : detail?.title || 'A place for continuing work'}</h2></div><span className="sw-status"><span />{detail?.case_id ? 'Case linked' : 'Local notes'}</span></header>
      {error && <p className="sw-error" role="alert">{error}</p>}
      {notice && <p className="sw-notice" role="status">{notice}</p>}
      {pending && !busy && <div className="sw-callout"><strong>A save has an unconfirmed outcome.</strong><p>Retry the original request to recover it without adding the note twice.</p><Button variant="outline" onClick={() => void write(pending)}>Retry session save</Button></div>}
      {creating ? <form className="sw-create" onSubmit={e => { e.preventDefault(); if (!busy && !pending) void write({ path: '/work-sessions', kind: 'create', body: { request_id: crypto.randomUUID(), title, project: newProject, prompt, case_id: caseId || null, parent_id: parent?.id || null, parent_version: parent?.version || null } }) }}>
        {parent && <p className="sw-callout">Continuing {parent.title}. Its original history stays in the parent session; it will not be sent to an agent automatically.</p>}
        <label>Session title<input ref={titleInput} required maxLength={160} value={title} disabled={busy || !!pending} onChange={e => setTitle(e.target.value)} placeholder="What are we working toward?" /></label>
        <label>Project<input required maxLength={160} value={newProject} disabled={!!parent || busy || !!pending} onChange={e => { setNewProject(e.target.value); setCaseId('') }} /></label>
        <label>First prompt<textarea required rows={6} maxLength={8000} value={prompt} disabled={busy || !!pending} onChange={e => setPrompt(e.target.value)} placeholder="Describe the outcome and what must remain true." /></label>
        {!parent && <Button type="button" variant="outline" disabled={busy || !!pending} onClick={() => { setTitle('Improve context quality and token cost'); setPrompt(mission) }}><BookOpen />Use our context improvement mission</Button>}
        <label>Related case, optional<select value={caseId} disabled={busy || !!pending} onChange={e => setCaseId(e.target.value)}><option value="">Independent session</option>{cases.filter(c => c.project === newProject.trim()).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <p className="sw-muted">Create a saved session without starting a model, changing code, or spending tokens.</p><div className="sw-actions"><Button type="submit" pending={busy} disabled={busy || !!pending || !title.trim() || !newProject.trim() || !prompt.trim()}><Plus />Create session</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>Cancel</Button></div>
      </form> : detailLoading ? <p className="sw-muted" role="status">Loading the conversation…</p> : detail ? <>
        <div className="sw-session-actions">{detail.parent_id && <Button variant="ghost" size="sm" onClick={() => resume(detail.parent_id!)}><GitBranch />Open parent session</Button>}<Button variant="ghost" size="sm" disabled={busy || !!pending} onClick={() => newSession(detail)}><Plus />Continue in new session</Button><Button variant="ghost" size="sm" onClick={() => exportLog(detail)}><FileText />Download log</Button></div>
        <div className="sw-turns" aria-label="Saved conversation">{detail.turns.map((t, i) => <article className="sw-turn" key={t.id}><div className="sw-turn-avatar">You</div><div className="sw-turn-body"><div className="sw-row"><strong>{i === 0 ? 'Your first prompt' : 'Your direction'}</strong><time dateTime={t.at}>{date(t.at)}</time></div><p>{t.body}</p><small>Saved locally · Not sent to an agent</small></div></article>)}</div>
        <form className="sw-composer" onSubmit={e => { e.preventDefault(); const body = drafts[detail.id]?.trim(); if (body && !pending && !busy) void write({ kind: 'note', path: `/work-sessions/${detail.id}/notes`, body: { request_id: crypto.randomUUID(), version: detail.version, body } }) }}><label htmlFor="session-note">Add direction to this session</label><textarea id="session-note" rows={3} maxLength={8000} disabled={busy || !!pending} value={drafts[detail.id] || ''} onChange={e => setDrafts(d => ({ ...d, [detail.id]: e.target.value }))} placeholder="What should change, or what should the agent preserve?" /><div className="sw-composer-footer"><span><Mic aria-hidden="true" />Voice is not connected</span><Button type="submit" pending={busy} disabled={busy || !!pending || !drafts[detail.id]?.trim()}><Check />Save note</Button></div><p>A conversation adapter is needed to send directions to Hermes. These notes remain available here.</p></form>
      </> : <div className="sw-welcome"><div className="sw-welcome-icon"><MessageSquare /></div><span className="sw-eyebrow">CONTEXT QUALITY · TOKEN COST</span><h3>Keep the conversation.<br />See what the work proves.</h3><p>Start with an outcome. Keep its prompts and decisions together, with recorded work beside the conversation.</p><Button disabled={busy || !!pending} onClick={() => newSession()}><Plus />Start a session</Button><p className="sw-muted">Sessions are saved in your local workspace. Continuous execution is not connected yet.</p></div>}
    </section>
    <SessionWork key={detail?.id || 'empty'} session={!creating ? detail : null} openWork={openWork} />
  </section>
}
function SessionWork({ session, openWork }: { session: WorkSession | null; openWork: (id: string) => void }) {
  const [runs, setRuns] = useState<InvestigationRun[]>([]); const [runId, setRunId] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const [runner, setRunner] = useState<{ available: boolean; reason: string } | null>(null)
  const [checking, setChecking] = useState(false)
  async function check() { setChecking(true); try { setRunner(await request('/runner')) } catch (e) { setRunner({ available: false, reason: message(e) }) } finally { setChecking(false) } }
  useEffect(() => {
    const c = new AbortController(); let timer: ReturnType<typeof setTimeout>
    request<{ available: boolean; reason: string }>('/runner', { signal: c.signal }).then(v => { if (!c.signal.aborted) setRunner(v) }).catch(() => { if (!c.signal.aborted) setRunner({ available: false, reason: 'Connection check failed. Try again.' }) })
    async function poll() {
      if (!session?.case_id) return
      setLoading(true)
      try { const v = await request<InvestigationRun[]>(`/cases/${session.case_id}/runs`, { signal: c.signal }); if (!c.signal.aborted) { setRuns(v); setError('') } } catch (e) { if (!c.signal.aborted) setError(message(e)) } finally { if (!c.signal.aborted) { setLoading(false); timer = setTimeout(poll, 5000) } }
    }
    void poll(); return () => { c.abort(); clearTimeout(timer) }
  }, [session?.case_id])
  const current = runs.find(r => r.id === runId) || runs[0]
  const local = current?.execution_kind === 'local_validation'
  const context = current?.context
  return <aside className="sw-work" aria-label="Agent work"><header><span className="sw-eyebrow">WORK ALONGSIDE THE CONVERSATION</span><h2>Agent work</h2></header>
    <div className="sw-runtime"><img src={hermesLogo} alt="" width={36} height={36} /><div><strong>Hermes</strong><p>{runner ? runner.available ? 'Investigation runtime available' : 'Runtime not connected' : 'Checking connection…'}</p></div></div><p className="sw-muted">{runner?.reason}</p><Button variant="outline" pending={checking} disabled={checking} onClick={() => void check()}><RefreshCw />Check runtime</Button>
    <div className="sw-work-section"><h3>Context quality and cost</h3><p>Keep required evidence. Measure what a smaller context changes.</p><dl><div><dt>Quality comparison</dt><dd>Not evaluated</dd></div><div><dt>Token savings</dt><dd>Not measured</dd></div></dl><small>These are evaluation goals. No improvement is claimed.</small></div>
    {session?.case_id ? <div className="sw-work-section"><h3>Linked case work</h3><p>Recorded case runs are shown here. Session notes have not been added to their context.</p><Button variant="outline" onClick={() => openWork(session.case_id!)}>Open agent controls<ArrowRight /></Button>{error && <p className="sw-error" role="alert">{error}</p>}{!current && <p className="sw-muted">{loading ? 'Loading recorded work…' : 'No runs recorded for this case.'}</p>}{current && <><label>Recorded run<select aria-label="Session recorded run" value={current.id} onChange={e => setRunId(e.target.value)}>{runs.map(r => <option key={r.id} value={r.id}>{date(r.created_at)} · {runLabels[r.status] || r.status}</option>)}</select></label><span className="sw-status">{local ? 'Local validation record' : 'Agent proposal'} · {runLabels[current.status] || current.status}</span><p>{current.detail}</p>{current.context_stale && <p className="sw-error">This run's context is stale.</p>}<dl><div><dt>Reported tokens</dt><dd>{current.usage?.total_tokens?.toLocaleString() ?? 'Not reported'}</dd></div><div><dt>Reported cost</dt><dd>{current.usage?.cost_usd == null ? 'Not reported' : `$${current.usage.cost_usd}`}</dd></div></dl><details><summary>Recorded result</summary><pre>{current.output || 'No result returned.'}</pre></details><details><summary>Context used by this run</summary><pre>{JSON.stringify(context, null, 2)}</pre></details><details><summary>Recorded progress</summary>{current.events.map(e => <p key={e.sequence}>{e.detail}</p>)}</details><InvestigationEvidence key={current.id} runId={current.id} runVersion={current.version} localValidation={local} /></>}</div> : <div className="sw-work-empty"><BookOpen /><h3>No experiment recorded</h3><p>This session can hold your objective and notes. Reference capture, context comparisons, and autonomous experiments still need a connected workflow.</p></div>}
    <p className="sw-footnote">Leaving this view does not stop an existing case run. Use Agent controls to request a stop.</p>
  </aside>
}
