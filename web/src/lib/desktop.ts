import { useEffect } from 'react'

export type WorkspaceCommand = 'new-report' | 'find-case' | 'connections'

export function useWorkspaceCommands(handle: (command: WorkspaceCommand) => void) {
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    if ('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/event').then(({listen}) => listen<WorkspaceCommand>('workspace-command', event => {
        if (!disposed) handle(event.payload)
      })).then(stop => { if (disposed) stop(); else unlisten = stop })
        .catch(() => { /* The interface remains usable if native events are unavailable. */ })
    }
    const onKey = (event: KeyboardEvent) => {
      if ('__TAURI_INTERNALS__' in window || event.repeat || !(event.metaKey || event.ctrlKey) || event.altKey) return
      const command = event.key.toLowerCase() === 'k' ? 'find-case'
        : event.key.toLowerCase() === 'n' && event.shiftKey ? 'new-report'
        : event.key === ',' ? 'connections' : null
      if (command) { event.preventDefault(); handle(command) }
    }
    window.addEventListener('keydown', onKey)
    return () => { disposed = true; unlisten?.(); window.removeEventListener('keydown', onKey) }
  }, [handle])
}
