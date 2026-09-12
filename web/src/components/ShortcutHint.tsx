import type { ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { Kbd } from './ui/kbd'

export function ShortcutHint({label, keys, children}: {label: string; keys: string; children: ReactElement}) {
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>{label}<Kbd>{modifier} {keys}</Kbd></TooltipContent>
  </Tooltip>
}
