import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Check, FileCheck2, Fingerprint, RefreshCw, ShieldAlert, Workflow } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { message, request } from '../lib/api'
import type { Case, ContextView, Role } from '../types'

const roles: {id: Role; title: string; description: string}[] = [
  {id: 'investigator', title: 'Investigate', description: 'Attempts, outcomes, and related evidence'},
  {id: 'repair', title: 'Repair', description: 'Reproduction, prior attempts, and missing code context'},
  {id: 'verifier', title: 'Verify', description: 'Original expectation and evidence to check'},
  {id: 'update', title: 'Team update', description: 'Current outcome and its source'},
]

export function ContextPanel({item, refresh}: {item: Case; refresh: () => Promise<void>}) {
  const [role, setRole] = useState<Role>('investigator')
  const [context, setContext] = useState<ContextView | null>(null)
  const [build, setBuild] = useState(item.build)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const latest = item.handoffs.at(-1)
  const locallyStale = latest && (latest.case_revision !== item.revision || latest.owner_version !== item.owner_version)
  useEffect(() => {setBuild(item.build)}, [item.id, item.build])
  useEffect(() => {
    let current = true
    setLoading(true); setContext(null)
    request<ContextView>(`/cases/${item.id}/context?role=${role}`)
      .then(value => {if (current) setContext(value)})
      .catch(e => {if (current) setError(message(e))})
      .finally(() => {if (current) setLoading(false)})
    return () => {current = false}
  }, [item.id, item.revision, item.updated_at, role])
  async function mutate(path: string, payload: unknown, success: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      await request(`/cases/${item.id}/${path}`, {method: 'POST', body: JSON.stringify(payload)})
      setNotice(success)
    } catch (e) {setError(message(e))}
    finally {
      // A rejected check also appends an audit event. Refresh even after HTTP 409.
      try {await refresh()} catch (e) {setError(message(e))}
      setBusy(false)
    }
  }
  function updateBuild(event: FormEvent) {
    event.preventDefault()
    void mutate('build', {revision:item.revision, build:build.trim()}, 'Build updated. Earlier evidence remains in the timeline for reference.')
  }
  const observations = role === 'update' ? item.observations.slice(-1) : role === 'verifier' ? item.observations.slice(-1) : item.observations
  return <div className="context-workspace">
    <div className="context-intro"><div className="context-icon"><Workflow size={24}/></div><div><h3>The right evidence for the next step.</h3><p>Choose a role, review its context, then prepare a versioned handoff.</p></div></div>
    <div className="role-picker" aria-label="Context role">{roles.map(r => <button key={r.id} aria-pressed={role===r.id} disabled={busy} onClick={() => {setRole(r.id); setError(''); setNotice('')}}><span>{r.title}</span><small>{r.description}</small></button>)}</div>
    <div className="context-columns">
      <section className="context-evidence" aria-label="Role context">
        <div className="context-section-heading"><h3>{roles.find(r => r.id===role)?.title} context</h3><Badge variant="secondary">Revision {item.revision}</Badge></div>
        {loading ? <p role="status">Preparing context…</p> : context && <>
          <div className="expectation"><span>Original expectation</span><p>{context.expected}</p></div>
          <h4>{role === 'update' ? 'Latest outcome' : 'Evidence in this view'}</h4>
          {!observations.length && <p className="muted-paragraph">No observations yet. Record an attempt in the Evidence tab before preparing a repair.</p>}
          {observations.map(o => <div className="context-attempt" key={o.id}><div><strong>{o.result.replaceAll('_',' ')}</strong><Badge variant={o.build===item.build ? 'secondary' : 'outline'}>{o.build===item.build ? 'Current build' : 'Earlier build'}</Badge></div><p>{role==='update' ? `Recorded by ${o.author}. Evidence has not been independently verified.` : o.observed}</p><small>{o.build || 'Build not supplied'} / Revision {o.case_revision}</small>{o.evidence_url && <a href={o.evidence_url} target="_blank" rel="noreferrer">Open source evidence <ArrowRight size={12}/></a>}</div>)}
          <div className="context-unknowns"><Fingerprint size={17}/><div><strong>Still needed before an agent can repair</strong><p>A repository, a base commit, and an executable acceptance check. Preparing this handoff does not start a repair.</p></div></div>
          {(role==='investigator'||role==='repair') && <p className="context-source-count">{context.related_reviewed_observations.length} related reviewed observations included. Matching symptoms are leads, not proof of the same cause.</p>}
          <details className="context-raw"><summary>Inspect source IDs and context JSON</summary><pre>{JSON.stringify(context,null,2)}</pre></details>
        </>}
      </section>
      <aside className="context-inspector" aria-label="Handoff controls">
        <h3>Execution context</h3>
        <form onSubmit={updateBuild}><label htmlFor="current-build">Current build</label><input id="current-build" value={build} onChange={e=>setBuild(e.target.value)} required maxLength={160} placeholder="Commit or build identifier"/><Button type="submit" variant="outline" size="sm" disabled={busy||!build.trim()||build===item.build}>Update build</Button></form>
        <div className="inspector-property"><span>Case revision</span><strong>{item.revision}</strong></div>
        <div className="inspector-property"><span>Worker assignment</span><strong>{item.owner_version}</strong></div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void mutate('lease',{revision:item.revision,owner_version:item.owner_version},'Worker assignment advanced. Earlier handoffs must be prepared again.')}><RefreshCw size={14}/>Reassign worker</Button>
        <p className="inspector-hint">Changing the assignment invalidates work prepared for the previous worker.</p>
        <div className="handoff-controls"><Button disabled={busy||loading||!context} onClick={()=>void mutate('handoffs',{revision:item.revision,role},'Handoff saved. Check its freshness before using it.')}><FileCheck2/>Prepare handoff</Button><small>Saves a snapshot. Does not start an agent.</small></div>
      </aside>
    </div>
    {error && <div className="notice error" role="alert"><ShieldAlert size={18}/>{error}</div>}
    {notice && <div className="notice" role="status"><Check size={16}/>{notice}</div>}
    {latest && <section className={`handoff-snapshot ${locallyStale || latest.status==='stale' ? 'is-stale' : ''}`} aria-label="Prepared handoff"><div className="snapshot-heading"><div><h3>Saved handoff</h3><p>{roles.find(r=>r.id===latest.role)?.title} / Revision {latest.case_revision} / Assignment {latest.owner_version}</p></div><Badge variant={locallyStale||latest.status==='stale' ? 'outline' : 'secondary'}>{locallyStale ? 'Outdated' : latest.status==='checked' ? 'Freshness checked' : latest.status}</Badge></div><p>{latest.reason || (locallyStale ? 'The case or worker assignment changed after this snapshot was saved.' : 'The server rechecks the source evidence and referenced memories when you validate.')}</p><Button variant="outline" disabled={busy} onClick={()=>void mutate('handoffs/check',{handoff_id:latest.id},'Freshness check passed. This handoff is current; no repair was executed.')}>Check handoff freshness</Button><details className="context-raw"><summary>View saved snapshot</summary><pre>{JSON.stringify(latest.context,null,2)}</pre></details></section>}
    {item.handoffs.length>1 && <p className="context-source-count">{item.handoffs.length-1} earlier snapshots are preserved in the case record.</p>}
  </div>
}
