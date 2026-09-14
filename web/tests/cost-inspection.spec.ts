import { test, expect } from '@playwright/test'

test('cost coverage distinguishes reported zero, missing cost, and imported validation', async ({ page }) => {
  const response = await page.request.post('/api/v1/cases', { data: { title: `Cost coverage fixture ${Date.now()}`, project: 'Cost fixtures', url: 'https://example.com', description: 'Controlled cost display', expected: 'Distinguish unknown charges', build: 'cost-fixture' } })
  expect(response.ok()).toBe(true)
  const item = await response.json()
  const base = { case_id: item.id, case_revision: 1, owner_version: 1, build: item.build, version: 1, status: 'completed', created_at: '2026-09-14T12:00:00Z', checked_at: '2026-09-14T12:01:00Z', deadline: '2026-09-14T12:02:00Z', max_seconds: 120, remote_id: 'fixture', output: 'Controlled fixture. No model executed.', detail: 'Cost display fixture', stop_requested: false, context_stale: false, context: {}, events: [] }
  const rows = [
    { ...base, id: 'RUN-cost-zero', usage: { cost_usd: 0, total_tokens: 42 } },
    { ...base, id: 'RUN-cost-unknown', status: 'failed', usage: { total_tokens: 10 } },
    { ...base, id: 'RUN-cost-local', execution_kind: 'local_validation', usage: { cost_usd: 100 } },
  ]
  await page.route(`**/cases/${item.id}/runs`, route => route.fulfill({ json: rows }))
  await page.goto(`/?view=agents&case=${item.id}`)
  const inspector = page.getByRole('region', { name: 'Investigation cost inspector' })
  await expect(inspector.locator('.cost-total strong')).toHaveText('$0.00')
  await inspector.getByText("This case's investigation spend", { exact: true }).click()
  await expect(inspector).toContainText('1 of 2 saved investigations')
  await expect(inspector.locator('.cost-subtotal')).toHaveText('$0.00')
  await page.getByLabel('Investigation history', { exact: true }).selectOption('RUN-cost-unknown')
  await expect(inspector.locator('.cost-total strong')).toHaveText('Not reported')
  await expect(inspector).toContainText('Hermes has not supplied a dollar cost')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 844 })
  await inspector.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/cost-inspector-mobile.png', fullPage: true })
  await page.getByLabel('Investigation history', { exact: true }).selectOption('RUN-cost-local')
  await expect(inspector).toContainText('Hermes usage does not apply')
  await expect(inspector.locator('.cost-total')).toHaveCount(0)
})
