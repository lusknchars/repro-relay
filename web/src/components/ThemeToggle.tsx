import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'

export function initializeTheme() {
  let preference: string | null = null
  try { preference = localStorage.getItem('relay-theme') } catch { /* Storage can be disabled. */ }
  document.documentElement.dataset.theme = preference === 'dark' || preference === 'light'
    ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  function toggle() {
    const theme = dark ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('relay-theme', theme) } catch { /* The current session still works. */ }
    setDark(!dark)
  }
  return <Button variant="ghost" size="icon" className="theme-toggle" onClick={toggle}
    aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'}>
    {dark ? <Sun size={18}/> : <Moon size={18}/>}
  </Button>
}
