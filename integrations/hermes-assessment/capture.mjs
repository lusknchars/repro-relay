// Capture the real local UI for a separate Hermes assessment. No API mutations.
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, '.data/hermes-assessment')
const origin = 'http://127.0.0.1:5178'
const started = new Date().toISOString()
const build = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
const browser = await chromium.launch()
const entries = [], results = []
const add = (id, name, kind, content) => entries.push({ id: id.replace(/[^A-Za-z0-9_-]/g, '-'), name, kind, content })
const check = (test_id, name, status, detail, environment) => results.push({ test_id, name, status, detail, environment, captured_at: new Date().toISOString() })
try {
  await mkdir(output, { recursive: true, mode: 0o700 })
  for (const width of [1440, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(7000)
    const environment = { name: `Local Chromium ${width}px`, browser: 'Chromium', browser_version: browser.version(), os: process.platform, os_version: 'Not measured', device: `${width}px browser viewport`, emulated: width === 320, capture_mode: 'local_validation' }
    const errors = [], blockedWrites = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('**/api/v1/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        blockedWrites.push(route.request().method() + ' ' + new URL(route.request().url()).pathname)
        return route.abort()
      }
      return route.continue()
    })
    for (const view of ['overview', 'sessions', 'inbox', 'agents', 'memory', 'handoffs', 'connections']) {
      const id = `${view}-${width}`
      const before = errors.length
      try {
        const response = await page.goto(`${origin}/?view=${view}`, { waitUntil: 'domcontentloaded' })
        if (!response?.ok()) throw new Error('Page response was not successful')
        await page.getByRole('main').waitFor({ state: 'visible' })
        await page.waitForTimeout(1200) // Allow the real API reads and lazy view to settle.
        const healthy = await page.request.get(`${origin}/api/v1/health`)
        if (!healthy.ok()) throw new Error('Local API is unavailable')
        const snapshot = await page.locator('body').ariaSnapshot()
        add(id, `${view} at ${width}px`, 'accessibility_snapshot', snapshot.slice(0, 30000))
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
        check(`${id}-layout`, `${view}: ${width}px horizontal layout`, overflow ? 'failed' : 'passed', overflow ? 'Document is wider than the viewport.' : 'No document-level horizontal overflow observed.', environment)
        check(`${id}-javascript`, `${view}: ${width}px JavaScript`, errors.length > before ? 'failed' : 'passed', errors.slice(before).join('\n') || 'No pageerror event during this visit. This is not a full functional test.', environment)
      } catch (error) {
        check(id, `${view}: ${width}px inspection`, 'blocked', error.message, environment)
      }
    }
    check(`readonly-${width}`, `${width}px assessment stayed read-only`, blockedWrites.length ? 'failed' : 'passed', blockedWrites.join('\n') || 'No API mutation was attempted during navigation.', environment)
    await page.screenshot({ path: path.join(output, `connections-${width}.png`), fullPage: true })
    await context.close()
  }
  const env = { name: 'Coverage boundary', browser: 'Not run', browser_version: 'Not run', os: 'Not run', os_version: 'Not run', device: 'Not run', emulated: false, capture_mode: 'local_validation' }
  for (const [id, name, detail] of [
    ['windows-edge', 'Microsoft Edge on Windows', 'This Mac capture did not execute the Windows CI job.'],
    ['screen-reader', 'VoiceOver or NVDA user session', 'Accessibility snapshots are not a screen-reader user session.'],
    ['physical-phone', 'Physical smartphone interaction', 'A 320px desktop browser viewport is not physical-device testing.'],
    ['hermes-assessment', 'Hermes usability assessment', 'This capture runs browser checks only. A separate Hermes run must assess this packet after provider sign-in.'],
  ]) check(id, name, 'not_run', detail, env)
  for (const file of ['web/src/components/CurrentWork.tsx', 'web/src/components/InvestigationWorkspace.tsx', 'web/src/components/InvestigationDesk.tsx', 'web/src/components/WorkspaceTour.tsx', 'web/src/lib/workspace-guidance.ts']) {
    const content = await readFile(path.join(root, file), 'utf8')
    if (Buffer.byteLength(content) > 64000) throw new Error(`Source exceeds capture limit: ${file}`)
    add(file, file, 'source', content)
  }
  const finished = new Date().toISOString()
  const receipt = { build, dirty, started_at: started, finished_at: finished, command: ['node', 'integrations/hermes-assessment/capture.mjs'], results }
  add('test-receipt', 'Actual browser inspection results and coverage boundaries', 'test_receipt', JSON.stringify(receipt, null, 2))
  const packet = { schema_version: 1, build, captured_at: finished, scope: `Local Repro Relay ${origin}; ${dirty ? 'working tree contains uncommitted changes' : 'clean commit'}. Read-only navigation and selected source. No repair or independent fix verification.`, entries }
  await writeFile(path.join(output, 'packet.json'), JSON.stringify(packet, null, 2), { mode: 0o600 })
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ build, dirty, counts: Object.fromEntries(['passed', 'failed', 'blocked', 'not_run'].map(status => [status, results.filter(r => r.status === status).length])), packet: path.join(output, 'packet.json') }, null, 2))
} finally { await browser.close() }
