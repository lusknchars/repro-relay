import manifest from './relay-tools.json'
import { request } from './api'
export { manifest }
export type ToolName = 'relay_workspace_status' | 'relay_list_work' | 'relay_inspect_work'
type Audit = { id: string; repository: string; revision: string; created_at: string; file_count: number; bytes: number; duplicate_bytes: number; files: unknown[]; proposal: { id: string; version: number; state: string; result: unknown } | null }
type Feed = { control: { repository: string | null; connected: boolean; paused: boolean; latest_scan: string | null; last_seen: string | null }; capabilities: unknown; mission: string; items: Audit[]; history_limit: number }
const policy = { source_writes: false, approvals: false, model_calls: false, external_messages: false }
function validate(name: string, input: unknown): Record<string, unknown> {
  const tool = manifest.find(t => t.name === name)
  if (!tool || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Unknown tool or invalid arguments.')
  const args = input as Record<string, unknown>
  for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties, key)) throw new Error(`Unexpected argument: ${key}`)
  for (const key of tool.inputSchema.required || []) if (!(key in args)) throw new Error(`Missing argument: ${key}`)
  if ('state' in args && (typeof args.state !== 'string' || !['all','review','accepted'].includes(args.state))) throw new Error('Invalid work state.')
  for (const [key, min, max] of [['limit',1,20],['file_limit',1,20],['file_offset',0,128]] as const) {
    if (key in args && (typeof args[key] !== 'number' || !Number.isInteger(args[key]) || Number(args[key]) < min || Number(args[key]) > max)) throw new Error(`Invalid ${key}.`)
  }
  if ('audit_id' in args && (typeof args.audit_id !== 'string' || args.audit_id.length > 100 || !/^SCAN-[a-zA-Z0-9_-]+$/.test(args.audit_id))) throw new Error('Invalid audit ID.')
  return args
}
function summary(item: Audit, latest: string | null) {
  return { id: item.id, repository: item.repository, revision: item.revision, created_at: item.created_at, file_count: item.file_count, state: item.proposal?.state || 'audit_complete', current_snapshot: item.id === latest }
}
export async function executeRelayTool(name: string, input: unknown, signal?: AbortSignal) {
  const args = validate(name, input)
  const feed = await request<Feed>('/autonomy', { signal })
  signal?.throwIfAborted()
  if (name === 'relay_workspace_status') return { schema_version: 1, repository: feed.control.repository, connected: feed.control.connected, paused: feed.control.paused, last_seen: feed.control.last_seen, mission: feed.mission, capabilities: feed.capabilities, tool_permissions: policy }
  if (name === 'relay_list_work') {
    const state = args.state || 'all'; const limit = Number(args.limit || 5)
    const found = feed.items.filter(i => state === 'all' || i.proposal?.state === (state === 'review' ? 'pending' : 'accepted'))
    return { schema_version: 1, items: found.slice(0, limit).map(i => summary(i, feed.control.latest_scan)), matching_in_recent_history: found.length, returned: Math.min(limit, found.length), history_limit: feed.history_limit }
  }
  const item = feed.items.find(i => i.id === args.audit_id)
  if (!item) throw new Error('Audit not found in the recent workspace history.')
  const offset = Number(args.file_offset || 0); const limit = Number(args.file_limit || 10)
  return { schema_version: 1, ...summary(item, feed.control.latest_scan), instruction_bytes: item.bytes, duplicate_bytes: item.duplicate_bytes, proposal: item.proposal, files: item.files.slice(offset, offset + limit), next_file_offset: offset + limit < item.files.length ? offset + limit : null, review_url: `/?view=sessions&audit=${encodeURIComponent(item.id)}`, interpretation: 'Recorded context diagnostics and storage evaluation. Not an independently verified code change or measured LLM token saving.', tool_permissions: policy }
}
