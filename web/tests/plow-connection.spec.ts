import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('Plow connection setup opens, copies the launch command, and exports the actual guide', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { Object.assign(window, { copiedLaunch: text }) } } })
  })
  await page.goto('/?view=connections')
  const trigger = page.getByRole('button', { name: 'Connect Plow Latch' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Connect Plow Latch' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy launch command' }).click()
  expect(await page.evaluate(() => (window as unknown as { copiedLaunch: string }).copiedLaunch)).toBe('open -b co.plow.domo-desktop')
  await expect(dialog.getByRole('status')).toContainText('Launch command copied')
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download Relay setup guide' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('repro-relay-plow-setup.md')
  expect(await readFile((await download.path())!, 'utf8')).toContain('bridge.py --config .data/plow/bridge.json doctor')
  await expect(dialog.getByText('Relay connection is not verified.', { exact: false })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/plow-connect-mobile.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('Plow setup explains clipboard failure and keeps guest connections local', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied') } } })
  })
  await page.goto('/?view=connections')
  await page.getByRole('button', { name: 'Connect Plow Latch' }).click()
  await page.getByRole('button', { name: 'Copy launch command' }).click()
  await expect(page.getByRole('alert')).toContainText('Clipboard access is unavailable')
  await page.route('**/api/v1/session', route => route.fulfill({ json: { mode: 'guest', authenticated: true } }))
  await page.reload()
  await page.getByRole('button', { name: 'Connect Plow Latch' }).click()
  await expect(page.getByRole('dialog')).toContainText('Plow connections belong to your local workspace')
  await expect(page.getByRole('button', { name: 'Copy launch command' })).toHaveCount(0)
})

const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

test.describe('on a computer that is not a Mac', () => {
  test.use({ userAgent: windows })

  test('step one says what needs a Mac and never says this person owns one', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } })
    })
    await page.goto('/?view=connections')
    await page.getByRole('button', { name: 'Connect Plow Latch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect Plow Latch' })
    await expect(dialog).toContainText('Plow Latch runs on macOS only')
    await expect(dialog).not.toContainText('on your Mac')
    await dialog.getByRole('button', { name: 'Copy launch command' }).click()
    await expect(dialog.getByRole('status')).toContainText('the Mac where Latch is installed')
    await expect(dialog.getByRole('button', { name: 'Download Relay setup guide' })).toBeVisible()
  })

  test('the desktop app reports the native reason instead of sending them to Applications', async ({ page }) => {
    await page.exposeFunction('nativeRelay', async (command: string) => {
      // The exact string web/src-tauri/src/main.rs returns off macOS.
      if (command === 'open_plow_latch') throw new Error('Plow Latch requires a Mac.')
      throw new Error('Unexpected native command')
    })
    await page.addInitScript(() => Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: (command: string) => (window as unknown as { nativeRelay: (command: string) => Promise<unknown> }).nativeRelay(command) },
    }))
    // The desktop build talks to its own local service, which is not running here.
    await page.route('http://127.0.0.1:8178/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/health')) return route.fulfill({ json: { status: 'ok', mode: 'local' } })
      if (path.endsWith('/session')) return route.fulfill({ json: { mode: 'local', authenticated: true } })
      return route.fulfill({ json: [] })
    })
    await page.goto('/?view=connections')
    await page.getByRole('button', { name: 'Connect Plow Latch' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect Plow Latch' })
    await dialog.getByRole('button', { name: 'Open Plow Latch' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Plow Latch requires a Mac.')
    await expect(dialog.getByRole('alert')).not.toContainText('Open it from Applications')
  })
})
