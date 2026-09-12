// Adapted from shadcn/ui's MIT-licensed registry. See THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Kbd({className, ...props}: ComponentProps<'kbd'>) {
  return <kbd data-slot="kbd" className={cn('shortcut-key', className)} {...props}/>
}
