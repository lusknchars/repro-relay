import { useEffect, useRef, useState } from 'react'
import { Play, RefreshCw, Square } from 'lucide-react'
import { Button } from './ui/button'
import { message, request } from '../lib/api'
import type { Case, InvestigationRun } from '../types'
import { useTransition } from '../lib/motion'

const labels: Record<string,string> = {
  queued:'Queued', dispatching:'Submitting to Hermes', running:'Investigating',
  waiting_for_approval:'Approval needed in Hermes', stopping:'Waiting for stop confirmation',
  completed:'Result ready for review', failed:'Failed', cancelled:'Stopped', attention:'Needs reconciliation',
}
const active = (run?: InvestigationRun) => !!run && !['completed','failed','cancelled'].includes(run.status)

export function RunPanel({item, guest}: {item:Case; guest:boolean}) {
  const [runner,setRunner] = useState<{available:boolean;reason:string} | null>(null)
  const [runs,setRuns] = useState<InvestigationRun[]>([])
  const [error,setError] = useState('')
  const [connectionError,setConnectionError] = useState('')
  const [busy,setBusy] = useState(false)
  const [pending,setPending] = useState('')
  const [maxSeconds,setMaxSeconds] = useState(120)
  const key = useRef<{id:string;revision:number;maxSeconds:number} | null>(null)
  const refreshRequested = useRef(false)
  const latest = runs[0]
  const resultRef = useTransition<HTMLDivElement>([latest?.id, latest?.status])

  useEffect(()=>{
    let disposed=false
    let timer: ReturnType<typeof setTimeout>
    const abort = new AbortController()
    async function poll() {
      try {
        const next=await request<InvestigationRun[]>(`/cases/${item.id}/runs`,{signal:abort.signal})
        if(disposed)return
        if(!refreshRequested.current)setRuns(next)
        setConnectionError('')
      } catch(e) { if(!disposed)setConnectionError(message(e)) }
      if(!disposed)timer=setTimeout(poll,3000)
    }
    void poll()
    request<{available:boolean;reason:string}>('/runner',{signal:abort.signal})
      .then(value=>{if(!disposed)setRunner(value)})
      .catch(e=>{if(!disposed)setError(message(e))})
    return ()=>{disposed=true;abort.abort();clearTimeout(timer)}
  },[item.id])

  async function update(work:()=>Promise<unknown>, action = '') {
    if(refreshRequested.current)return
    refreshRequested.current=true;setBusy(true);setPending(action);setError('')
    try {await work();setRuns(await request<InvestigationRun[]>(`/cases/${item.id}/runs`))}
    catch(e){setError(message(e))}
    finally{setBusy(false);setPending('');refreshRequested.current=false}
  }
  async function start() {
    if(!key.current || key.current.revision!==item.revision || key.current.maxSeconds!==maxSeconds) {
      key.current={id:crypto.randomUUID(),revision:item.revision,maxSeconds}
    }
    const pending=key.current
    await request(`/cases/${item.id}/runs`,{method:'POST',headers:{'Idempotency-Key':pending.id},body:JSON.stringify({revision:pending.revision,max_seconds:pending.maxSeconds})})
    key.current=null
  }
  return <section className="run-panel" aria-label="Agent investigation">
    <div className="run-heading"><div><h3>Agent investigation</h3><p>{guest?'Guest workspaces do not operate a connected agent.':runner?.reason || 'Checking the runner connection…'}</p></div>
      {!guest&&<Button variant="ghost" size="sm" pending={pending==='check'} disabled={busy} onClick={()=>void update(async()=>setRunner(await request('/runner')), 'check')}><RefreshCw/>{pending==='check'?'Checking…':'Check connection'}</Button>}
    </div>
    {!guest&&<div className="run-controls"><label>Time limit<select aria-label="Investigation time limit" value={maxSeconds} disabled={busy||active(latest)} onChange={e=>setMaxSeconds(Number(e.target.value))}><option value={30}>30 seconds</option><option value={120}>2 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option></select></label>
      <Button pending={pending==='start'} disabled={busy||!runner?.available||active(latest)||!item.build.trim()} onClick={()=>void update(start, 'start')}><Play/>{pending==='start'?'Starting investigation…':'Start Hermes investigation'}</Button>
      {!item.build.trim()&&<p>Name the current build before starting.</p>}
    </div>}
    {latest&&<div ref={resultRef} className="run-current">
      <p className="run-status" role="status">{labels[latest.status] || latest.status}</p><p>{latest.detail}</p>
      {(latest.context_stale||latest.case_revision!==item.revision||latest.owner_version!==item.owner_version)&&<p className="build-warning">This run used earlier case context. Its result needs a fresh review.</p>}
      <dl><div><dt>Source revision</dt><dd>{latest.case_revision}</dd></div><div><dt>Build</dt><dd>{latest.build}</dd></div><div><dt>Time limit</dt><dd>{latest.max_seconds} seconds</dd></div><div><dt>Reported tokens</dt><dd>{latest.usage?.total_tokens ?? 'Not reported'}</dd></div><div><dt>Reported cost</dt><dd>{latest.usage?.cost_usd == null?'Not reported':`$${latest.usage.cost_usd}`}</dd></div></dl>
      <div className="run-controls">
        {active(latest)&&!guest&&<Button variant="outline" size="sm" pending={pending==='stop'} disabled={busy||latest.status==='stopping'} onClick={()=>void update(()=>request(`/runs/${latest.id}/stop`,{method:'POST'}), 'stop')}><Square/>{pending==='stop'?'Requesting stop…':'Request stop'}</Button>}
        {latest.status==='attention'&&!guest&&<Button variant="outline" size="sm" pending={pending==='reconcile'} disabled={busy} onClick={()=>void update(()=>request(`/runs/${latest.id}/reconcile`,{method:'POST'}), 'reconcile')}><RefreshCw/>{pending==='reconcile'?'Reconciling…':'Reconcile run'}</Button>}
      </div>
      {latest.output!=null&&<div className="run-output"><h4>Agent proposal</h4><p>This answer has not been published as an observation or reviewed memory.</p><pre>{latest.output||'Hermes returned no answer text.'}</pre></div>}
      <details><summary>Run history and frozen context</summary><code>{latest.id}</code><ol>{latest.events.map(event=><li key={event.sequence}><time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time> {event.detail}</li>)}</ol><pre>{JSON.stringify(latest.context,null,2)}</pre></details>
      <small>State refreshes every 3 seconds while this view is open. The backend continues the run after you leave. Time limits request a cooperative stop; runtime tool and spending limits still apply.</small>
    </div>}
    {runs.length>1&&<details><summary>{runs.length-1} earlier investigations</summary>{runs.slice(1).map(run=><article key={run.id}><h4>{new Date(run.created_at).toLocaleString()} · {labels[run.status]}</h4><p>{run.detail}</p>{run.output&&<pre>{run.output}</pre>}</article>)}</details>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {connectionError&&<p className="form-error" role="alert">{connectionError} The last saved run state is shown.</p>}
  </section>
}
