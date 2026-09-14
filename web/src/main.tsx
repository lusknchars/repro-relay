import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './design.css'
import './card-interactions.css'
import { initializeTheme } from './components/ThemeToggle'
import { DesktopStartup } from './components/DesktopStartup'
import { TooltipProvider } from './components/ui/tooltip'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><TooltipProvider><DesktopStartup><App /></DesktopStartup></TooltipProvider></React.StrictMode>,
)

if ('__TAURI_INTERNALS__' in window) {
  document.addEventListener('click', async event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(anchor instanceof HTMLAnchorElement) || !/^https?:/.test(anchor.href)) return
    event.preventDefault()
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(anchor.href)
    } catch {
      window.alert('Could not open this link. Copy the address into your browser.')
    }
  })
}
