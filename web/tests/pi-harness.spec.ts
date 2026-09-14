import { test, expect } from '@playwright/test'

test('terminal setup explains Pi and Codex without changing the active investigator', async ({ page }) => {
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/v1/') && request.method() !== 'GET') writes.push(request.url()) })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => {
      (window as unknown as { copiedCommand: string }).copiedCommand = value
    } }, configurable: true })
  })
  await page.goto('/?view=connections')
  await page.getByText('Terminal and browser setup', {exact:true}).click()
  const setup = page.getByRole('region', { name: 'Terminal agent setup' })
  await expect(setup.getByRole('combobox', { name: 'Harness' })).toHaveValue('pi')
  await setup.getByRole('button', { name: 'Copy Pi launch command' }).click()
  expect(await page.evaluate(() => (window as unknown as { copiedCommand: string }).copiedCommand)).toBe('./relay pi start')
  await setup.getByText('Connection check and session details').click()
  await expect(setup.getByText(/It does not validate provider sign-in or start a model/)).toBeVisible()
  await setup.getByRole('button', { name: 'Copy Pi check command' }).click()
  expect(await page.evaluate(() => (window as unknown as { copiedCommand: string }).copiedCommand)).toBe('./relay pi doctor')
  await expect(setup.getByText(/separate from Hermes charts/)).toBeVisible()
  await setup.getByRole('combobox', { name: 'Harness' }).selectOption('codex')
  await setup.getByRole('button', { name: 'Copy Codex setup command' }).click()
  expect(await page.evaluate(() => (window as unknown as { copiedCommand: string }).copiedCommand)).toBe('python3 integrations/relay-tools/connect.py')
  await setup.getByRole('combobox', { name: 'Harness' }).selectOption('pi')
  await page.setViewportSize({ width: 320, height: 844 })
  await expect(setup.getByRole('button', { name: 'Copy Pi launch command' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/pi-harness-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'test-results/pi-harness-desktop.png', fullPage: true })
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
