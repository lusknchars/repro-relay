import { useState } from 'react'
import { Copy, Download, ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'
import { message } from '../lib/api'
import guideUrl from '../../../integrations/plow/README.md?url'

const launchCommand = 'open -b co.plow.domo-desktop'
// Plow Latch is a Mac application. Anything that does not report macOS is never
// told to open Latch on a Mac it may not have.
const mac = /\bMac/.test(navigator.userAgent)
// Tauri rejects a command with the plain string its Rust side returned, so the
// real reason survives instead of being replaced by a generic one.
const reason = (error: unknown) =>
  typeof error === 'string' && error.trim() ? error.trim() : message(error)

export function PlowConnection({ guest }: { guest: boolean }) {
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const desktop = '__TAURI_INTERNALS__' in window

  async function openLatch() {
    setOpening(true); setNotice(''); setError('')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_plow_latch')
      setNotice('Launch requested. Complete any setup in Plow Latch, then connect your Relay line below.')
    } catch (error) {
      // The native command says why. Off macOS, that reason is the whole answer.
      setError(`Could not open Plow Latch. ${reason(error)}`)
    } finally { setOpening(false) }
  }

  async function copyLaunch() {
    setNotice(''); setError('')
    try {
      await navigator.clipboard.writeText(launchCommand)
      setNotice('Launch command copied. Paste it into Terminal on the Mac where Latch is installed.')
    } catch {
      setError('Clipboard access is unavailable. Select and copy the launch command shown below.')
    }
  }

  async function downloadGuide() {
    setSaving(true); setNotice(''); setError('')
    try {
      const response = await fetch(guideUrl)
      if (!response.ok) throw new Error('Setup guide unavailable')
      const content = await response.text()
      const name = 'repro-relay-plow-setup.md'
      if (desktop) {
        const { invoke } = await import('@tauri-apps/api/core')
        if (await invoke<boolean>('save_packet', { content, name })) setNotice('Setup guide saved.')
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
        const link = document.createElement('a')
        link.href = url; link.download = name; document.body.append(link); link.click(); link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setNotice('Setup guide download started.')
      }
    } catch {
      setError('Could not save the setup guide. Try again or open the official Plow setup below.')
    } finally { setSaving(false) }
  }

  return <div className="space-y-5 text-sm">
    <p className="text-muted-foreground">Connect a Mac running Plow Latch and a Plow assistant line to bring phone reports into Relay and deliver approved updates.</p>
    {guest ? <p role="status">Plow connections belong to your local workspace. Open Repro Relay on your own computer to set up this integration.</p> : <>
      <section className="rounded-lg border border-border p-4 space-y-3" aria-labelledby="plow-mac-heading">
        <h3 id="plow-mac-heading" className="font-medium">1. Open Plow Latch on a Mac</h3>
        <p className="text-muted-foreground">{mac
          ? 'Finish the phone activation in Latch. If your Mac already shows Connected, continue to step 2.'
          : 'Plow Latch runs on macOS only, so step 1 needs a Mac with Latch installed. Step 2 and your Plow line work from this computer.'}</p>
        {desktop ? <Button onClick={() => void openLatch()} disabled={opening}>
          {opening ? <LoaderCircle className="animate-spin"/> : <ExternalLink/>}{opening ? 'Opening Plow Latch…' : 'Open Plow Latch'}
        </Button> : <>
          <p className="text-muted-foreground">Your browser cannot launch Latch directly. Run this command in Terminal on the Mac where Latch is installed.</p>
          <code className="block break-all rounded bg-muted p-3 select-text">{launchCommand}</code>
          <Button variant="outline" onClick={() => void copyLaunch()}><Copy/>Copy launch command</Button>
        </>}
      </section>
      <section className="rounded-lg border border-border p-4 space-y-3" aria-labelledby="plow-relay-heading">
        <h3 id="plow-relay-heading" className="font-medium">2. Connect the line to Relay</h3>
        <p className="text-muted-foreground">Authorize a free assistant line with Plow’s official tool, save its credential locally, and configure the Relay bridge. The guide includes the setup commands and a read-only connection check.</p>
        <Button variant="outline" className="h-auto min-h-9 whitespace-normal" onClick={() => void downloadGuide()} disabled={saving}><Download/>{saving ? 'Saving guide…' : 'Download Relay setup guide'}</Button>
        <p className="text-muted-foreground">Relay connection is not verified. Opening Latch does not connect a line or start an investigator.</p>
      </section>
    </>}
    <p role="status" aria-live="polite">{notice}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button variant="ghost" asChild><a href="https://github.com/plow-pbc/plow-agents#quickstart" target="_blank" rel="noopener noreferrer">Official Plow setup<ExternalLink/></a></Button>
  </div>
}
