import { useId, useState } from 'react'
import { Check, Copy, ExternalLink, Terminal } from 'lucide-react'
import { Button } from './ui/button'

export function TerminalHarnessSetup({ guest = false }: { guest?: boolean }) {
  const id = useId()
  const [harness, setHarness] = useState('pi')
  const [copied, setCopied] = useState('')
  const [error, setError] = useState('')
  const command = harness === 'pi' ? './relay pi start' : 'python3 integrations/relay-tools/connect.py'
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(value); setError('') }
    catch { setError('Clipboard is unavailable. Select the command to copy it.') }
  }
  function copyButton(value: string, label: string) {
    return <Button variant="outline" className="min-h-11" disabled={guest} onClick={() => void copy(value)}>
      {copied === value ? <Check aria-hidden="true"/> : <Copy aria-hidden="true"/>}{copied === value ? 'Copied' : label}
    </Button>
  }
  return <section className="relay-card rounded-lg border p-4" aria-label="Terminal agent setup">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium"><Terminal className="size-4"/>Terminal agent</h3>
      <label className="flex items-center gap-2 text-xs" htmlFor={id}>Harness
        <select id={id} value={harness} onChange={event => { setHarness(event.target.value); setCopied(''); setError('') }} className="min-h-11 rounded-md border bg-background px-3 text-sm">
          <option value="pi">Pi</option><option value="codex">Codex</option>
        </select>
      </label>
    </div>
    <p className="text-muted-foreground my-3 text-sm leading-6">{harness === 'pi'
      ? 'Review the latest context audit with Pi. Relay supplies the evidence and the review task.'
      : 'Add Relay evidence tools to your project’s Codex configuration. Open a new Codex session after setup.'}</p>
    <code className="mb-3 block break-all rounded bg-muted p-3 text-xs">{command}</code>
    {copyButton(command, harness === 'pi' ? 'Copy Pi launch command' : 'Copy Codex setup command')}
    <p className="text-muted-foreground mt-2 text-xs">{guest ? 'Local setup is unavailable in a guest workspace.' : 'Run from the Repro Relay repository.'}</p>
    {harness === 'pi' ? <>
      <ol className="my-4 space-y-3 border-t pt-4 text-xs leading-5">
        <li><strong className="font-medium">Setup.</strong> <a className="underline underline-offset-4" href="https://pi.dev" target="_blank" rel="noreferrer">Install Pi<ExternalLink className="ml-1 inline size-3"/></a> if needed, then sign in with <code>/login</code>.</li>
        <li><strong className="font-medium">Inspect.</strong> <code>/relay</code> opens the latest audit. No model call.</li>
        <li><strong className="font-medium">Review.</strong> <code>/relay-review</code> asks your model to assess it. Approvals stay in Relay.</li>
      </ol>
      <details className="rounded-md border p-3 text-xs">
        <summary className="cursor-pointer font-medium">Connection check and session details</summary>
        <code className="my-3 block break-all rounded bg-muted p-3">./relay pi doctor</code>
        {copyButton('./relay pi doctor', 'Copy Pi check command')}
        <p className="text-muted-foreground mt-3 leading-5">The check reports Pi’s installed version and Relay’s connection. It does not validate provider sign-in or start a model.</p>
        <p className="text-muted-foreground mt-3 leading-5">Continue with <code>./relay pi start --resume</code>. Pi shows usage and cost in its own session; these are separate from Hermes charts.</p>
        <p className="text-muted-foreground mt-3 leading-5">Choose a provider and model with <code>/model</code>. This session reads recorded context evidence. Code editing, test execution and Hermes dispatch are not connected to Pi.</p>
      </details>
    </> : <p className="text-muted-foreground mt-4 text-xs leading-5">Setup checks the local API and writes project-scoped MCP settings. Existing configuration is preserved. These tools read evidence and do not launch an agent.</p>}
    <details className="mt-4 border-t pt-4">
      <summary className="cursor-pointer text-sm font-medium">Hermes investigation controls</summary>
      <p className="text-muted-foreground my-3 text-xs leading-5">Inspect cases, watch Hermes, and prepare a Git worktree for an approved repair. Check the local runtime connection first.</p>
      <code className="mb-3 block rounded bg-muted p-3 text-xs">./relay doctor</code>
      {copyButton('./relay doctor', 'Copy terminal command')}
      <p className="text-muted-foreground mt-3 text-xs">Run <code>./relay --help</code> for commands. A prepared checkout does not start an agent.</p>
    </details>
    {error && <p role="alert" className="text-destructive mt-3 text-sm">{error}</p>}
    <span className="sr-only" role="status">{copied && `Copied ${copied}`}</span>
  </section>
}
