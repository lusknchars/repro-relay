import { test, expect } from '@playwright/test'

test('test triage uses explicit receipts, retains artifact inspection and exposes partial history', async ({ page }) => {
  const item = { id: 'RR-triage', title: 'Fixture: accessible investigation', project: 'Triage fixture', url: 'https://example.com', description: 'Fixture report', expected: 'Inspect recorded tests', build: 'fixture', owner_version: 1, revision: 1, handoffs: [], observations: [], events: [], status: 'new', source: 'web', created_at: '2026-09-14T12:00:00Z', updated_at: '2026-09-14T12:00:00Z' }
  const run = { id: 'RUN-triage', execution_kind: 'hermes', case_id: item.id, case_revision: 1, owner_version: 1, build: item.build, version: 1, status: 'completed', detail: 'Fixture result', created_at: item.created_at, checked_at: item.updated_at, deadline: item.updated_at, max_seconds: 120, remote_id: 'fixture', output: 'Narrative says all tests passed; this is not a test receipt.', usage: null, stop_requested: false, context_stale: false, context: {}, events: [] }
  const environment = { name: 'UI fixture', browser: 'Chromium', browser_version: 'fixture', os: 'macOS', os_version: 'fixture', device: 'Emulated desktop', emulated: true, capture_mode: 'fixture' }
  const receipt = (id: string, sequence: number, status: string, name: string, testId = id, producerSequence = sequence) => ({ id, sequence, producer_sequence: producerSequence, producer: 'fixture-adapter', event_type: 'test_result', data: { test_id: testId, name, status, detail: 'Fixture evidence only.' }, summary: name, received_at: item.updated_at, captured_at: item.created_at, environment, artifact_ids: id === 'EV-failed' ? ['ART-log'] : [] })
  let records = [receipt('EV-failed', 1, 'failed', 'Keyboard exit'), receipt('EV-blocked', 2, 'blocked', 'Windows Edge unavailable'), receipt('EV-not-run', 3, 'not_run', 'Screen reader'), receipt('EV-running', 4, 'running', 'Historical started test'), receipt('EV-passed', 5, 'passed', 'Mobile layout', 'mobile', 8), receipt('EV-late-start', 6, 'running', 'Mobile layout', 'mobile', 7), receipt('EV-invalid', 7, 'success', 'Unsupported success label'), { ...receipt('EV-generic', 8, 'passed', 'Generic log'), event_type: 'command_output' }]
  let partial = true; let revoked = false; let journalReads = 0
  const artifact = { id: 'ART-log', name: 'keyboard-fixture.txt', sequence: 1, received_at: item.updated_at, captured_at: item.created_at, environment, size_bytes: 23, sha256: 'fixture-digest', media_type: 'text/plain' }
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url()); const path = url.pathname.replace('/api/v1', '')
    if (path.endsWith('/journal')) { journalReads++; expect(url.searchParams.get('limit')).toBe('100') }
    const payload = path === '/session' ? { mode: 'local', authenticated: true }
      : path === '/health' ? { status: 'ok', mode: 'local', memory: 'reviewed_exact_lookup', integrations: {} }
      : path === '/cases' ? [item]
      : path === '/runner' ? { available: false, reason: 'Fixture disconnected' }
      : path.endsWith('/runs') ? [run]
      : path.endsWith('/investigation-preview') ? { context: {}, context_hash: 'fixture', case_revision: 1, owner_version: 1, build: item.build }
      : path.endsWith('/journal') ? { items: url.searchParams.has('after') ? [receipt('EV-later', 10, 'passed', 'Later test')] : records, next_cursor: partial && !url.searchParams.has('after') ? records.at(-1)?.sequence ?? null : null }
      : path === '/artifacts/ART-log' ? { ...artifact, available: !revoked, ...(revoked ? {} : { content: 'Fixture keyboard output' }) }
      : path.endsWith('/artifacts') ? { items: [artifact], next_cursor: null }
      : path.endsWith('/findings') ? { items: [], next_cursor: null }
      : []
    return route.fulfill({ json: payload })
  })
  await page.goto('/?view=agents&case='+item.id)
  const triage = page.getByRole('region', { name: 'Test triage', exact: true })
  await expect(triage.getByRole('button', { name: 'All · 5', exact: true })).toBeVisible()
  await expect(triage.getByRole('button', { name: 'Needs attention · 4', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(triage.getByText('Mobile layout', { exact: true })).toHaveCount(0)
  await expect(triage).toContainText('Partial history')
  await expect(triage.getByRole('button', { name: 'Passed · 1', exact: true })).toBeVisible()
  await expect(triage.getByRole('button', { name: 'Reported running · 1', exact: true })).toBeVisible()
  await triage.getByRole('button', { name: 'Failed · 1', exact: true }).click()
  await expect(triage.getByText('Keyboard exit', { exact: true })).toBeVisible()
  await expect(triage.getByText('Screen reader', { exact: true })).toHaveCount(0)
  await triage.getByRole('button', { name: 'Inspect source event' }).click()
  await expect(page.locator('#evidence-EV-failed')).toBeFocused()
  await triage.getByRole('button', { name: 'keyboard-fixture.txt', exact: true }).click()
  const inspector = page.getByRole('region', { name: 'Stored artifact contents' })
  await expect(inspector).toBeFocused()
  await expect(inspector).toContainText('Fixture keyboard output')
  const before = journalReads; const unchangedVersion = run.version
  records = [...records, receipt('EV-progress-finished', 9, 'passed', 'Historical started test', 'EV-running')]
  run.checked_at = '2026-09-14T12:00:03Z'
  await expect.poll(() => journalReads, { timeout: 10000 }).toBeGreaterThan(before)
  expect(run.version).toBe(unchangedVersion)
  await expect(triage.getByRole('button', { name: 'Passed · 2', exact: true })).toBeVisible()
  await expect(triage.getByRole('button', { name: 'Reported running · 0', exact: true })).toBeVisible()
  await expect(inspector).toBeVisible()
  await expect(inspector).toBeFocused()
  await expect(triage.getByRole('button', { name: 'Failed · 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  revoked = true; run.version++
  await expect(inspector).toContainText('Artifact content is unavailable or has been revoked.', { timeout: 10000 })
  await expect(inspector.getByText('Fixture keyboard output')).toHaveCount(0)
  await inspector.getByRole('button', { name: 'Close log' }).click()
  await expect(triage.getByRole('button', { name: 'keyboard-fixture.txt', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Load more journal' }).click()
  await expect(triage.getByRole('button', { name: 'All · 6', exact: true })).toBeVisible()
  await expect(triage.getByText('Partial history', { exact: false })).toHaveCount(0)
  const afterPagination = journalReads; run.version++
  await expect.poll(() => journalReads, { timeout: 10000 }).toBeGreaterThan(afterPagination)
  await expect(triage.getByRole('button', { name: 'All · 6', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  partial = false; records = []
  await page.getByRole('button', { name: 'Refresh evidence', exact: true }).click()
  await expect(triage).toContainText('No structured test results have been reported.')
  await expect(triage.getByRole('button', { name: 'Passed · 0', exact: true })).toBeVisible()
})
