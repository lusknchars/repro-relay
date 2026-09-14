// Adapted from the user-supplied reptest prototype. Uses Relay's existing theme and Radix controls.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { MotionConfig } from 'motion/react'
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../ui/button'
import { ThemeToggle } from '../ThemeToggle'

type Preferences = { accent: 'blue' | 'teal' | 'violet'; radius: number; density: 'comfortable' | 'compact'; text: number; layout: 'full' | 'centered'; sidebar: 'sidebar' | 'floating' | 'inset'; collapsed: boolean; motion: boolean; ambient: boolean }
const defaults: Preferences = { accent: 'blue', radius: 8, density: 'comfortable', text: 100, layout: 'full', sidebar: 'sidebar', collapsed: false, motion: true, ambient: true }
const key = 'relay-appearance-v1'
function load(): Preferences {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '{}')
    return { accent: ['blue','teal','violet'].includes(v.accent) ? v.accent : 'blue', radius: [4,8,12].includes(v.radius) ? v.radius : 8, density: v.density === 'compact' ? 'compact' : 'comfortable', text: [100,110,120].includes(v.text) ? v.text : 100, layout: v.layout === 'centered' ? 'centered' : 'full', sidebar: ['sidebar','floating','inset'].includes(v.sidebar) ? v.sidebar : 'sidebar', collapsed: v.collapsed === true, motion: v.motion !== false, ambient: v.ambient !== false }
  } catch { return defaults }
}
const Context = createContext<{ preferences: Preferences; set: (patch: Partial<Preferences>) => void; reset: () => void }>({ preferences: defaults, set: () => {}, reset: () => {} })
export const useAppearance = () => useContext(Context)
export function AppearanceProvider({children}: {children: ReactNode}) {
  const [preferences, update] = useState(load)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.accent = preferences.accent; root.dataset.density = preferences.density; root.dataset.motion = preferences.motion ? 'system' : 'reduce'
    root.style.setProperty('--relay-radius', `${preferences.radius}px`)
    root.style.setProperty('--relay-font-scale', `${preferences.text}%`)
    root.style.setProperty('--relay-content-max', preferences.layout === 'centered' ? '1280px' : '100%')
    try { localStorage.setItem(key, JSON.stringify(preferences)) } catch { /* Session settings still apply. */ }
  }, [preferences])
  const value = useMemo(() => ({ preferences, set: (patch: Partial<Preferences>) => update(v => ({...v,...patch})), reset: () => update(defaults) }), [preferences])
  return <Context.Provider value={value}><MotionConfig reducedMotion={preferences.motion ? 'user' : 'always'}>{children}</MotionConfig></Context.Provider>
}
export function AppearanceControl() {
  const { preferences: p, set, reset } = useAppearance()
  return <Dialog.Root><Dialog.Trigger asChild><Button variant="ghost" size="icon" aria-label="Customize appearance"><SlidersHorizontal/></Button></Dialog.Trigger><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40"/>
    <Dialog.Content className="appearance-panel fixed inset-y-0 right-0 z-50 w-96 max-w-full overflow-y-auto border-l bg-background p-5 shadow-xl">
      <header className="flex items-start justify-between gap-3"><div><Dialog.Title className="text-lg font-semibold">Appearance</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">Saved in this browser on this device.</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close appearance"><X/></Button></Dialog.Close></header>
      <div className="mt-6 space-y-5">
        <div className="flex items-center justify-between border-b pb-4"><span className="text-sm font-medium">Color mode</span><ThemeToggle/></div>
        <label className="field"><span>Accent color</span><select value={p.accent} onChange={e => set({accent:e.target.value as Preferences['accent']})}><option value="blue">Relay blue</option><option value="teal">Teal</option><option value="violet">Violet</option></select></label>
        <label className="field"><span>Corner radius</span><select value={p.radius} onChange={e=>set({radius:Number(e.target.value)})}><option value="4">Small</option><option value="8">Medium</option><option value="12">Rounded</option></select></label>
        <label className="field"><span>Sidebar layout</span><select value={p.sidebar} onChange={e=>set({sidebar:e.target.value as Preferences['sidebar']})}><option value="sidebar">Sidebar</option><option value="floating">Floating</option><option value="inset">Inset</option></select></label>
        <label className="field"><span>Content width</span><select value={p.layout} onChange={e=>set({layout:e.target.value as Preferences['layout']})}><option value="full">Full width</option><option value="centered">Centered</option></select></label>
        <label className="field"><span>Density</span><select value={p.density} onChange={e=>set({density:e.target.value as Preferences['density']})}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
        <label className="field"><span>Text size</span><select value={p.text} onChange={e=>set({text:Number(e.target.value)})}><option value="100">Default</option><option value="110">Larger</option><option value="120">Largest</option></select></label>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>Ambient backgrounds</span><input type="checkbox" checked={p.ambient} onChange={e=>set({ambient:e.target.checked})}/></label>
        <label className="flex min-h-11 items-center justify-between gap-3 text-sm"><span>Reduce motion</span><input type="checkbox" checked={!p.motion} onChange={e=>set({motion:!e.target.checked})}/></label>
        <p className="text-xs leading-5 text-muted-foreground">Your system's reduced-motion preference always takes priority. Turning on Reduce motion also hides animated backgrounds.</p>
        <Button variant="outline" onClick={reset}><RotateCcw/>Reset appearance</Button>
      </div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
}
