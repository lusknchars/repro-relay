import type { ComponentProps } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'
import './action-buttons.css'

export function DotExpandButton({ children, className, ...props }: Omit<ComponentProps<typeof Button>, 'variant' | 'asChild' | 'pending'>) {
  return <Button {...props} variant="secondary" className={cn('dot-expand-button', className)}>
    <span className="dot-expand-indicator" aria-hidden="true"><ArrowRight /></span>
    <span>{children}</span>
  </Button>
}
