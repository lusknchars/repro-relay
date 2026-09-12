import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowRight, BookOpen, Braces, Check, ChevronRight,
  CircleDot, Database, FileText, FlaskConical, GitBranch,
  Inbox, Link2, Plus, Radio, Search, Settings2, ShieldCheck, X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { ContextPanel } from './components/ContextPanel'
import { Badge } from './components/ui/badge'
import { apiBase, message, request, requestAll } from './lib/api'
import type { Case, CaseStatus, Health, Memory, Result } from './types'

const labels: Record<CaseStatus, string> = {
  new: 'New report', reproduced: 'Reproduced', not_reproduced: 'Not reproduced',
  blocked: 'Blocked', needs_context: 'Needs context',
}
const time = (value: string) => new Date(value).toLocaleString(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
})
function Status({ value }: { value: CaseStatus }) {
  return <Badge variant="outline" className={`status ${value}`}><CircleDot size={12} />{labels[value]}</Badge>
}
function Modal({ title, close, children }: {title: string; close: () => void; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close() }, [])
  return <dialog ref={ref} onCancel={event => { event.preventDefault(); close() }} aria-labelledby="dialog-title">
    <div className="dialog-header"><h2 id="dialog-title">{title}</h2>
      <Button variant="ghost" size="icon" aria-label="Close dialog" onClick={close}><X /></Button></div>
    {children}
  </dialog>
}
function Field({ label, children, hint }: {label: string; children: ReactNode; hint?: string}) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export default function App() {
  const [cases, setCases] = useState<Case[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [related, setRelated] = useState<Memory[]>([])
  const [view, setView] = useState<'inbox' | 'memory' | 'connections'>('inbox')
  const [tab, setTab] = useState<'evidence' | 'context' | 'handoff' | 'activity'>('evidence')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState<'report' | 'observation' | 'review' | null>(null)
  const [result, setResult] = useState<Result>('reproduced')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [packet, setPacket] = useState('')
  const requestKey = useRef('')
  const selected = cases.find(item => item.id === selectedId)

  async function refresh() {
    const [items, knowledge, status] = await Promise.all([
      requestAll<Case>('/cases'), requestAll<Memory>('/memories'), request<Health>('/health'),
    ])
    setCases(items); setMemories(knowledge); setHealth(status)
    setSelectedId(id => items.some(item => item.id === id) ? id : items[0]?.id || '')
  }
  useEffect(() => {
    refresh().catch(e => setError(message(e))).finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    let current = true
    setRelated([]); setPacket('')
    if (selectedId) {
      request<Memory[]>(`/cases/${selectedId}/related`).then(data => {
        if (current) setRelated(data)
      }).catch(e => { if (current) setError(message(e)) })
      fetch(`${apiBase}/cases/${selectedId}/packet?format=markdown`).then(async response => {
        if (!response.ok) throw new Error('Could not load the repair packet.')
        const text = await response.text()
        if (current) setPacket(text)
      }).catch(e => { if (current) setError(message(e)) })
    }
    return () => { current = false }
  }, [selectedId, selected?.revision, memories])

  function openModal(next: typeof modal) {
    setError(''); setNotice(''); requestKey.current = crypto.randomUUID(); setModal(next)
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { setError(message(e)); await refresh().catch(() => {}) }
    finally { setBusy(false) }
  }
  function createReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    void action(async () => {
      const created = await request<Case>('/cases', {
        method: 'POST', headers: {'Idempotency-Key': requestKey.current}, body: JSON.stringify(values),
      })
      await refresh(); setSelectedId(created.id); setView('inbox'); setQuery(''); setFilter('all')
      setTab('evidence'); setModal(null); setNotice('Report saved. Record an observation to continue.')
    })
  }
  function recordObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    void action(async () => {
      await request(`/cases/${selected.id}/observations`, {
        method: 'POST', body: JSON.stringify({...values, revision: selected.revision}),
      })
      await refresh(); setModal(null); setNotice('Observation saved. Earlier memory for this case is now inactive.')
    })
  }
  function publishMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const reviewer = new FormData(event.currentTarget).get('reviewer')
    void action(async () => {
      await request(`/cases/${selected.id}/memory`, {
        method: 'POST', body: JSON.stringify({reviewer, revision: selected.revision}),
      })
      await refresh(); setModal(null); setNotice('Reviewed observation added to project memory.')
    })
  }
  async function exportPacket() {
    if (!packet || !selected) return
    if ('__TAURI_INTERNALS__' in window) {
      await action(async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        const saved = await invoke<boolean>('save_packet', {content: packet, name: `${selected.id}.md`})
        setNotice(saved ? 'Repair packet exported.' : 'Export canceled.')
      })
      return
    }
    const url = URL.createObjectURL(new Blob([packet], {type: 'text/markdown'}))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `${selected.id}.md`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('Repair packet exported. No external message was sent.')
  }
  function navigate(next: typeof view) { setView(next); setQuery(''); setError(''); setNotice('') }
  const filtered = cases.filter(item =>
    (filter === 'all' || item.status === filter) &&
    `${item.id} ${item.title} ${item.project}`.toLowerCase().includes(query.toLowerCase()),
  )
  const selectedMemory = memories.find(item => item.case_id === selectedId)

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => {e.preventDefault(); navigate('inbox')}}>
        <span className="brand-mark"><GitBranch size={23} /></span><span>repro<span className="brand-light">relay</span></span>
      </a>
      <div className="workspace-switch"><span className="avatar">L</span><div><strong>Local workspace</strong><small>Engineering workspace</small></div></div>
      <nav aria-label="Workspace">
        <button className={view === 'inbox' ? 'active' : ''} onClick={() => navigate('inbox')}><Inbox size={18} />Case inbox<span className="nav-count">{cases.length}</span></button>
        <button className={view === 'memory' ? 'active' : ''} onClick={() => navigate('memory')}><Database size={18} />Project memory<span className="nav-count">{memories.length}</span></button>
        <button className={view === 'connections' ? 'active' : ''} onClick={() => navigate('connections')}><Settings2 size={18} />Connections</button>
      </nav>
      <div className="sidebar-note"><ShieldCheck size={20} /><p>Every finding has a source.</p><small>Keep observations, hypotheses, and verified fixes distinct.</small></div>
      <div className="sidebar-footer"><span className={health ? 'online-dot' : 'offline-dot'} />{health ? 'Local API connected' : 'Connecting to local API'}<span>v0.2</span></div>
    </aside>
    <main id="workspace" className="workspace">
      <header className="topbar"><div className="breadcrumbs">Workspace<ChevronRight size={14} /><strong>{view === 'inbox' ? 'Case inbox' : view === 'memory' ? 'Project memory' : 'Connections'}</strong></div>
        <span className="local-badge"><FlaskConical size={14} />Local workspace</span></header>
      <div className="page-title"><div><h1>{view === 'inbox' ? 'An evidence trail for every handoff.' : view === 'memory' ? 'What your team has learned.' : 'Connect the workflow.'}</h1><p>{view === 'inbox' ? 'Investigate the report, preserve what happened, and prepare the next agent.' : view === 'memory' ? 'Reviewed observations from this workspace, with their original evidence.' : 'The local workflow works now. Agent and channel connections come next.'}</p></div>
        <Button onClick={() => openModal('report')} disabled={!health}><Plus />New report</Button></div>
      {error && <div className="notice error" role="alert">{error}<Button variant="ghost" size="sm" onClick={() => void action(refresh)}>Retry connection</Button></div>}
      {notice && <div className="notice" role="status"><Check size={16} />{notice}</div>}
      {loading ? <div className="loading" role="status">Opening your workspace…</div> : <>
      {view === 'inbox' && <>
        <div className="summary-strip"><span><strong>{cases.filter(item => item.status === 'new').length}</strong> awaiting an observation</span><span><strong>{cases.filter(item => item.status === 'reproduced').length}</strong> reproduced</span><span><strong>{memories.length}</strong> reviewed memories</span><span className="summary-end"><Radio size={14} />Observations are recorded by your team</span></div>
        <div className="case-workspace">
          <section className="inbox-panel" aria-label="Cases">
            <div className="list-tools"><label className="search"><Search size={16}/><input aria-label="Search cases" placeholder="Find a case…" value={query} onChange={e => setQuery(e.target.value)} /></label>
            <select aria-label="Filter cases by status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(labels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="list-label"><span>Reports</span><span>{filtered.length}</span></div>
            {filtered.map(item => <button key={item.id} className={`case-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => {setSelectedId(item.id); setTab('evidence')}} aria-pressed={selectedId === item.id}>
              <div><span className="case-id" title={item.id}>{item.id.slice(0,11)}</span><span className="case-row-project">{item.project}</span></div><h3>{item.title}</h3><div><Status value={item.status} /><small>{new Date(item.updated_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}</small></div>
            </button>)}
            {!filtered.length && <div className="list-empty"><Inbox size={26}/><p>{cases.length ? 'No matching reports.' : 'Your first case starts here.'}</p><small>{cases.length ? 'Try another search or status.' : 'Add a problem your team is working on.'}</small></div>}
          </section>
          {selected ? <section className="case-detail" aria-label="Selected case">
            <div className="detail-heading"><div className="detail-kicker"><span title={selected.id}>{selected.id.slice(0,11)}</span><span>Revision {selected.revision}</span></div><h2>{selected.title}</h2><div className="detail-meta"><Status value={selected.status}/><span>{selected.project}</span><span>{time(selected.created_at)}</span></div></div>
            <div className="detail-tabs" role="tablist" aria-label="Case detail">{(['evidence', 'context', 'handoff', 'activity'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => {setTab(value); setNotice(''); setError('')}}>{value === 'evidence' ? 'Evidence' : value === 'context' ? 'Agent context' : value === 'handoff' ? 'Repair packet' : 'Activity'}{value === 'evidence' && <span>{selected.observations.length}</span>}</button>)}</div>
            <div className="detail-body">
            {tab === 'evidence' && <>
              <div className="description-grid"><div><h3>Reported behavior</h3><p>{selected.description}</p></div><div><h3>Expected behavior</h3><p>{selected.expected}</p></div></div>
              <a className="target-link" href={selected.url} target="_blank" rel="noreferrer"><Link2 size={15}/><span>{selected.url}</span><ArrowRight size={15}/></a>
              <div className="section-label"><h3>Investigation record</h3><Button variant="outline" size="sm" onClick={() => openModal('observation')}><Plus/>Record observation</Button></div>
              {!selected.observations.length && <div className="evidence-empty"><div className="evidence-symbol"><Search size={24}/></div><div><h4>The report is ready to investigate.</h4><p>Record what you observed in the application. Include the build and an evidence link when you reproduce the problem.</p><small>The browser agent is not connected yet.</small></div></div>}
              {[...selected.observations].reverse().map(observation => <article className="observation" key={observation.id}><div className="observation-top"><Status value={observation.result}/><small>{time(observation.at)}</small></div>{observation.build && observation.build !== selected.build && <p className="build-warning">Earlier build. Recheck this evidence against {selected.build}.</p>}<p>{observation.observed}</p>{observation.steps && <details><summary>Reproduction steps</summary><p className="preserve">{observation.steps}</p></details>}<dl><div><dt>Recorded by</dt><dd>{observation.author}</dd></div><div><dt>Build</dt><dd>{observation.build || 'Not supplied'}</dd></div></dl>{observation.evidence_url && <a className="evidence-link" href={observation.evidence_url} target="_blank" rel="noreferrer"><Link2 size={14}/>Open evidence</a>}<small className="attribution">Human-recorded observation. Repro Relay has not independently verified it.</small></article>)}
              <div className="section-label"><h3>Related project memory</h3><span className="subtle">Exact term lookup</span></div>
              {related.length ? related.map(memory => <button className="related-row" key={memory.id} onClick={() => setSelectedId(memory.case_id)}><BookOpen size={16}/><div><strong>{memory.title}</strong><small>{memory.case_id} · Reviewed by {memory.reviewer}</small></div><ChevronRight size={15}/></button>) : <p className="muted-paragraph">No matching reviewed observations yet. Memory grows as your team reviews evidence.</p>}
              {selected.status === 'reproduced' && <div className="memory-prompt"><ShieldCheck size={22}/><div><strong>{selectedMemory ? 'This observation is in project memory.' : 'Useful for the next investigation?'}</strong><p>{selectedMemory ? `Reviewed by ${selectedMemory.reviewer}. New observations invalidate this memory.` : 'Review the evidence before making this observation available to future cases.'}</p></div>{!selectedMemory && <Button variant="outline" size="sm" onClick={() => openModal('review')}>Review for memory</Button>}</div>}
            </>}
            {tab === 'context' && <ContextPanel key={selected.id} item={selected} refresh={refresh}/>}
            {tab === 'handoff' && <><div className="packet-intro"><FileText size={22}/><div><h3>A precise starting point for engineering.</h3><p>This export includes the report, recorded evidence, and related reviewed cases. Unknown repository and commit details stay explicit.</p></div></div><Button onClick={exportPacket} disabled={!packet}><ArrowDownToLine/>Export Markdown</Button><pre className="packet-preview">{packet || 'Loading repair packet…'}</pre></>}
            {tab === 'activity' && <ol className="timeline">{[...selected.events].reverse().map((event,index) => <li key={`${event.at}-${index}`}><span className="timeline-dot"/><div><p>{event.detail}</p><small>{time(event.at)}</small></div></li>)}</ol>}
            </div>
          </section> : <section className="welcome-panel"><div className="flow-illustration"><span><Inbox/></span><i/><span><Search/></span><i/><span><FileText/></span></div><h2>Give a bug somewhere to go.</h2><p>Start with a real report. Add what your team observed, then share a repair packet with the next person.</p><Button onClick={() => openModal('report')} disabled={!health}><Plus/>Create your first report</Button><div className="welcome-note"><ShieldCheck size={16}/>Evidence stays in your local workspace.</div></section>}
        </div>
      </>}
      {view === 'memory' && <section className="memory-view"><div className="memory-heading"><div><h2>Reviewed observations</h2><p>References for investigation. These entries do not establish a root cause or a verified fix.</p></div><label className="search"><Search size={16}/><input aria-label="Search memory" placeholder="Search observations…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
        {memories.filter(memory => `${memory.title} ${memory.observation.observed}`.toLowerCase().includes(query.toLowerCase())).map(memory => <article className="memory-card" key={memory.id}><div className="memory-card-icon"><Database size={21}/></div><div className="memory-copy"><span className="subtle">{memory.project} · {memory.case_id} · Revision {memory.revision}</span><h3>{memory.title}</h3><p>{memory.observation.observed}</p><small>Reviewed by {memory.reviewer} · {time(memory.created_at)}</small></div><div className="memory-actions"><Button variant="outline" size="sm" onClick={() => {setSelectedId(memory.case_id); navigate('inbox'); setTab('evidence')}}>Open case</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(async () => {await request(`/memories/${memory.id}`, {method: 'DELETE'}); await refresh(); setNotice('Memory removed from retrieval. The original case is preserved.')})}>Remove from memory</Button></div></article>)}
        {!memories.length && <div className="large-empty"><Database size={34}/><h3>Start with a reviewed reproduction.</h3><p>Record evidence on a case, then choose “Review for memory.” Its source and revision will stay attached.</p><Button variant="outline" onClick={() => navigate('inbox')}>Go to case inbox</Button></div>}
        {memories.length > 0 && !memories.some(memory => `${memory.title} ${memory.observation.observed}`.toLowerCase().includes(query.toLowerCase())) && <p className="muted-paragraph">No observations match this search.</p>}
      </section>}
      {view === 'connections' && <section className="connections"><div className="connection-intro"><GitBranch size={26}/><div><h2>The foundation is ready for connections.</h2><p>Case storage, context preparation, freshness checks, and exports work locally. The integrations below are the next milestones.</p></div></div>{[
        ['Local workspace', 'Rust API, PostgreSQL history, reviewed memory, and versioned handoffs.', true],
        ['Hermes + Plow Chat', 'Agent intake and browser investigation. Runtime connection is not implemented.', false],
        ['Mem0', 'Semantic retrieval adapter. Exact lookup already works without an API key.', false],
        ['GitHub', 'Reviewed issue creation. Export a Markdown packet manually today.', false],
        ['Slack', 'Case-linked engineering updates. Outbound delivery is not implemented.', false],
      ].map(([name,description,connected]) => <div className="connection-row" key={String(name)}><span className="connection-icon"><Braces size={20}/></span><div><h3>{name}</h3><p>{description}</p></div><span className={`connection-status ${connected ? 'connected' : ''}`}>{connected ? 'Available' : 'Not connected'}</span></div>)}</section>}
      </>}
      <footer className="page-footer"><span>Repro Relay</span><span>Evidence stays attached.</span><a href="https://github.com/lusknchars/repro-relay" target="_blank" rel="noreferrer">Project on GitHub</a></footer>
    </main>
    {modal === 'report' && <Modal title="New bug report" close={() => !busy && setModal(null)}><form onSubmit={createReport}><p className="form-intro">Describe a real problem and what should happen instead.</p><Field label="Report title"><input name="title" required minLength={3} maxLength={160} placeholder="CSV export stops after changing the date range" autoFocus/></Field><div className="form-grid"><Field label="Project"><input name="project" required maxLength={80} placeholder="Your application"/></Field><Field label="Application URL"><input name="url" type="url" required placeholder="https://staging.example.com"/></Field></div><Field label="Current build" hint="Optional now. Required when you record a reproduction."><input name="build" maxLength={160} placeholder="Commit or build identifier"/></Field><Field label="Reported behavior"><textarea name="description" required maxLength={8000} rows={3} placeholder="What happened, and when?"/></Field><Field label="Expected behavior"><textarea name="expected" required maxLength={8000} rows={2} placeholder="What should the application do?"/></Field>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-footer"><Button type="button" variant="ghost" onClick={() => setModal(null)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save report'}</Button></div></form></Modal>}
    {modal === 'observation' && selected && <Modal title="Record an observation" close={() => !busy && setModal(null)}><form onSubmit={recordObservation}><p className="form-intro">Record what you actually observed. A reproduction needs evidence, steps, and a build.</p><div className="form-grid"><Field label="Result"><select name="result" value={result} onChange={e => setResult(e.target.value as Result)}>{Object.entries(labels).filter(([value]) => value !== 'new').map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Recorded by"><input name="author" required minLength={2} maxLength={80} placeholder="Your name"/></Field></div><Field label="What you observed"><textarea name="observed" required maxLength={8000} rows={3}/></Field><Field label="Steps taken"><textarea name="steps" required={result === 'reproduced'} maxLength={8000} rows={3} placeholder="1. Open the report…"/></Field><div className="form-grid"><Field label="Build or revision"><input name="build" defaultValue={selected.build} required={result === 'reproduced'} maxLength={160} placeholder="Commit or build identifier"/></Field><Field label="Evidence URL"><input name="evidence_url" type="url" required={result === 'reproduced'} placeholder="Link to screenshot, trace, or recording"/></Field></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-footer"><Button type="button" variant="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save observation'}</Button></div></form></Modal>}
    {modal === 'review' && selected && <Modal title="Review for project memory" close={() => !busy && setModal(null)}><form onSubmit={publishMemory}><p className="form-intro">Other investigations can retrieve this observation, its evidence, and this case revision. It will be labeled as human-reviewed.</p><div className="review-excerpt"><strong>{selected.title}</strong><p>{selected.observations.at(-1)?.observed}</p></div><Field label="Reviewed by"><input name="reviewer" required minLength={2} maxLength={80} placeholder="Your name" autoFocus/></Field><label className="check-field"><input type="checkbox" required/>I reviewed the linked evidence and its applicability to this build.</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-footer"><Button type="button" variant="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish reviewed memory'}</Button></div></form></Modal>}
  </div>
}
