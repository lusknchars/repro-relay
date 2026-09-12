import { useState } from 'react'
import { ArrowRight, GitBranch, ShieldCheck, Fingerprint, Layers3 } from 'lucide-react'
import { Button } from './ui/button'
import { ThemeToggle } from './ThemeToggle'
import { RelayPreview } from './RelayPreview'
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
    <header className="guest-brand"><div className="brand-lockup"><span className="brand-mark"><GitBranch size={23}/></span><strong>repro<span className="brand-light">relay</span></strong></div><div className="guest-nav"><span className="guest-pill"><span className="online-dot"/>Public beta</span><ThemeToggle/></div></header>
    <div className="guest-layout"><section className="guest-copy"><div className="guest-intro"><span className="intro-line"/>For the team behind the agents</div><h1>A bug report is only the beginning.</h1><p>Keep the evidence. Pass the context.<br/>Give the next agent a better place to start.</p><Button size="lg" className="guest-cta" onClick={()=>void start()} disabled={busy}>{busy?'Opening your workspace…':'Try a test workspace'}<ArrowRight/></Button><small>No signup. Your own workspace.<br/>A sample report to get you started.</small>{error&&<p role="alert" className="form-error">{error}</p>}</section><RelayPreview/></div>
    <section className="guest-principles" aria-label="Inside the workspace"><article><Fingerprint size={22}/><h2>Evidence with a source.</h2><p>Keep what happened, who observed it, and which build they tested.</p></article><article><Layers3 size={22}/><h2>Memory with a review.</h2><p>Carry useful observations into the next investigation.</p></article><article><ShieldCheck size={22}/><h2>A check before the handoff.</h2><p>Catch changed builds and outdated context before the next step.</p></article></section>
    <footer className="guest-details"><div><p>This beta tests evidence capture, memory, and handoff preparation. Browser agents and automatic repairs are not connected yet.</p><p>Use sample data. Workspaces and feedback expire after 7 days. Clearing cookies loses access. Project maintainers can review test records and feedback.</p></div><a href="https://github.com/lusknchars/repro-relay" target="_blank" rel="noreferrer">Source and current progress <ArrowRight size={14}/></a></footer>
  </main>
}
