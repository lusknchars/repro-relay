import { test, expect } from '@playwright/test'

test('cost coverage distinguishes reported zero, missing cost, and imported validation', async ({ page }) => {
  const response = await page.request.post('/api/v1/cases', { data: { title: `Cost coverage fixture ${Date.now()}`, project: 'Cost fixtures', url: 'https://example.com', description: 'Controlled cost display', expected: 'Distinguish unknown charges', build: 'cost-fixture' } })
  expect(response.ok()).toBe(true)
  const item = await response.json()
  const base = { case_id: item.id, case_revision: 1, owner_version: 1, build: item.build, version: 1, status: 'completed', created_at: '2026-09-14T12:00:00Z', checked_at: '2026-09-14T12:01:00Z', deadline: '2026-09-14T12:02:00Z', max_seconds: 120, remote_id: 'fixture', output: 'Controlled fixture. No model executed.', detail: 'Cost display fixture', stop_requested: false, context_stale: false, context: {}, events: [] }
  const rows = [
    { ...base, id: 'RUN-cost-zero', usage: { cost_usd: 0, total_tokens: 42 }, usage_audit: { observed_at: base.checked_at, fields_observed_at: {}, omitted_receipts: 1, receipts: [{ observed_at: base.checked_at, reported: { tool_calls: 3 }, revised_downward: [] }] } },
    { ...base, id: 'RUN-cost-unknown', status: 'failed', usage: { total_tokens: 10 } },
    { ...base, id: 'RUN-cost-local', execution_kind: 'local_validation', usage: { cost_usd: 100 } },
  ]
  await page.route(`**/cases/${item.id}/runs`, route => route.fulfill({ json: rows }))
  await page.goto(`/?view=agents&case=${item.id}`)
  const inspector = page.getByRole('region', { name: 'Investigation cost inspector' })
  await expect(inspector.locator('.cost-total strong')).toHaveText('$0.00')
  await expect(inspector).toContainText('Latest saved total. No retained timeline for this metric.')
  await expect(inspector.getByRole('img', { name: /Token timeline with 1 reported readings/ })).toBeVisible()
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

test('usage charts show reported history, gaps, corrections, and polled updates without export', async ({ page }) => {
  const response = await page.request.post('/api/v1/cases', { data: { title: `Usage charts fixture ${Date.now()}`, project: 'Cost fixtures', url: 'https://example.com', description: 'Controlled usage samples', expected: 'See charts without export', build: 'charts-fixture' } })
  const item = await response.json()
  const base = { case_id: item.id, case_revision: 1, owner_version: 1, build: item.build, version: 1, status: 'completed', created_at: '2026-09-14T12:00:00Z', checked_at: '2026-09-14T12:04:00Z', deadline: '2026-09-14T12:05:00Z', max_seconds: 300, remote_id: 'fixture', output: 'UI fixture only', detail: 'Cost chart fixture', stop_requested: false, context_stale: false, context: {}, events: [] }
  let rows = [{ ...base, id: 'RUN-chart', usage: { total_tokens: 20, cost_usd: .02 }, usage_audit: { observed_at: base.checked_at, fields_observed_at: {}, omitted_receipts: 0, receipts: [
    { observed_at: '2026-09-14T12:01:00Z', reported: { total_tokens: 10, cost_usd: .01 }, revised_downward: [] },
    { observed_at: '2026-09-14T12:02:00Z', reported: { total_tokens: 30, cost_usd: .03 }, revised_downward: [] },
    { observed_at: '2026-09-14T12:03:00Z', reported: { tool_calls: 2 }, revised_downward: [] },
    { observed_at: '2026-09-14T12:04:00Z', reported: { total_tokens: 20, cost_usd: .02 }, revised_downward: ['total_tokens', 'cost_usd'] },
  ] } }]
  let downloads = 0; page.on('download', () => downloads++)
  await page.route(`**/cases/${item.id}/runs`, route => route.fulfill({ json: rows }))
  await page.goto(`/?view=agents&case=${item.id}`)
  const chart = page.getByRole('region', { name: 'Hermes usage charts' })
  await expect(chart.getByRole('img', { name: /Token timeline with 3 reported readings/ })).toBeVisible()
  await expect(chart.locator('.recharts-line-curve')).toHaveCount(1)
  await expect(chart).toContainText('revised a reading downward')
  await chart.getByText('Chart data', { exact: true }).click()
  const readings = chart.locator('.usage-data-list').first()
  await expect(readings.locator('strong')).toHaveText(['10', '30', 'Not reported', '20'])
  await chart.getByRole('button', { name: 'Cost · USD' }).click()
  await expect(readings.locator('strong')).toHaveText(['$0.01', '$0.03', 'Not reported', '$0.02'])
  await expect(page.locator('.cost-total strong')).toHaveText('$0.02')
  rows = [{ ...rows[0], usage: { total_tokens: 40, cost_usd: .04 }, usage_audit: { ...rows[0].usage_audit, receipts: [...rows[0].usage_audit.receipts, { observed_at: '2026-09-14T12:05:00Z', reported: { total_tokens: 40, cost_usd: .04 }, revised_downward: [] }] } }]
  await expect(chart.getByRole('img', { name: /Cost timeline with 4 reported readings/ })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.cost-total strong')).toHaveText('$0.04')
  await page.screenshot({ path: 'test-results/usage-charts.png', fullPage: true })
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(downloads).toBe(0)
})
