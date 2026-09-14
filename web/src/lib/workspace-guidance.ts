import type { CaseStatus } from '../types'
import type { View } from '../components/templates/ultimate-dashboard/layouts'

export const workspaceGuidance: Record<View, { short: string; purpose: string }> = {
  overview: { short: 'What needs attention', purpose: 'See which reports need evidence and pick up the next investigation.' },
  inbox: { short: 'Triage reported problems', purpose: 'Compare report status, inspect the evidence, and open the investigation for a case.' },
  agents: { short: 'Findings, tests and usage', purpose: 'Follow one case from the reported problem to findings, test evidence, and your review.' },
  sessions: { short: 'Automatic context checks', purpose: 'Follow repository context checks and review completed proposals. The monitor does not perform code repairs.' },
  memory: { short: 'Reuse reviewed evidence', purpose: 'Keep useful observations available to later investigations, with their sources attached.' },
  handoffs: { short: 'Pass on the case history', purpose: 'Review saved case snapshots before passing work to the next person or agent.' },
  connections: { short: 'Set up local tools', purpose: 'Check what is connected and finish setup for your local investigation workspace.' },
}

export const caseGuidance: Record<CaseStatus, { label: string; next: string }> = {
  new: { label: 'New report', next: 'Inspect the report and collect a first observation.' },
  needs_context: { label: 'Needs context', next: 'Check what is missing before another attempt.' },
  blocked: { label: 'Blocked', next: 'Inspect the obstacle recorded in the latest observation.' },
  reproduced: { label: 'Reproduced', next: 'Review the reproduction evidence before preparing a repair.' },
  not_reproduced: { label: 'Not reproduced', next: 'Compare the build and test conditions with the report.' },
}
