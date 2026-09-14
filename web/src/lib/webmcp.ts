import { useEffect, useState } from 'react'
import { executeRelayTool, manifest } from './relay-tools'
export type BrowserToolsState = 'disabled' | 'unsupported' | 'registering' | 'ready' | 'error'
type ModelContext = {
  registerTool: (tool: object, options?: { signal: AbortSignal }) => void | Promise<void>
  unregisterTool?: (name: string) => void
}
export function useRelayWebMCP(enabled: boolean) {
  const [state, setState] = useState<BrowserToolsState>('disabled')
  useEffect(() => {
    if (!enabled) { setState('disabled'); return }
    // Current draft uses Document; older browser previews used Navigator.
    const current = (document as Document & { modelContext?: ModelContext }).modelContext
    const legacy = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
    const context = current || legacy
    if (!context || typeof context.registerTool !== 'function' || (!current && typeof context.unregisterTool !== 'function')) { setState('unsupported'); return }
    const owner = new AbortController(); const registered: string[] = []
    setState('registering')
    async function register() {
      try {
        for (const definition of manifest) {
          if (owner.signal.aborted) return
          const { readOnlyHint, untrustedContentHint } = definition.annotations
          const registration = context!.registerTool({ ...definition, annotations: { readOnlyHint, untrustedContentHint }, execute: async (args: unknown, options?: { signal?: AbortSignal }) => {
            owner.signal.throwIfAborted()
            const abort = new AbortController()
            const cancel = () => abort.abort()
            owner.signal.addEventListener('abort', cancel, { once: true })
            options?.signal?.addEventListener('abort', cancel, { once: true })
            if (options?.signal?.aborted) abort.abort()
            try { return await executeRelayTool(definition.name, args, abort.signal) }
            finally { owner.signal.removeEventListener('abort', cancel); options?.signal?.removeEventListener('abort', cancel) }
          } }, { signal: owner.signal })
          if (!current) registered.push(definition.name)
          await registration
        }
        if (!owner.signal.aborted) setState('ready')
      } catch {
        if (!owner.signal.aborted) { setState('error'); owner.abort(); if (!current) for (const name of registered) context!.unregisterTool?.(name) }
      }
    }
    void register()
    return () => { owner.abort(); if (!current) for (const name of registered) context.unregisterTool?.(name) }
  }, [enabled])
  return state
}
