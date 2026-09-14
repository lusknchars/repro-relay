import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Button } from './button'
import { cn } from '@/lib/utils'
import './action-buttons.css'

export type ApprovalState = 'neutral' | 'loading' | 'success' | 'error'
type Props = Omit<ComponentProps<typeof Button>, 'children' | 'pending' | 'asChild'> & {
  state: ApprovalState
  label: string
  successLabel?: string
  errorLabel?: string
}

// The caller owns the request and its confirmed outcome. No timers simulate success.
export function ApprovalButton({ state, label, successLabel = 'Saved', errorLabel = 'Could not confirm. Check the details before retrying.', disabled, className, ...props }: Props) {
  const reduced = useReducedMotion()
  const status = state === 'loading' ? 'Saving…' : state === 'success' ? successLabel : state === 'error' ? errorLabel : ''
  const Icon = state === 'loading' ? LoaderCircle : state === 'success' ? Check : X
  return <>
    <Button {...props} className={cn('approval-button', className)} data-approval-state={state}
      disabled={disabled || state === 'loading' || state === 'success'} pending={state === 'loading'}
      aria-label={label} title={status || label}>
      <motion.span aria-hidden="true" className="approval-label" initial={false}
        animate={{ y: reduced || state === 'neutral' ? 0 : 6, opacity: state === 'neutral' ? 1 : 0 }} transition={{ duration: reduced ? 0 : .16 }}>{label}</motion.span>
      <AnimatePresence initial={false}>
        {state !== 'neutral' && <motion.span key={state} aria-hidden="true" className="approval-overlay"
          initial={{ y: reduced ? 0 : -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reduced ? 0 : 12, opacity: 0 }}
          transition={{ duration: reduced ? 0 : .18 }}><Icon className={state === 'loading' ? 'approval-spinner' : ''} /></motion.span>}
      </AnimatePresence>
    </Button>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{status ? `${label}: ${status}` : ''}</span>
  </>
}
