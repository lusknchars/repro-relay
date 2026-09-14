import type { InvestigationRun } from '../types'
import { runLabels } from '../lib/investigation'
import { Button } from './ui/button'

function workType(run: InvestigationRun) {
  const context = run.context as { repair_contract?: { stage?: string } } | null
  const stage = context?.repair_contract?.stage
  return stage === 'repair' ? 'Approved code repair' : stage === 'verification' ? 'Protected test verification' : 'Bug investigation'
}

export function CurrentWork({ loaded, error, runner, active, selected, guest, pendingStart, showActive }: {
  loaded: boolean; error: string; runner: { available: boolean; reason: string } | null;
  active?: InvestigationRun; selected?: InvestigationRun; guest: boolean; pendingStart: boolean; showActive: () => void;
}) {
  const title = error ? 'Current activity could not be checked'
    : pendingStart ? 'Start request not yet confirmed'
    : !loaded ? 'Checking current activity…'
    : active ? `${workType(active)} · ${active.status === 'running' ? 'In progress' : runLabels[active.status] || 'Status needs checking'}`
    : guest ? 'Viewing saved work'
    : !runner ? 'Checking the Hermes connection…'
    : !runner.available ? 'Hermes is not connected'
    : 'Hermes is idle for this case'
  const detail = error ? 'The last saved result is still below. Reconnecting automatically; its status may have changed.'
    : pendingStart ? 'Relay has not confirmed whether work started. Keep this request and use its retry action to check the saved outcome.'
    : !loaded ? 'Reading the saved run state before showing what is happening.'
    : active ? active.detail
    : guest ? 'This guest workspace cannot start an investigation.'
    : runner?.available ? 'No investigation or repair is running for this case. Starting work uses the report and evidence already saved.'
    : 'No active work is recorded for this case. Saved results below do not mean Hermes is investigating your code now.'
  return <section aria-label="Current Hermes activity">
    <p className="iw-eyebrow">NOW · THIS CASE</p>
    <div aria-live="polite" aria-atomic="true"><h3>{title}</h3><p>{detail}</p></div>
    {loaded && !error && active && active.id !== selected?.id && <Button className="mt-3" variant="outline" onClick={showActive}>View active work</Button>}
    {selected && <p className="iw-caption">Viewing {selected.execution_kind === 'local_validation' ? 'a saved local validation record, not a Hermes investigation' : active?.id === selected.id ? 'the active run' : 'a saved Hermes result'}. {selected.execution_kind !== 'local_validation' && workType(selected) === 'Bug investigation' ? 'Investigation mode does not authorize code edits.' : ''}</p>}
  </section>
}
