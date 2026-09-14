import { useEffect, useState } from 'react'
import { ArrowRight, Gauge, RefreshCw } from 'lucide-react'
import type { Case, InvestigationRun } from '../../types'
import { request, message } from '../../lib/api'
import { InvestigationCost } from '../InvestigationCost'
import { Button } from '../ui/button'
export function UsageWorkspace({ cases, selectedId, onSelect, open }: { cases: Case[]; selectedId: string; onSelect: (id:string)=>void; open: (item:Case)=>void }) {
  const selected = cases.find(c=>c.id===selectedId) ?? cases[0]
  return <section className="reptest-usage mt-5 space-y-5" aria-label="Workspace usage">
    <div className="reptest-panel flex flex-wrap items-end justify-between gap-4 p-4"><label className="field w-full sm:max-w-md"><span>Spend on one problem</span><select value={selected?.id || ''} onChange={e=>onSelect(e.target.value)}>{!cases.length&&<option value="">No recorded cases</option>}{cases.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>{selected&&<Button variant="outline" onClick={()=>open(selected)}>Open investigation<ArrowRight/></Button>}</div>
    {selected ? <CaseUsage key={selected.id} item={selected}/> : <div className="reptest-panel p-8 text-center"><Gauge className="mx-auto mb-3 size-6 text-muted-foreground"/><h2 className="font-medium">No investigations to measure yet</h2><p className="mt-2 text-sm text-muted-foreground">Reported tokens and costs appear after Hermes records usage for a case.</p></div>}
    <div className="reptest-panel p-4 text-sm"><h2 className="font-semibold">Other connected services</h2><div className="mt-3 divide-y"><p className="py-3">Pi / Kimi <span className="text-muted-foreground">· Usage stays in the Pi terminal and your provider account.</span></p><p className="py-3">Mem0 <span className="text-muted-foreground">· Service billing is not imported into Relay.</span></p><p className="py-3">Context monitor <span className="text-muted-foreground">· Local deterministic scans do not call a model. Storage savings are not token savings.</span></p></div></div>
  </section>
}
function CaseUsage({item}:{item:Case}) {
  const [runs,setRuns]=useState<InvestigationRun[]>([]), [runId,setRunId]=useState(''), [error,setError]=useState(''), [loaded,setLoaded]=useState(false), [attempt,retry]=useState(0)
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>
    async function refresh() {
      try { const next=await request<InvestigationRun[]>(`/cases/${item.id}/runs`,{signal:controller.signal});if(!controller.signal.aborted){setRuns(next);setError('');setLoaded(true)} }
      catch(e){if(!controller.signal.aborted){setError(message(e));setLoaded(true)}}
      finally{if(!controller.signal.aborted)timer=setTimeout(()=>{void refresh()},5000)}
    }
    void refresh();return()=>{controller.abort();clearTimeout(timer)}
  },[item.id,attempt])
  const available=runs.filter(r=>r.execution_kind!=='local_validation'), selected=available.find(r=>r.id===runId)??available[0]
  return <>
    {error&&<div role="alert" className="reptest-panel border-destructive p-4 text-sm"><p>{error} Saved values may be out of date.</p><Button variant="outline" className="mt-3" onClick={()=>retry(x=>x+1)}><RefreshCw/>Retry usage</Button></div>}
    {!loaded&&<p role="status">Loading reported usage…</p>}
    {loaded&&!error&&!selected&&<div className="reptest-panel p-6"><h2 className="font-medium">No Hermes usage for this case</h2><p className="mt-2 text-sm text-muted-foreground">Local validation records do not count as Hermes spending. No cost is inferred.</p></div>}
    {selected&&<><label className="field sm:max-w-xl"><span>Investigation attempt</span><select value={selected.id} onChange={e=>setRunId(e.target.value)}>{available.map(r=><option value={r.id} key={r.id}>{new Date(r.created_at).toLocaleString()} · {r.status} · {r.id}</option>)}</select></label><InvestigationCost run={selected} runs={runs}/></>}
  </>
}
