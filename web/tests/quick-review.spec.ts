import { test, expect } from '@playwright/test'

test('saved results support direct decisions and distinguish current work from history', async ({ page }) => {
  const item = { id: 'RR-quick-review', title: 'Fixture: inspect saved work', project: 'Review fixture', url: 'https://example.com', description: 'Existing report. Do not ask the user to diagnose it again.', expected: 'Inspect the saved evidence', build: 'fixture', owner_version: 1, revision: 1, handoffs: [], observations: [], events: [], status: 'new', source: 'web', created_at: '2026-09-14T12:00:00Z', updated_at: '2026-09-14T12:00:00Z' }
  const saved = { id: 'RUN-saved', execution_kind: 'local_validation', case_id: item.id, case_revision: 1, owner_version: 1, build: item.build, version: 1, status: 'completed', detail: 'Fixture local validation', created_at: item.created_at, checked_at: item.updated_at, deadline: item.updated_at, max_seconds: 120, remote_id: null, output: 'Saved fixture result, not live Hermes execution.', usage: null, stop_requested: false, context_stale: false, context: {}, events: [] }
  let runs = [saved]
  let connected = false; let unavailable = false
  let reviews: Record<string, unknown>[] = []
  const writes: { path: string; body: Record<string, unknown>; key: string | undefined }[] = []
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (request.method() === 'POST') {
      writes.push({ path, body: request.postDataJSON(), key: request.headers()['idempotency-key'] })
      if (path.endsWith('/runs')) return route.fulfill({ status: 503, json: { detail: 'Fixture uncertain start' } })
      if (writes.length === 1) return route.fulfill({ status: 503, json: { detail: 'Fixture uncertain response' } })
      reviews = [{ ...request.postDataJSON(), id: 'REV-fixture', run_id: saved.id, case_id: item.id, owner_version: 1, build: item.build, reviewer_identity: 'locally_supplied', created_at: item.updated_at }]
      return route.fulfill({ json: reviews[0] })
    }
    if (path === '/runner' && unavailable) return route.fulfill({ status: 503, json: { detail: 'Fixture connection lost' } })
    const payload = path === '/session' ? { mode: 'local', authenticated: true }
      : path === '/health' ? { status: 'ok', mode: 'local', memory: 'reviewed_exact_lookup', integrations: {} }
      : path === '/cases' ? [item]
      : path === '/runner' ? { available: connected, reason: connected ? 'Fixture connected' : 'Fixture not connected' }
      : path.endsWith('/run-reviews') ? reviews
      : path.endsWith('/runs') ? runs
      : path.endsWith('/investigation-preview') ? { context: {}, context_hash: 'fixture-preview', case_revision: 1, owner_version: 1, build: item.build, follow_up_review_id: reviews[0]?.decision === 'needs_changes' ? reviews[0].id : null }
      : /\/(findings|journal|artifacts)$/.test(path) ? { items: [], next_cursor: null }
      : []
    return route.fulfill({ json: payload })
  })
  await page.goto('/?view=agents&case='+item.id)
  const activity = page.getByRole('region', { name: 'Current Hermes activity' })
  const decision = page.getByRole('region', { name: 'Review saved result', exact: true })
  await expect(activity.getByRole('heading')).toHaveText('Hermes is not connected')
  await expect(activity).toContainText('a saved local validation record, not a Hermes investigation')
  await expect(page.getByRole('textbox', { name: 'Review feedback', exact: true })).toHaveCount(0)
  await decision.getByRole('button', { name: 'Needs another check', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry pending request' })).toBeVisible()
  await expect(decision.getByRole('button', { name: 'Accept proposal' })).toBeDisabled()
  await page.getByRole('button', { name: 'Retry pending request' }).click()
  await expect(decision).toContainText('Saved decision: Needs another check')
  expect(writes).toHaveLength(2)
  expect(writes[1]).toEqual(writes[0])
  expect(writes[0].path).toBe('/runs/RUN-saved/reviews')
  expect(writes[0].body).toMatchObject({ reviewer: 'Local workspace user', decision: 'needs_changes', run_version: 1, case_revision: 1 })
  expect(writes[0].body.feedback).toContain('saved report, proposal, and attached evidence')
  await page.reload()
  await expect(decision.getByRole('button', { name: 'Needs another check', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start follow-up investigation', exact: true })).toBeDisabled()
  connected = true
  runs = [{ ...saved, id: 'RUN-active', execution_kind: 'hermes', status: 'running', output: '', detail: 'Fixture active work', context: { repair_contract: { stage: 'repair' } } }, saved]
  await expect(activity.getByRole('heading')).toHaveText('Approved code repair · In progress', { timeout: 10000 })
  await page.getByLabel('Investigation history', { exact: true }).selectOption(saved.id)
  await expect(activity.getByRole('button', { name: 'View active work' })).toBeVisible()
  await activity.getByRole('button', { name: 'View active work' }).click()
  await expect(page.getByLabel('Investigation history', { exact: true })).toHaveValue('RUN-active')
  unavailable = true
  await expect(activity.getByRole('heading')).toHaveText('Current activity could not be checked', { timeout: 10000 })
  await page.setViewportSize({ width: 320, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(writes).toHaveLength(2)
  unavailable = false; runs = []; reviews = []
  await page.reload()
  await page.getByRole('button', { name: 'Start Hermes investigation', exact: true }).click()
  await expect(activity.getByRole('heading')).toHaveText('Start request not yet confirmed')
  await expect(page.getByRole('button', { name: 'Retry pending request' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start Hermes investigation', exact: true })).toBeDisabled()
  expect(writes).toHaveLength(3)
  expect(writes[2].path).toBe('/cases/RR-quick-review/runs')
})
