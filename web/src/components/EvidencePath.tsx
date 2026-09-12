import { Check, Circle, FileText, Search, ShieldCheck, FileCheck2 } from 'lucide-react'
import type { Case } from '../types'

export function EvidencePath({item, reviewed, open}: {item:Case; reviewed:boolean; open:(tab:'evidence'|'context')=>void}) {
  const latest=item.handoffs.at(-1)
  const stale=latest && (latest.case_revision!==item.revision || latest.owner_version!==item.owner_version || latest.status==='stale')
  const steps = [
    {title:'Report', subtitle:'Captured', done:true, icon:FileText, tab:'evidence' as const},
    {title:'Evidence', subtitle:item.observations.length ? `${item.observations.length} recorded` : 'Add observation',done:item.observations.length>0,icon:Search,tab:'evidence' as const},
    {title:'Memory', subtitle:reviewed?'Reviewed':'Not published',done:reviewed,icon:ShieldCheck,tab:'evidence' as const},
    {title:'Handoff', subtitle:stale?'Outdated':latest?'Prepared':'Prepare context',done:!!latest&&!stale,icon:FileCheck2,tab:'context' as const},
  ]
  return <nav className="evidence-path" aria-label="Case progress">{steps.map(({title,subtitle,done,icon:Icon,tab},i)=><button key={title} onClick={()=>open(tab)} className={`${done?'complete':''} ${i===3&&stale?'path-stale':''}`}><span className="path-icon"><Icon size={17}/></span><span><strong>{title}</strong><small>{subtitle}</small></span><span className="path-state">{done?<Check size={12}/>:<Circle size={9}/>}</span></button>)}</nav>
}
