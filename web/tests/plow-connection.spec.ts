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
