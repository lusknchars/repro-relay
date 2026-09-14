import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Compass } from 'lucide-react'
import { Button } from './ui/button'
import type { View } from './templates/ultimate-dashboard/layouts'
import { useTransition } from '../lib/motion'

const pages: { view: View; title: string; body: string; look: string }[] = [
  { view: 'overview', title: 'Your workspace at a glance', body: 'Relay keeps repository activity, investigations, and reviewed context together. Start here to see what has been recorded.', look: 'The overview counts come from saved cases and observations. They do not mean an agent is connected.' },
  { view: 'connections', title: 'Connect the tools you use', body: 'This page explains terminal evidence tools, browser tools, and Plow Latch. Each connection has its own setup.', look: 'Check the status on each card. Opening setup does not start an agent or send a message.' },
  { view: 'sessions', title: 'Follow work without writing a task', body: 'The local context monitor collects repository audits and evaluates duplicate context automatically. This is where you follow its activity.', look: 'Inspect a completed candidate before approving or declining. No candidate means nothing needs your decision. This monitor does not run code repairs.' },
  { view: 'inbox', title: 'Keep a problem and its evidence together', body: 'The case inbox holds reports, expected behavior, builds, and recorded observations. Open a case to inspect its history.', look: 'Human observations and agent findings stay attributed to their sources. A report alone is not a verified bug.' },
  { view: 'agents', title: 'See what Hermes did and what it used', body: 'Select a case and an investigation to read findings, review evidence, and see token and dollar charts on the page.', look: 'The runtime connection determines whether Hermes can run. Missing usage stays unknown; there is no need to download a file to inspect reported spending.' },
  { view: 'memory', title: 'Carry forward reviewed context', body: 'Project memory keeps observations your team reviewed, with their evidence and source revision attached.', look: 'Inspect a source before reusing it. Removed or outdated memory should not silently become fresh context.' },
  { view: 'handoffs', title: 'Prepare the next person or agent', body: 'Handoffs preserve a case snapshot for the next step, including the build and assignment it belongs to.', look: 'Review freshness before using a packet. Completing this tour does not enable integrations or approve any work.' },
]

export function WorkspaceTour({ view, navigate, guest }: { view: View; navigate: (view: View) => void; guest: boolean }) {
  const key = `relay-workspace-tour-v1-${guest ? 'guest' : 'local'}`
  const [state, setState] = useState(() => { try { return localStorage.getItem(key) || 'new' } catch { return 'new' } })
  const active = state === 'active'
  const index = pages.findIndex(page => page.view === view)
  const page = pages[index]
  const heading = useRef<HTMLHeadingElement>(null)
  const startButton = useRef<HTMLButtonElement>(null)
  const wasActive = useRef(false)
  const ref = useTransition<HTMLElement>([view, active])
  useEffect(() => {
    if (active) { heading.current?.focus({ preventScroll: true }); ref.current?.scrollIntoView({ block: 'start' }) }
    else if (wasActive.current) (startButton.current || document.getElementById('workspace'))?.focus({ preventScroll: true })
    wasActive.current = active
  }, [view, active, ref])
  function save(next: string) { setState(next); try { localStorage.setItem(key, next) } catch { /* Tour remains usable without storage. */ } }
  if ((!active && view !== 'overview') || (active && !page)) return null
  if (!active && state !== 'new') return <section aria-label="Workspace guide" className="reptest-panel my-4 flex flex-wrap items-center justify-between gap-3 px-4 py-2"><p className="text-sm text-muted-foreground">Your work, evidence and connected tools.</p><div className="flex gap-2"><Button ref={startButton} variant="ghost" className="min-h-11" onClick={() => {save('active');navigate('overview')}}>Replay guided tour</Button><Button variant="outline" className="min-h-11" onClick={() => navigate('connections')}>Go to connections</Button></div></section>
  return <section ref={ref} aria-label="Workspace guide" className="relay-card scroll-mt-20 my-5 rounded-xl border bg-card p-5 sm:p-6">
    <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Compass className="size-4"/>{active ? `WORKSPACE TOUR · ${index + 1} OF ${pages.length}` : 'START HERE'}</div>
    <h2 ref={heading} tabIndex={-1} className="text-xl font-medium outline-none">{active ? page.title : 'Get to know your Relay workspace'}</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{active ? page.body : 'Take a short guided walk through the pages. Learn where to connect tools, follow automatic work, inspect Hermes usage, and review results before making a decision.'}</p>
    {active ? <>
      <p className="mt-3 max-w-3xl rounded-lg border bg-muted/40 p-3 text-sm leading-6">{page.look}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-11" disabled={index === 0} onClick={() => navigate(pages[index - 1].view)}><ArrowLeft/>Back</Button>
        <Button className="min-h-11" onClick={() => { if (index === pages.length - 1) { save('finished'); navigate('overview') } else navigate(pages[index + 1].view) }}>{index === pages.length - 1 ? 'Finish tour' : 'Next page'}<ArrowRight/></Button>
        <Button variant="ghost" className="min-h-11" onClick={() => save('skipped')}>Skip tour</Button>
        <span className="text-xs text-muted-foreground">Explore the page below, then continue.</span>
      </div>
    </> : <div className="mt-4 flex flex-wrap gap-3"><Button ref={startButton} className="min-h-11" onClick={() => { save('active'); navigate('overview') }}>{state === 'new' ? 'Start guided tour' : 'Replay guided tour'}<ArrowRight/></Button><Button className="min-h-11" variant="ghost" onClick={() => navigate('connections')}>Go to connections</Button></div>}
  </section>
}
