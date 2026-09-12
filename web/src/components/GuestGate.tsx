import { useState } from 'react'
import { ArrowRight, GitBranch, ShieldCheck, FileCheck2 } from 'lucide-react'
import { Button } from './ui/button'
import { message, request } from '../lib/api'
export function GuestGate({ready}: {ready:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function start() {
    setBusy(true);setError('')
    try {await request('/session',{method:'POST',body:'{}'});await ready()}
    catch(error){setError(message(error))}
    finally{setBusy(false)}
  }
  return <main className="guest-landing">
    <div className="guest-brand"><span className="brand-mark"><GitBranch size={23}/></span><strong>reprorelay</strong><span className="guest-pill">Public beta</span></div>
    <div className="guest-layout"><section className="guest-copy"><h1>A bug report is only the beginning.</h1><p>Give the next agent a clear record of what happened, what changed, and what still needs checking.</p><Button size="lg" onClick={()=>void start()} disabled={busy}>{busy?'Opening your workspace…':'Try a test workspace'}<ArrowRight/></Button><small>No signup. Your workspace is separate from other visitors.</small>{error&&<p role="alert" className="form-error">{error}</p>}</section>
    <section className="guest-preview" aria-label="What you can test"><div className="guest-preview-header"><FileCheck2/><strong>Try the handoff check</strong></div><ol><li>Start with the sample bug report.</li><li>Record an observation and prepare an agent handoff.</li><li>Change the build. See the old handoff get rejected.</li></ol><div className="guest-preview-note"><ShieldCheck size={18}/><span>Your original evidence stays attached.</span></div></section></div>
    <div className="guest-details"><p>This beta tests evidence capture, memory, and handoff preparation. Browser agents and automatic repairs are not connected yet.</p><p>Use sample data. Your test workspace and feedback expire after 7 days. Clearing this browser's cookies loses access. Project maintainers can review stored feedback and test records.</p><a href="https://github.com/lusknchars/repro-relay" target="_blank" rel="noreferrer">Source and current progress</a></div>
  </main>
}
