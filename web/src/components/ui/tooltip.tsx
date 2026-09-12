// Adapted from shadcn/ui's MIT-licensed Radix registry. See THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from 'react'
import { Tooltip as Primitive } from 'radix-ui'
import { cn } from '@/lib/utils'

export function TooltipProvider(props: ComponentProps<typeof Primitive.Provider>) {
  return <Primitive.Provider delayDuration={400} {...props}/>
}
export const Tooltip = Primitive.Root
export const TooltipTrigger = Primitive.Trigger
export function TooltipContent({className, sideOffset = 6, children, ...props}: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="tooltip-content" sideOffset={sideOffset} className={cn('shortcut-tooltip', className)} {...props}>
    {children}<Primitive.Arrow className="tooltip-arrow"/>
  </Primitive.Content></Primitive.Portal>
}
