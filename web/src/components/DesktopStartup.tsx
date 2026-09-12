import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, GitBranch, Monitor, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { ThemeToggle } from './ThemeToggle'
import { request } from '../lib/api'
import { useTransition } from '../lib/motion'

export function DesktopStartup({ children }: { children: ReactNode }) {
  const desktop = '__TAURI_INTERNALS__' in window
  const [state, setState] = useState<'checking' | 'offline' | 'ready'>(desktop ? 'checking' : 'ready')
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const copyGeneration = useRef(0)
  const panel = useTransition<HTMLDivElement>([state])

  useEffect(() => {
    if (!desktop) return
    const abort = new AbortController()
    let disposed = false
    const timeout = setTimeout(() => abort.abort(), 4000)
    request<{status: string; mode: string}>('/health', {signal: abort.signal})
      .then(value => { if (!disposed) setState(value.status === 'ok' && value.mode === 'local' ? 'ready' : 'offline') })
      .catch(() => { if (!disposed) setState('offline') })
      .finally(() => clearTimeout(timeout))
    return () => { disposed = true; abort.abort(); clearTimeout(timeout); copyGeneration.current++ }
  }, [desktop, attempt])

  async function copy() {
    const generation = ++copyGeneration.current
    try {
      await navigator.clipboard.writeText('make db\nmake api')
      if (generation === copyGeneration.current) { setCopied(true); setCopyError('') }
    } catch { if (generation === copyGeneration.current) setCopyError('Copy is unavailable. Select the commands below and copy them manually.') }
  }

  if (state === 'ready') return children
  return <main className="desktop-startup">
    <header><span className="desktop-wordmark"><GitBranch size={23}/>reprorelay</span><ThemeToggle/></header>
    <div ref={panel} className="desktop-startup-card">
      <span className="desktop-eyebrow"><Monitor size={16}/>Desktop workspace</span>
      <h1>{state === 'checking' ? 'Opening your workspace.' : 'Connect your local workspace.'}</h1>
      <p role="status">{state === 'checking' ? 'Checking the workspace service on this Mac…' : 'The desktop app is ready. Its local workspace service is not available yet.'}</p>
      {state === 'offline' && <>
        <ol className="desktop-setup"><li>Open a terminal in your Repro Relay checkout.</li><li>Start PostgreSQL and the workspace service.</li></ol>
        <div className="desktop-command"><pre>make db{'\n'}make api</pre><Button variant="ghost" size="sm" onClick={()=>void copy()}>{copied && <Check/>}{copied ? 'Copied' : 'Copy commands'}</Button></div>
        <p className="desktop-setup-note">First time running the project? Run <code>make setup</code> before these commands. Node, Rust, Docker, and PostgreSQL client tools are required.</p>
        <Button onClick={()=>{setState('checking');setAttempt(value=>value+1)}}><RefreshCw/>Check connection</Button>
        {copyError && <p role="alert">{copyError}</p>}
        <small>Connects to 127.0.0.1:8178. The service and database run separately from this app.</small>
      </>}
    </div>
    <footer>Reports, evidence, and investigation history in one workspace.</footer>
  </main>
}
