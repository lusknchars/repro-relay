import { ArrowRight, ClipboardList } from 'lucide-react'
import { Card, CardContent } from './ui/card'
import { Button } from './ui/button'
import { caseGuidance } from '../lib/workspace-guidance'
import type { Case, CaseStatus } from '../types'

const queues: CaseStatus[] = ['new', 'needs_context', 'blocked', 'reproduced']
export function InvestigationDesk({ cases, triage }: { cases: Case[]; triage: (status: string) => void }) {
  return <Card className="mt-5" role="region" aria-label="Investigation desk">
    <CardContent>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl"><p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><ClipboardList className="size-4" aria-hidden="true"/>INVESTIGATION DESK</p>
          <h2 className="text-xl font-medium">What needs attention?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Start with a reported problem. Inspect what happened, compare the evidence, and decide what needs another check.</p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => triage('all')}>Triage all cases<ArrowRight/></Button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{queues.map(status => {
        const guidance = caseGuidance[status]
        const count = cases.filter(item => item.status === status).length
        return <button key={status} onClick={() => triage(status)} className="relay-card relay-card-action flex min-h-32 flex-col items-start gap-2 rounded-lg border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label={`${guidance.label}: ${count} ${count === 1 ? 'case' : 'cases'}`}>
          <span className="flex w-full items-center justify-between gap-3 text-sm font-medium">{guidance.label}<ArrowRight className="size-4" aria-hidden="true"/></span>
          <strong className="text-2xl tabular-nums">{count}</strong><span className="text-xs leading-5 text-muted-foreground">{guidance.next}</span>
        </button>
      })}</div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">These are recorded case statuses. A reproduction is evidence to review, not confirmation that a fix passed.</p>
    </CardContent>
  </Card>
}
