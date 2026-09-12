import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight,
  CircleDot, Database, FileText, Link2, Plus, Search, ShieldCheck, X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import { AdminLayout, type View } from './components/templates/ultimate-dashboard/layouts'
import { PageTitle } from './components/templates/ultimate-dashboard/layouts/page-title'
import { AIDashboard } from './components/templates/ultimate-dashboard/dashboards/ai'
import { Table7 } from './components/blocks/dashboard/table/table-7'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs'
import { CaseActivity } from './components/CaseActivity'
import { EvidencePath } from './components/EvidencePath'
import { GuestGate } from './components/GuestGate'
import { BetaFeedback } from './components/BetaFeedback'
import { ContextPanel } from './components/ContextPanel'
import { RunPanel } from './components/RunPanel'
import { Badge } from './components/ui/badge'
import { apiBase, message, request, requestAll } from './lib/api'
import type { Case, CaseStatus, Health, Memory, Result } from './types'
import { useTransition } from './lib/motion'
import { useWorkspaceCommands, type WorkspaceCommand } from './lib/desktop'
import { ShortcutHint } from './components/ShortcutHint'
import plowLogo from './assets/plow-logo.png'
import hermesLogo from './assets/hermes-logo.webp'

const InvestigationWorkspace = lazy(() => import('./components/InvestigationWorkspace').then(module => ({default: module.InvestigationWorkspace})))

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
  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    return () => {
      dialog?.close()
      if (trigger instanceof HTMLElement) queueMicrotask(() => { if (trigger.isConnected) trigger.focus() })
    }
  }, [])
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
  const [session, setSession] = useState<{mode: 'local' | 'guest'; authenticated: boolean} | null>(null)
  const [cases, setCases] = useState<Case[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [selectedId, setSelectedId] = useState(()=>new URLSearchParams(window.location.search).get('case') || '')
  const [related, setRelated] = useState<Memory[]>([])
  const [view, setView] = useState<View>(()=>{ const params=new URLSearchParams(window.location.search); const v=params.get('view'); return ['overview','inbox','agents','memory','handoffs','connections'].includes(v||'') ? v as View : params.has('case') ? 'inbox' : 'overview' })
  const [tab, setTab] = useState<'evidence' | 'context' | 'handoff' | 'activity'>('evidence')
  const [showCase, setShowCase] = useState(new URLSearchParams(window.location.search).has('case'))
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
  const detailRef = useTransition<HTMLDivElement>([tab, selectedId, view, loading])
  const noticeRef = useTransition<HTMLDivElement>([notice])
  const searchRef = useRef<HTMLInputElement>(null)
  const [focusSearch, setFocusSearch] = useState(0)
  useEffect(() => { if (focusSearch) searchRef.current?.focus() }, [focusSearch])
  useWorkspaceCommands(useCallback((command: WorkspaceCommand) => {
    if (modal || busy || !health) return
    if (command === 'new-report') {
      setError('');setNotice('');requestKey.current=crypto.randomUUID();setModal('report')
    } else if (command === 'find-case') {
      setView('inbox');setShowCase(false);setFocusSearch(value=>value+1)
    } else if (command === 'connections') setView('connections')
  }, [modal, busy, health]))
  useEffect(()=>{
    const url = new URL(window.location.href)
    if(selectedId&&((view==='inbox'&&showCase)||view==='agents'))url.searchParams.set('case',selectedId)
    else url.searchParams.delete('case')
    if(view==='overview')url.searchParams.delete('view');else url.searchParams.set('view',view)
    window.history.replaceState(null,'',url)
  },[selectedId,view,showCase])

  async function refresh() {
    const [items, knowledge, status] = await Promise.all([
      requestAll<Case>('/cases'), requestAll<Memory>('/memories'), request<Health>('/health'),
    ])
    setCases(items); setMemories(knowledge); setHealth(status)
    setSelectedId(id => items.some(item => item.id === id) ? id : items[0]?.id || '')
  }
  async function openWorkspace() {
    const current = await request<{mode: 'local' | 'guest'; authenticated: boolean}>('/session')
    setSession(current)
    if (current.authenticated) await refresh()
    setLoading(false)
  }
  useEffect(() => {
    openWorkspace().catch(e => {setError(message(e)); setLoading(false)})
  }, [])
  useEffect(() => {
    let current = true
    setRelated([]); setPacket('')
    if (selectedId && view === 'inbox' && showCase) {
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
  }, [selectedId, selected?.revision, memories, view, showCase])

  function openModal(next: typeof modal) {
    setError(''); setNotice(''); requestKey.current = crypto.randomUUID(); setModal(next)
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (e) { setError(message(e)); await openWorkspace().catch(() => {}) }
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
      setTab('evidence'); setShowCase(true); setModal(null); setNotice('Report saved. Record an observation to continue.')
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
  function navigate(next: View) { setView(next); setShowCase(false); setQuery(''); setFilter('all'); setError(''); setNotice('') }
  function openCase(item:Case) {setSelectedId(item.id);setView('inbox');setShowCase(true);setTab('evidence')}
  function focusCaseSearch(){setView('inbox');setShowCase(false);setFocusSearch(value=>value+1)}
  const selectedMemory = memories.find(item => item.case_id === selectedId)

  if (session?.mode === 'guest' && !session.authenticated) return <GuestGate ready={openWorkspace}/>
  const isGuest = session?.mode === 'guest'
  const titles:Record<View,string>={overview:'Investigation overview',inbox:'Case inbox',agents:'Agent controls',memory:'Project memory',handoffs:'Handoffs',connections:'Connections'}
  return <AdminLayout view={view} navigate={navigate} search={focusCaseSearch} guest={isGuest} connected={!!health}>
    <PageTitle title={titles[view]} description={view==='overview'?'Keep reports, agent work, and evidence in one place.':undefined} endContent={<ShortcutHint label="Create a report" keys="Shift N"><Button onClick={()=>openModal('report')} disabled={!health}><Plus/>New report</Button></ShortcutHint>}/>
    {isGuest && <div className="mt-5"><BetaFeedback/></div>}
    {error && <div className="notice error" role="alert">{error}<Button variant="ghost" size="sm" onClick={()=>void action(openWorkspace)}>Retry connection</Button></div>}
    {notice && <div ref={noticeRef} className="notice" role="status"><Check size={16}/>{notice}</div>}
    {loading ? <div className="loading" role="status">Opening your workspace…</div> : <>
     {view==='overview' && <><AIDashboard cases={cases} memories={memories} guest={isGuest} navigate={navigate}/><div className="mt-5"><Table7 compact cases={cases} open={openCase} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter}/></div></>}
     {view==='inbox' && <div className="mt-5">{showCase&&selected ? <section className="case-detail rounded-xl border bg-card" aria-label="Selected case">
            <button className="mobile-back" onClick={()=>setShowCase(false)}><ArrowLeft size={16}/>All reports<span>{cases.length}</span></button><div className="detail-heading"><div className="detail-kicker"><span title={selected.id}>{selected.id.slice(0,11)}</span><span>Revision {selected.revision}</span></div><h2>{selected.title}</h2><div className="detail-meta"><Status value={selected.status}/><span>{selected.project}</span><span>{time(selected.created_at)}</span></div></div>
            <Tabs className="case-tabs" value={tab} onValueChange={value=>{
              if(value==='evidence'||value==='context'||value==='handoff'||value==='activity') {
                setTab(value);setNotice('');setError('')
              }
            }}>
            <EvidencePath item={selected} reviewed={!!selectedMemory} open={setTab}/>
            <TabsList className="detail-tabs" variant="line" aria-label="Case detail">{(['evidence', 'context', 'handoff', 'activity'] as const).map(value => <TabsTrigger key={value} value={value}>{value === 'evidence' ? 'Evidence' : value === 'context' ? 'Agent context' : value === 'handoff' ? 'Repair packet' : 'Activity'}{value === 'evidence' && <span>{selected.observations.length}</span>}</TabsTrigger>)}</TabsList>
            <TabsContent ref={detailRef} className="detail-body" value={tab} key={`${selected.id}-${tab}`}>
            {tab === 'evidence' && <>
              <div className="description-grid"><div><h3>Reported behavior</h3><p>{selected.description}</p></div><div><h3>Expected behavior</h3><p>{selected.expected}</p></div></div>
              <a className="target-link" href={selected.url} target="_blank" rel="noreferrer"><Link2 size={15}/><span>{selected.url}</span><ArrowRight size={15}/></a>
              <div className="section-label"><h3>Investigation record</h3><Button variant="outline" size="sm" onClick={() => openModal('observation')}><Plus/>Record observation</Button></div>
              {!selected.observations.length && <div className="evidence-empty"><div className="evidence-symbol"><Search size={24}/></div><div><h4>The report is ready to investigate.</h4><p>Record what you observed in the application. Include the build and an evidence link when you reproduce the problem.</p><small>Open Agent context to check the connected investigator.</small></div></div>}
              {[...selected.observations].reverse().map(observation => <article className="observation" key={observation.id}><div className="observation-top"><Status value={observation.result}/><small>{time(observation.at)}</small></div>{observation.build && observation.build !== selected.build && <p className="build-warning">Earlier build. Recheck this evidence against {selected.build}.</p>}<p>{observation.observed}</p>{observation.steps && <details><summary>Reproduction steps</summary><p className="preserve">{observation.steps}</p></details>}<dl><div><dt>Recorded by</dt><dd>{observation.author}</dd></div><div><dt>Build</dt><dd>{observation.build || 'Not supplied'}</dd></div></dl>{observation.evidence_url && <a className="evidence-link" href={observation.evidence_url} target="_blank" rel="noreferrer"><Link2 size={14}/>Open evidence</a>}<small className="attribution">Human-recorded observation. Repro Relay has not independently verified it.</small></article>)}
              <div className="section-label"><h3>Related project memory</h3><span className="subtle">Exact term lookup</span></div>
              {related.length ? related.map(memory => <button className="related-row" key={memory.id} onClick={() => setSelectedId(memory.case_id)}><BookOpen size={16}/><div><strong>{memory.title}</strong><small>{memory.case_id} · Reviewed by {memory.reviewer}</small></div><ChevronRight size={15}/></button>) : <p className="muted-paragraph">No matching reviewed observations yet. Memory grows as your team reviews evidence.</p>}
              {selected.status === 'reproduced' && <div className="memory-prompt"><ShieldCheck size={22}/><div><strong>{selectedMemory ? 'This observation is in project memory.' : 'Useful for the next investigation?'}</strong><p>{selectedMemory ? `Reviewed by ${selectedMemory.reviewer}. New observations invalidate this memory.` : 'Review the evidence before making this observation available to future cases.'}</p></div>{!selectedMemory && <Button variant="outline" size="sm" onClick={() => openModal('review')}>Review for memory</Button>}</div>}
            </>}
            {tab === 'context' && <>{'__TAURI_INTERNALS__' in window&&<a className="target-link" href={`http://127.0.0.1:8178/?case=${encodeURIComponent(selected.id)}`}><Link2 size={15}/>Open this case in your browser</a>}<RunPanel key={`run-${selected.id}`} item={selected} guest={isGuest}/><ContextPanel key={selected.id} item={selected} refresh={refresh}/></>}
            {tab === 'handoff' && <><div className="packet-intro"><FileText size={22}/><div><h3>A precise starting point for engineering.</h3><p>This export includes the report, recorded evidence, and related reviewed cases. Unknown repository and commit details stay explicit.</p></div></div><Button onClick={exportPacket} disabled={!packet}><ArrowDownToLine/>Export Markdown</Button><pre className="packet-preview">{packet || 'Loading repair packet…'}</pre></>}
            {tab === 'activity' && <CaseActivity events={selected.events}/>}
            </TabsContent>
            </Tabs>
          </section> : <Table7 cases={cases} open={openCase} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} searchRef={searchRef}/>}</div>}
     {view==='agents' && <Suspense fallback={<Card className="mt-5"><CardContent role="status">Loading the investigation workspace…</CardContent></Card>}><InvestigationWorkspace cases={cases} selectedId={selectedId} onSelect={setSelectedId} guest={isGuest} onOpenCase={openCase} onNewReport={()=>openModal('report')} onRefresh={refresh}/></Suspense>}
{view === 'memory' && <section className="memory-view"><div className="memory-heading"><div><h2>Reviewed observations</h2><p>References for investigation. These entries do not establish a root cause or a verified fix.</p></div><label className="search"><Search size={16}/><input aria-label="Search memory" placeholder="Search observations…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
        {memories.filter(memory => `${memory.title} ${memory.observation.observed}`.toLowerCase().includes(query.toLowerCase())).map(memory => <article className="memory-card" key={memory.id}><div className="memory-card-icon"><Database size={21}/></div><div className="memory-copy"><span className="subtle">{memory.project} · {memory.case_id} · Revision {memory.revision}</span><h3>{memory.title}</h3><p>{memory.observation.observed}</p><small>Reviewed by {memory.reviewer} · {time(memory.created_at)}</small></div><div className="memory-actions"><Button variant="outline" size="sm" onClick={() => {setSelectedId(memory.case_id); setView('inbox'); setShowCase(true); setTab('evidence')}}>Open case</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => void action(async () => {await request(`/memories/${memory.id}`, {method: 'DELETE'}); await refresh(); setNotice('Memory removed from retrieval. The original case is preserved.')})}>Remove from memory</Button></div></article>)}
        {!memories.length && <div className="large-empty"><Database size={34}/><h3>Start with a reviewed reproduction.</h3><p>Record evidence on a case, then choose “Review for memory.” Its source and revision will stay attached.</p><Button variant="outline" onClick={() => navigate('inbox')}>Go to case inbox</Button></div>}
        {memories.length > 0 && !memories.some(memory => `${memory.title} ${memory.observation.observed}`.toLowerCase().includes(query.toLowerCase())) && <p className="muted-paragraph">No observations match this search.</p>}
      </section>}
     {view==='handoffs'&&<div className="mt-5 space-y-4">{cases.flatMap(c=>c.handoffs.map(h=><Card key={h.id} className="py-5"><CardContent className="flex flex-wrap items-center justify-between gap-4 px-5"><div><h2 className="text-sm font-medium">{c.title}</h2><p className="text-muted-foreground mt-1 text-xs">{h.role} · Revision {h.case_revision} · {h.status}</p><p className="text-muted-foreground mt-2 text-xs">{h.reason||'Check freshness before using this snapshot.'}</p></div><Button variant="outline" onClick={()=>{openCase(c);setTab('context')}}>Review handoff<ArrowRight/></Button></CardContent></Card>))}
      {!cases.some(c=>c.handoffs.length)&&<Card><CardContent><h2 className="font-medium">No handoffs prepared yet.</h2><p className="text-muted-foreground my-3 text-sm">Open a case, choose Agent context, and prepare a role-specific snapshot.</p><Button variant="outline" onClick={()=>navigate('inbox')}>Go to case inbox</Button></CardContent></Card>}
     </div>}
     {view==='connections'&&<div className="mt-5 grid gap-4 md:grid-cols-2">{[
      [isGuest?'Guest workspace':'Local workspace','Rust API, PostgreSQL history, reviewed memory, and versioned handoffs.',health?'Available':'Disconnected'],
      ['Hermes investigator','Start, monitor, stop, and reconcile runs from Agent controls. Check the live runtime connection there.',isGuest?'Disabled for guests':'Check runtime in Agent controls'],
      ['Plow Chat + Latch','Phone intake and approved Mac/browser actions still need a live integration test.','Not connected'],
      ['Owner updates','Channel delivery and destination authorization are not implemented yet.','Not connected'],
     ].map(([name,description,status])=><Card key={name} className="py-5"><CardHeader className="px-5"><CardTitle className="flex items-center gap-3">{name==='Plow Chat + Latch'&&<img src={plowLogo} alt="" width={60} height={32} className="h-8 w-[60px] shrink-0 rounded object-contain"/>}{name==='Hermes investigator'&&<img src={hermesLogo} alt="" width={32} height={32} className="size-8 shrink-0 rounded bg-white object-contain"/>}{name}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="flex items-center justify-between px-5"><Badge variant="outline">{status}</Badge>{name==='Hermes investigator'&&<Button variant="outline" size="sm" onClick={()=>navigate('agents')}>Agent controls<ArrowRight/></Button>}</CardContent></Card>)}</div>}
    </>}
    {modal === 'report' && <Modal title="New bug report" close={() => !busy && setModal(null)}><form onSubmit={createReport}><p className="form-intro">Describe a real problem and what should happen instead.</p><Field label="Report title"><input name="title" required minLength={3} maxLength={160} placeholder="CSV export stops after changing the date range" autoFocus/></Field><div className="form-grid"><Field label="Project"><input name="project" required maxLength={80} placeholder="Your application"/></Field><Field label="Application URL"><input name="url" type="url" required placeholder="https://staging.example.com"/></Field></div><Field label="Current build" hint="Optional now. Required when you record a reproduction."><input name="build" maxLength={160} placeholder="Commit or build identifier"/></Field><Field label="Reported behavior"><textarea name="description" required maxLength={8000} rows={3} placeholder="What happened, and when?"/></Field><Field label="Expected behavior"><textarea name="expected" required maxLength={8000} rows={2} placeholder="What should the application do?"/></Field>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-footer"><Button type="button" variant="ghost" onClick={() => setModal(null)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save report'}</Button></div></form></Modal>}
    {modal === 'observation' && selected && <Modal title="Record an observation" close={() => !busy && setModal(null)}><form onSubmit={recordObservation}><p className="form-intro">Record what you actually observed. A reproduction needs evidence, steps, and a build.</p><div className="form-grid"><Field label="Result"><select name="result" value={result} onChange={e => setResult(e.target.value as Result)}>{Object.entries(labels).filter(([value]) => value !== 'new').map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Recorded by"><input name="author" required minLength={2} maxLength={80} placeholder="Your name"/></Field></div><Field label="What you observed"><textarea name="observed" required maxLength={8000} rows={3}/></Field><Field label="Steps taken"><textarea name="steps" required={result === 'reproduced'} maxLength={8000} rows={3} placeholder="1. Open the report…"/></Field><div className="form-grid"><Field label="Build or revision"><input name="build" defaultValue={selected.build} required={result === 'reproduced'} maxLength={160} placeholder="Commit or build identifier"/></Field><Field label="Evidence URL"><input name="evidence_url" type="url" required={result === 'reproduced'} placeholder="Link to screenshot, trace, or recording"/></Field></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-footer"><Button type="button" variant="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save observation'}</Button></div></form></Modal>}
    {modal === 'review' && selected && <Modal title="Review for project memory" close={() => !busy && setModal(null)}><form onSubmit={publishMemory}><p className="form-intro">Other investigations can retrieve this observation, its evidence, and this case revision. It will be labeled as human-reviewed.</p><div className="review-excerpt"><strong>{selected.title}</strong><p>{selected.observations.at(-1)?.observed}</p></div><Field label="Reviewed by"><input name="reviewer" required minLength={2} maxLength={80} placeholder="Your name" autoFocus/></Field><label className="check-field"><input type="checkbox" required/>I reviewed the linked evidence and its applicability to this build.</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-footer"><Button type="button" variant="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish reviewed memory'}</Button></div></form></Modal>}

  </AdminLayout>
}
