import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Compass, Copy, Globe, Terminal } from 'lucide-react'
import { Button } from './ui/button'
import { DotExpandButton } from './ui/dot-expand-button'
import type { View } from './templates/ultimate-dashboard/layouts'
import type { BrowserToolsState } from '../lib/webmcp'
import { executeRelayTool, manifest } from '../lib/relay-tools'

type Props = { navigate: (view: View) => void; browserTools: BrowserToolsState; guest?: boolean; connections?: boolean }
const status: Record<BrowserToolsState, string> = { disabled: 'Local workspace required', unsupported: 'Not available in this browser', registering: 'Registering tools…', ready: '3 browser tools registered', error: 'Browser tool registration failed' }
export function WorkspaceGuide({ navigate, browserTools, guest, connections = false }: Props) {
  const [copied, setCopied] = useState(''); const [error, setError] = useState('')
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); setError('') }
    catch { setError('Clipboard access is unavailable. Select the command to copy it.') }
  }
  const [recipe, setRecipe] = useState<{ id: string; state: string; files: number; elapsed: number } | null>(null)
  const [step, setStep] = useState(''); const [running, setRunning] = useState(false)
  const recipeAbort = useRef<AbortController | null>(null)
  useEffect(() => () => { recipeAbort.current?.abort(); recipeAbort.current = null }, [])
  async function runRecipe() {
    if (recipeAbort.current) return
    const controller = new AbortController(); recipeAbort.current = controller
    const timeout = setTimeout(() => controller.abort(), 30000)
    const started = performance.now(); setRunning(true); setRecipe(null); setError(''); setStep('Checking the workspace')
    try {
      await executeRelayTool('relay_workspace_status', {}, controller.signal)
      setStep('Finding recorded work')
      const listed = await executeRelayTool('relay_list_work', { limit: 1 }, controller.signal)
      const item = 'items' in listed ? listed.items?.[0] : undefined
      if (!item) { setStep('No work recorded yet. Open Autonomous work to check the monitor.'); return }
      setStep('Inspecting revision and evidence')
      const detail = await executeRelayTool('relay_inspect_work', { audit_id: item.id }, controller.signal)
      if ('file_count' in detail) setRecipe({ id: detail.id, state: detail.state, files: detail.file_count, elapsed: Math.round(performance.now() - started) })
      setStep('Evidence ready for review')
    } catch { if (!controller.signal.aborted) setError('The recipe could not read the workspace. Check the local API connection.'); else if (recipeAbort.current === controller) setError('The recipe stopped before it finished. Try again when the workspace is available.') }
    finally { clearTimeout(timeout); if (recipeAbort.current === controller) { recipeAbort.current = null; setRunning(false) } }
  }
  const terminalCommand = 'python3 integrations/relay-tools/connect.py'
  return <section className="relay-card my-5 rounded-xl border bg-card p-5 sm:p-6" aria-label={connections ? 'Agent tool connections' : 'Workspace guide'}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs"><Compass className="size-4"/>YOUR WORKSPACE</div><h2 className="text-xl font-medium">{connections ? 'Bring Relay evidence into your agent.' : 'See what ran. Understand what needs you.'}</h2><p className="text-muted-foreground mt-2 text-sm leading-6">{connections ? 'Connect a terminal agent once, or use the browser tools where WebMCP is supported. Both read the same recorded work.' : 'Follow repository activity, inspect the result, and make a decision after the evaluation is complete. No task prompt is needed for the connected context audit.'}</p></div>{!connections && <DotExpandButton onClick={() => navigate('connections')}>Connect tools</DotExpandButton>}</div>
    {!connections && <div className="mt-5 grid gap-3 md:grid-cols-3">{[
      { title: '1. Follow the work', body: 'Open the monitor to see collected audits, current activity, and connection status.', action: 'Open autonomous work', view: 'sessions' as View },
      { title: '2. Review the evidence', body: 'A completed candidate shows its source revision and measured result before you approve or decline.', action: 'Review candidates', view: 'sessions' as View },
      { title: '3. Keep useful context', body: 'Review saved findings and their source history before another investigation uses them.', action: 'Open project memory', view: 'memory' as View },
    ].map(step => <div className="relay-card relay-card-action flex flex-col gap-3 rounded-lg border p-4" key={step.title}><h3 className="text-sm font-medium">{step.title}</h3><p className="text-muted-foreground flex-1 text-xs leading-5">{step.body}</p><DotExpandButton className="justify-start" onClick={() => navigate(step.view)}>{step.action}</DotExpandButton></div>)}</div>}
    {connections && <div className="mt-5 grid gap-5 lg:grid-cols-2"><section className="relay-card rounded-lg border p-4"><h3 className="flex items-center gap-2 text-sm font-medium"><Terminal className="size-4"/>Terminal tools</h3><p className="text-muted-foreground my-3 text-xs leading-5">Run this once from the Repro Relay repository to connect the installed Codex CLI. It checks the local API and adds project-scoped MCP settings. Global settings and existing project configuration stay intact; no agent is launched.</p><code className="block break-all rounded bg-muted p-3 text-xs">{terminalCommand}</code><Button className="mt-3 min-h-11" variant="outline" disabled={guest} onClick={() => void copy(terminalCommand, 'terminal')} >{copied === 'terminal' ? <Check/> : <Copy/>}{copied === 'terminal' ? 'Copied' : 'Copy setup command'}</Button><p className="text-muted-foreground mt-3 text-xs">These MCP tools read evidence. For investigation and repair controls, use the local CLI below.</p><div className="mt-4 border-t pt-4"><h4 className="text-sm font-medium">Investigate from your terminal</h4><p className="text-muted-foreground my-3 text-xs leading-5">Inspect cases, watch Hermes, and prepare a Git worktree for an approved repair. Check the local connection first.</p><code className="block rounded bg-muted p-3 text-xs">./relay doctor</code><Button className="mt-3 min-h-11" variant="outline" disabled={guest} onClick={() => void copy('./relay doctor', 'local-terminal')}>{copied === 'local-terminal' ? <Check/> : <Copy/>}{copied === 'local-terminal' ? 'Terminal command copied' : 'Copy terminal command'}</Button><p className="text-muted-foreground mt-3 text-xs">Run <code>./relay --help</code> for commands. Code correction requires a configured repair runtime; preparing a checkout does not start an agent.</p></div></section><section className="relay-card rounded-lg border p-4"><h3 className="flex items-center gap-2 text-sm font-medium"><Globe className="size-4"/>WebMCP browser tools</h3><p className="my-3 text-xs" role="status">{status[browserTools]}</p><p className="text-muted-foreground text-xs leading-5">A compatible browser agent can inspect Relay directly. Browser support is detected at runtime; the regular interface remains available.</p><ul className="mt-3 space-y-2">{manifest.map(t => <li key={t.name} className="text-xs"><code className="break-all">{t.name}</code></li>)}</ul><p className="text-muted-foreground mt-3 text-xs">Tools cannot approve, edit code, change policy, or send messages.</p></section></div>}
    <details className="mt-5 rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Recipe: inspect evidence and bring back a decision</summary><ol className="text-muted-foreground mt-4 list-decimal space-y-3 pl-5 text-sm leading-6"><li>Check the repository connection and the capabilities currently available.</li><li>List recorded work. Select a completed candidate awaiting review, when one exists.</li><li>Inspect its exact revision, measured result, and source hashes. Request more evidence only when needed.</li><li>Show the result and its review link to the user. Keep approvals in the application.</li></ol><p className="text-muted-foreground mt-4 text-xs">Current recipe scope: context diagnostics and storage evaluation. Code repairs, browser reproduction, and LLM cost comparisons still need an execution adapter.</p></details>
    {connections && <div className="mt-4 rounded-lg bg-muted/50 p-4"><div className="flex flex-wrap items-center gap-3"><Button disabled={guest || running} pending={running} onClick={() => void runRecipe()}>Run evidence recipe<ArrowRight/></Button><span className="text-muted-foreground text-xs" role="status">{step || 'Try the structured tools on your recorded work. No model call is needed.'}</span></div>{recipe && <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm">{recipe.files} source files · {recipe.state.replaceAll('_', ' ')}<span className="text-muted-foreground block pt-1 text-xs">3 read-only tool calls · {recipe.elapsed} ms · 0 model calls</span></p><Button variant="outline" asChild><a href={`/?view=sessions&audit=${encodeURIComponent(recipe.id)}`}>Open this evidence<ArrowRight/></a></Button></div>}</div>}
    {error && <p className="text-destructive mt-3 text-sm" role="alert">{error}</p>}
  </section>
}
