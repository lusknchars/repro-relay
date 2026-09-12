import { apiBase } from './api'

export type ReviewDecision = 'accepted' | 'needs_changes' | 'dismissed'
export type RunReview = {
  id: string; case_id: string; run_id: string; case_revision: number; owner_version: number;
  build: string; run_version: number; reviewer: string; reviewer_identity: 'locally_supplied';
  decision: ReviewDecision; feedback: string; created_at: string;
}
export type InvestigationPreview = {
  context: unknown; context_hash: string; case_revision: number; owner_version: number;
  build: string; follow_up_review_id: string | null;
}
export type ReviewDraft = { reviewer: string; decision: ReviewDecision; feedback: string }
export type PendingInvestigationRequest = { key: string; path: string; body: string; kind: 'start' | 'review'; label: string }

export class InvestigationRequestError extends Error {
  status: number
  constructor(detail: string, status: number) { super(detail); this.status = status }
}

// Keep the exact body and key after an uncertain response; retrying must not create another run or review.
export async function submitInvestigationRequest<T>(pending: PendingInvestigationRequest): Promise<T> {
  const response = await fetch(`${apiBase}${pending.path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key }, body: pending.body,
  })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const detail = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
      ? data.detail : 'The request could not be completed.'
    throw new InvestigationRequestError(detail, response.status)
  }
  return response.json() as Promise<T>
}

export const runLabels: Record<string, string> = {
  queued: 'Queued', dispatching: 'Submitting to Hermes', running: 'Investigating',
  waiting_for_approval: 'Approval needed in Hermes', stopping: 'Waiting for stop confirmation',
  completed: 'Result ready for review', failed: 'Failed', cancelled: 'Stopped', attention: 'Needs reconciliation',
}
export const reviewLabels: Record<ReviewDecision, string> = {
  accepted: 'Review accepted', needs_changes: 'Needs another check', dismissed: 'Proposal dismissed',
}
export const isRunActive = (status: string) => !['completed', 'failed', 'cancelled'].includes(status)
