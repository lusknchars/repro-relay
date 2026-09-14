import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'

const executeFile = promisify(execFile)
const directory = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(directory, '../../web/src/lib/relay-tools.json'), 'utf8')) as {
  name: string; title: string; description: string; inputSchema: TSchema
}[]
const api = process.env.RELAY_PI_API || 'http://127.0.0.1:8178/api/v1'

async function call(name: string, args: unknown, signal?: AbortSignal) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.')
  const { stdout } = await executeFile(process.env.RELAY_PI_PYTHON || 'python3',
    [resolve(directory, 'bridge.py'), api, name, JSON.stringify(args)],
    { signal, timeout: 15_000, maxBuffer: 256 * 1024, encoding: 'utf8' })
  return JSON.parse(stdout)
}

export default function relay(pi: ExtensionAPI) {
  for (const tool of manifest) {
    pi.registerTool({
      name: tool.name, label: tool.title, description: tool.description,
      parameters: tool.inputSchema,
      async execute(_id, params, signal) {
        try {
          const data = await call(tool.name, params, signal)
          return { content: [{ type: 'text', text: JSON.stringify(data) }], details: data }
        } catch {
          throw new Error('Relay evidence is unavailable. Run /relay to check the local connection.')
        }
      },
    })
  }

  const setConnection = async (ctx: ExtensionContext) => {
    try {
      const state = await call('relay_workspace_status', {})
      ctx.ui.setStatus('relay', `Relay evidence connected · monitor ${state.connected ? state.paused ? 'paused' : 'connected' : 'offline'}`)
      return state
    } catch {
      ctx.ui.setStatus('relay', 'Relay evidence offline')
      throw new Error('Relay is unavailable. Start make dev, then try /relay again.')
    }
  }
  pi.on('session_start', async (_event, ctx) => {
    try { await setConnection(ctx) } catch { /* Offline is shown in the status line. */ }
    ctx.ui.setWidget('relay', ['Repro Relay · Pi evidence review', '/relay  Inspect latest audit · /relay-review  Ask your model to review', 'Approvals stay in Relay. Token usage and cost appear in the Pi footer.'])
  })

  // Slash commands work without constructing a prompt or calling a model for navigation.
  let reading = false
  const latest = async (ctx: ExtensionContext, review: boolean) => {
    if (reading || !ctx.isIdle()) {
      ctx.ui.notify('Wait for the current review to finish.', 'info')
      return
    }
    reading = true
    try {
      const state = await setConnection(ctx)
      const list = await call('relay_list_work', { limit: 1 })
      const item = list.items[0]
      if (!item) {
        pi.sendMessage({ customType: 'relay-evidence', content: 'No recorded context audit yet. Open Autonomous work in Relay and check the repository monitor.', display: true }, { triggerTurn: false })
        return
      }
      const detail = await call('relay_inspect_work', { audit_id: item.id, file_limit: 5 })
      const evidence = JSON.stringify({ workspace: state, audit: detail })
      const reviewUrl = new URL(detail.review_url, api).href
      pi.sendMessage({ customType: 'relay-evidence', content: `Recorded audit ${item.id}\nReview in Relay: ${reviewUrl}\n\n${evidence}`, display: true }, { triggerTurn: false })
      if (review) {
        pi.sendUserMessage('Review the recorded Relay audit above for context quality and avoidable duplication. Explain what the evidence supports, what remains unverified, and the next decision. Include its review link. Do not call storage bytes token savings. Fetch more evidence only if needed.')
      }
    } catch {
      ctx.ui.notify('Could not read the latest audit. Check ./relay pi doctor and try again.', 'error')
    } finally { reading = false }
  }
  pi.registerCommand('relay', { description: 'Inspect the latest Relay audit without a model call', handler: async (_args, ctx) => latest(ctx, false) })
  pi.registerCommand('relay-review', { description: 'Ask the selected Pi model to review the latest Relay audit', handler: async (_args, ctx) => latest(ctx, true) })
}
