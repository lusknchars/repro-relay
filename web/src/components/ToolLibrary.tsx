import { useEffect, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { ArrowRight, BookOpen, Check, ChevronRight, Cpu, Database, ExternalLink, Globe, Layers3, LoaderCircle, MessageCircle, Search, ShieldCheck, Terminal, X } from 'lucide-react'
import { Button } from './ui/button'
import { request, message } from '../lib/api'
import type { View } from './templates/ultimate-dashboard/layouts'
import type { BrowserToolsState } from '../lib/webmcp'
import { TerminalHarnessSetup } from './TerminalHarnessSetup'
import hermesLogo from '../assets/hermes-logo.webp'
import plowLogo from '../assets/plow-logo.png'

type Profile = { version: number; mem0: boolean; updated_at: string | null }
type Entry = { id: string; title: string; category: string; icon: typeof Database; purpose: string; cost: string; access: string; action: string }
const entries: Entry[] = [
  { id: 'evidence', title: 'Relay evidence', category: 'Investigation', icon: ShieldCheck, purpose: 'Give your agent the current audit, source revision and recorded findings.', cost: 'Local reads · model context may use tokens', access: 'Three read-only tools. No source edits or approvals.', action: 'Explore evidence' },
  { id: 'mem0', title: 'Mem0 memory', category: 'Memory', icon: Database, purpose: 'Carry useful working notes between sessions, alongside reviewed project knowledge.', cost: 'Mem0 service usage + model context tokens', access: 'Recall and save private Pi notes. Short notes and queries go to Mem0; reviewed case records stay local.', action: 'Configure memory' },
  { id: 'pi', title: 'Pi terminal', category: 'Connections', icon: Terminal, purpose: 'Review Relay work from your terminal with your chosen model account.', cost: 'Billed by your selected model provider', access: 'Relay evidence tools, plus memory when selected. Source execution is not enabled.', action: 'Connect Pi' },
  { id: 'kimi', title: 'Kimi models', category: 'Models', icon: Cpu, purpose: 'Use your Moonshot API credits for reasoning and tool calls in Pi.', cost: 'Moonshot API credits · estimates not imported', access: 'The selected model receives your prompts and tool results. Kimi Code subscriptions use a separate connection.', action: 'Connect Kimi' },
  { id: 'hermes', title: 'Hermes investigator', category: 'Investigation', icon: Search, purpose: 'Investigate a case using a dedicated runtime and its permitted evidence tools.', cost: 'Runtime-reported tokens and cost in Agent controls', access: 'Runtime permissions determine tool access. Pi authentication does not connect Hermes.', action: 'Agent controls' },
  { id: 'monitor', title: 'Context monitor', category: 'Investigation', icon: Layers3, purpose: 'Find repeated instructions and review context improvements without writing a task.', cost: 'Local deterministic scans · no model calls', access: 'Tracked instruction snapshots and recorded evaluations. Does not modify source files.', action: 'Open monitor' },
  { id: 'plow', title: 'Plow Chat + Latch', category: 'Connections', icon: MessageCircle, purpose: 'Connect your Mac and owner channel for reports and approved updates.', cost: 'Channel and agent usage depend on connected services', access: 'A line and destination must be authorized separately. Launching Latch does not prove message delivery.', action: 'Connect Plow Latch' },
  { id: 'webmcp', title: 'WebMCP', category: 'Connections', icon: Globe, purpose: 'Let a supported browser agent inspect the same recorded Relay evidence.', cost: 'Local evidence reads · browser agent billed separately', access: 'Read-only browser tools. No editing, approval or message delivery.', action: 'View browser tools' },
]

function Command({ children, where = 'Run in macOS Terminal' }: { children: string; where?: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  return <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
    <p className="text-xs font-medium">{where}</p><code className="block select-text break-all text-xs leading-6">{children}</code>
    <Button variant="outline" size="sm" className="min-h-11" onClick={async () => {
      try { await navigator.clipboard.writeText(children); setCopied(true); setError('') }
      catch { setError('Select the command above to copy it. Clipboard access is unavailable.') }
    }}>{copied ? <Check/> : <Terminal/>}{copied ? 'Copied' : 'Copy command'}</Button>
    <span role="status" className="sr-only">{copied ? 'Command copied' : ''}</span>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}

export function ToolLibrary({ guest, readOnly, navigate, openPlow, browserTools }: {
  guest: boolean; readOnly: boolean; navigate: (view: View) => void; openPlow: () => void; browserTools: BrowserToolsState
}) {
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(!guest)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All tools')
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [selected, setSelected] = useState<Entry | null>(null)
  async function refresh() {
    if (guest) return
    setLoading(true); setError('')
    try { setProfile(await request<Profile>('/tool-profile')) }
    catch (e) { setProfile(null); setError(message(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [guest])
  async function selectMemory() {
    if (!profile || saving || guest || readOnly) return
    setSaving(true); setError(''); setNotice('')
    try {
      const next = await request<Profile>('/tool-profile', { method: 'PUT', body: JSON.stringify({ version: profile.version, mem0: !profile.mem0 }) })
      setProfile(next)
      setNotice(next.mem0 ? 'Memory enabled for new Pi sessions. Existing sessions and account connections are unchanged.' : 'Memory disabled for new Pi sessions. Saved notes and existing sessions are unchanged.')
    } catch (e) {
      setProfile(null)
      setError(`${message(e)} Refresh the saved selection before trying again; the request may have completed.`)
    } finally { setSaving(false) }
  }
  const enabled = (id: string) => !guest && (id === 'evidence' || (id === 'mem0' && profile?.mem0 === true))
  function status(id: string) {
    if (guest) return 'Local workspace required'
    if (id === 'evidence') return 'Included in Pi'
    if (id === 'mem0') return !profile ? 'Selection not loaded' : profile.mem0 ? 'Enabled for new Pi sessions' : 'Not enabled in Pi'
    if (id === 'webmcp') return browserTools === 'ready' ? 'Available in this browser' : 'Check browser support'
    if (id === 'hermes') return 'Check runtime connection'
    if (id === 'monitor') return 'Check monitor activity'
    return 'Connection not checked here'
  }
  const filtered = entries.filter(item => (category === 'All tools' || item.category === category)
    && (!enabledOnly || enabled(item.id)) && `${item.title} ${item.purpose} ${item.category}`.toLowerCase().includes(query.toLowerCase()))
  function open(item: Entry) {
    if (item.id === 'plow') { openPlow(); return }
    if (item.id === 'hermes') { navigate('agents'); return }
    if (item.id === 'monitor') { navigate('sessions'); return }
    if (item.id === 'evidence') { navigate('sessions'); return }
    if (item.id === 'webmcp') { document.getElementById('advanced-tool-setup')?.setAttribute('open', ''); document.getElementById('advanced-tool-setup')?.scrollIntoView({ block: 'start' }); return }
    setSelected(item)
  }
  return <section className="tool-library my-5 space-y-6" aria-label="Agent tools library">
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="max-w-2xl"><p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Your agent’s toolkit</p>
        <h2 className="text-2xl font-semibold tracking-tight">Give your agent the right tools.</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Connect accounts, add useful context and understand the cost before you start.</p></div>
      <label className="flex min-h-11 w-full items-center gap-2 rounded-lg border bg-card px-3 focus-within:ring-2 focus-within:ring-ring sm:w-64"><Search className="size-4 shrink-0 text-muted-foreground"/><span className="sr-only">Search tools</span><input className="w-full min-w-0 bg-transparent py-3 text-sm outline-none" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tools…"/></label>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Tool categories">{['All tools', 'Investigation', 'Memory', 'Models', 'Connections'].map(value => <Button key={value} variant={category === value ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</Button>)}</div>
      <Button className="min-h-11" variant={enabledOnly ? 'secondary' : 'outline'} aria-pressed={enabledOnly} onClick={() => setEnabledOnly(!enabledOnly)}><Check/>Enabled in Pi</Button>
    </div>
    {guest && <p className="rounded-lg border bg-card p-4 text-sm" role="status">Explore the library here. Connect accounts and choose agent tools in your local Relay workspace.</p>}
    {readOnly && !guest && <p className="text-sm text-muted-foreground">Your workspace owner manages tool selection. You can inspect setup and permissions.</p>}
    {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 text-sm"><p>{error}</p><Button className="mt-3 min-h-11" variant="outline" disabled={loading} onClick={() => void refresh()}>Refresh saved selection</Button></div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading saved tool selection…</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(item => <article key={item.id} className="relay-card flex min-w-0 flex-col rounded-xl border bg-card p-5 transition-colors hover:border-primary/50">
      <div className="flex items-start justify-between gap-3"><div className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-primary/5 text-primary">{item.id === 'hermes' ? <img className="size-9 rounded bg-white object-contain" src={hermesLogo} alt=""/> : item.id === 'plow' ? <img className="h-8 w-10 rounded object-contain" src={plowLogo} alt=""/> : <item.icon className="size-6" aria-hidden="true"/>}</div><span className="pt-1 text-xs text-muted-foreground">{item.category}</span></div>
      <h3 className="mt-4 text-base font-semibold">{item.title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{item.purpose}</p>
      <p className="mt-4 flex items-center gap-2 text-xs">{enabled(item.id) && <Check className="size-3.5 text-primary"/>}{status(item.id)}</p>
      <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground">{item.cost}</p>
      <Button className="mt-4 min-h-11 justify-between" variant="outline" onClick={event => { trigger.current = event.currentTarget; open(item) }}>{item.action}<ArrowRight/></Button>
    </article>)}</div>
    {!filtered.length && <div className="rounded-xl border bg-card p-8 text-center"><h3 className="font-medium">No tools match this view</h3><p className="my-3 text-sm text-muted-foreground">Try another category or clear the search.</p><Button variant="outline" onClick={() => { setQuery(''); setCategory('All tools'); setEnabledOnly(false) }}>Show all tools</Button></div>}
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4"><div><h3 className="text-sm font-medium">Know what each connection costs</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">Hermes reports are available in Agent controls. Pi usage stays in its terminal session. Mem0 and Moonshot billing stay with those services; a missing amount is not zero.</p></div><Button variant="ghost" className="min-h-11" onClick={() => navigate('usage')}>Inspect Hermes usage<ChevronRight/></Button></div>
    <Dialog.Root open={selected !== null} onOpenChange={value => { if (!value && !saving) { setSelected(null); setNotice('') } }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/60"/><Dialog.Content onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-5 shadow-xl sm:p-6">
        <div className="flex items-center justify-between gap-3"><Dialog.Title className="text-lg font-semibold">{selected?.title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" className="size-11" disabled={saving} aria-label="Close tool setup"><X/></Button></Dialog.Close></div>
        <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">{selected?.purpose}</Dialog.Description>
        <div className="my-4 rounded-lg border p-3 text-sm leading-6"><p className="font-medium">Access and billing</p><p className="mt-1 text-muted-foreground">{selected?.access}</p><p className="mt-2 text-xs text-muted-foreground">{selected?.cost}</p></div>
        {selected?.id === 'pi' && <TerminalHarnessSetup guest={guest}/>}
        {selected?.id === 'kimi' && <div className="space-y-4 text-sm"><p>Use a Moonshot API key from the account holding your credits. In an existing Pi session, enter <code>/quit</code> to return to Terminal first.</p><Command>{'./relay pi start --profile personal --provider moonshot --model kimi-k3'}</Command><Command where="Type inside Pi">/login moonshot</Command><p className="text-muted-foreground">Paste the key only into Pi’s private prompt. This launch requires the Moonshot model configuration in your personal Pi profile. It does not install a provider or confirm available credit.</p><Button asChild variant="outline" className="min-h-11"><a href="https://platform.kimi.ai/docs/guide/kimi-k3-quickstart" target="_blank" rel="noreferrer">Moonshot API setup<ExternalLink/></a></Button></div>}
        {selected?.id === 'mem0' && <div className="space-y-4 text-sm"><p>Uses the Mem0 account configured on this Mac. Connect it below if you have not already.</p><details className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer py-3 font-medium">Connect an existing Mem0 account</summary><div className="mt-3 space-y-4"><Command>~/.local/bin/mem0 init</Command><p className="text-muted-foreground">Choose the API-key option for an existing account, and paste the key into the private prompt. Do not use agent signup to reconnect an existing account.</p><Command>~/.local/bin/mem0 status</Command><Command>python3 integrations/mem0-memory/memory.py setup</Command></div></details><p className="rounded-lg border p-3 leading-6">Enabling adds two tools to new Pi sessions: recall context and save private notes. Notes remain unverified. This setting does not connect an account, start a model, or change Hermes.</p>
          <Button className="min-h-11 w-full" disabled={!profile || saving || guest || readOnly} onClick={() => void selectMemory()}>{saving ? <LoaderCircle className="animate-spin"/> : <Database/>}{saving ? 'Saving selection…' : profile?.mem0 ? 'Disable for new Pi sessions' : 'Enable for new Pi sessions'}</Button>
          {notice && <p role="status" className="text-sm leading-6">{notice}</p>}{error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button variant="outline" className="mt-3 min-h-11" disabled={loading} onClick={() => void refresh()}>Refresh saved selection</Button></div>}
          <p className="text-xs leading-5 text-muted-foreground">New launches read this saved choice. An explicit <code>--memory off</code> or <code>--memory mem0</code> overrides it for that session. Changing this choice does not delete notes or stop an existing session.</p>
        </div>}
        <p className="mt-5 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground"><BookOpen className="size-4 shrink-0"/>Configuration belongs to this Mac. Secret entry stays in the provider’s private setup.</p>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>
}
