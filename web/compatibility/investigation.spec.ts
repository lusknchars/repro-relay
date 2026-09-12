import { expect, test, type Page } from '@playwright/test'

const fixtureCase = {
  id: 'RR-compatibility-fixture', title: 'Compatibility fixture: review an investigation',
  project: 'Browser compatibility fixture', url: 'https://example.com',
  description: 'Fixture-only report. No real application was tested.', expected: 'A reviewable investigation result',
  build: 'fixture-build', owner_version: 1, handoffs: [], source: 'web', status: 'new', revision: 1,
  created_at: '2026-09-12T12:00:00Z', updated_at: '2026-09-12T12:00:00Z', observations: [], events: [],
}
const fixtureCases = [fixtureCase, ...Array.from({ length: 24 }, (_, index) => ({
  ...fixtureCase, id: `RR-layout-fixture-${index}`,
  title: `Layout fixture ${index + 1}: a longer report title that wraps in the case list`,
}))]
const context = {
  schema_version: 1, case_id: fixtureCase.id, case_revision: 1, role: 'investigator', title: fixtureCase.title,
  reported: fixtureCase.description, expected: fixtureCase.expected, build: fixtureCase.build, status: 'new',
  evidence: { attempts: [], target_url: fixtureCase.url }, source_event_ids: [], related_reviewed_observations: [],
  verification: 'Fixture context only.', unknowns: ['No browser action has been captured.'],
}
const fixtureRun = {
  id: 'RUN-compatibility-fixture', case_id: fixtureCase.id, case_revision: 1, owner_version: 1, build: fixtureCase.build,
  version: 2, status: 'completed', detail: 'Fixture result ready for review.', created_at: fixtureCase.created_at,
  checked_at: fixtureCase.updated_at, deadline: fixtureCase.updated_at, max_seconds: 120, remote_id: 'fixture-remote',
  output: 'Compatibility fixture proposal. No real application was tested.', usage: null, stop_requested: false,
  context_stale: false, context, events: [{ sequence: 2, kind: 'run.completed', at: fixtureCase.updated_at, detail: 'Fixture result saved.' }],
}

async function fixtureApi(page: Page) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const payload = path === '/session' ? { mode: 'local', authenticated: true }
      : path === '/health' ? { status: 'ok', mode: 'local', memory: 'reviewed_exact_lookup', integrations: {} }
      : path === '/cases' ? fixtureCases
      : path === '/memories' ? []
      : path === '/runner' ? { available: false, reason: 'Compatibility fixture: no live Hermes runtime is connected.' }
      : path === `/cases/${fixtureCase.id}` ? fixtureCase
      : path === `/cases/${fixtureCase.id}/runs` ? [fixtureRun]
      : path === `/cases/${fixtureCase.id}/run-reviews` ? []
      : path === `/cases/${fixtureCase.id}/related` ? []
      : path === `/cases/${fixtureCase.id}/investigation-preview` ? { context, context_hash: 'fixture-context-hash', case_revision: 1, owner_version: 1, build: fixtureCase.build, follow_up_review_id: null }
      : undefined
    if (payload === undefined || route.request().method() !== 'GET') {
      await route.fulfill({ status: 404, json: { detail: 'This operation is not part of the compatibility fixture.' } })
    } else await route.fulfill({ json: payload })
  })
}

test('investigation review remains readable and keyboard-operable in the selected browser', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixtureApi(page)
  await page.goto(`/?view=agents&case=${fixtureCase.id}`)
  const workspace = page.locator('.investigation-workspace')
  async function expectCaseRowsToContainTheirLabels() {
    const rows = workspace.locator('.iw-case')
    await expect(rows).toHaveCount(fixtureCases.length)
    await expect.poll(() => rows.evaluateAll(elements => elements.every(element => {
      const bounds = element.getBoundingClientRect()
      return Array.from(element.children).every(child => {
        if (!child.getClientRects().length) return true
        const label = child.getBoundingClientRect()
        return label.top >= bounds.top && label.bottom <= bounds.bottom + 1
      })
    }))).toBe(true)
  }
  await expect(workspace).toContainText(fixtureRun.output)
  await expectCaseRowsToContainTheirLabels()
  await expect(page.getByRole('button', { name: 'Agent controls', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(workspace).toContainText('Compatibility fixture: no live Hermes runtime is connected.')
  await page.getByRole('button', { name: 'New report', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New bug report' })).toBeVisible()
  await expect(page.getByLabel('Report title')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'New report', exact: true })).toBeFocused()
  await page.screenshot({ path: test.info().outputPath('investigation-desktop.png'), fullPage: true })
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
    await page.setViewportSize({ width: 320, height: 740 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(workspace).toContainText(fixtureRun.output)
    await expectCaseRowsToContainTheirLabels()
    await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click()
    const sidebar = page.getByRole('dialog', { name: 'Sidebar', exact: true })
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sidebar).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Toggle Sidebar', exact: true })).toBeFocused()
    await page.screenshot({ path: test.info().outputPath(`investigation-mobile-${theme}.png`), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('local validation exposes recorded evidence without claiming Hermes execution', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await fixtureApi(page)
  let revoked = false
  const artifact = {
    id: 'EV-log', sequence: 1, name: 'validation-fixture.log', media_type: 'text/plain',
    size_bytes: 30, sha256: 'a'.repeat(64), available: true, received_at: fixtureCase.created_at,
    captured_at: fixtureCase.created_at,
    environment: { name: 'UI fixture', os: 'macOS', os_version: 'fixture', browser: 'Chromium', browser_version: 'fixture', device: 'desktop', emulated: false, capture_mode: 'fixture' },
  }
  const event = { id: 'EV-event-1', sequence: 2, event_type: 'test_result', summary: 'Recorded fixture command exited successfully.', producer: 'fixture-inspector', producer_sequence: 1, captured_at: fixtureCase.created_at, received_at: fixtureCase.created_at, environment: artifact.environment, artifact_ids: [artifact.id], data: { exit_code: 0 } }
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api/v1', '')
    if (path === `/cases/${fixtureCase.id}/runs`) {
      await route.fulfill({ json: [{ ...fixtureRun, execution_kind: 'local_validation', context: { ...context, inspection: { inspector: 'Named test operator' } }, output: 'Local validation fixture result, with separately stored evidence.' }] })
    } else if (path === `/runs/${fixtureRun.id}/journal`) {
      await route.fulfill({ json: url.searchParams.has('after') ? { items: [{ ...event, id: 'EV-event-2', sequence: 3, summary: 'Second saved event from the next page.' }], next_cursor: null } : { items: [event], next_cursor: 2 } })
    } else if (path === `/runs/${fixtureRun.id}/artifacts`) {
      await route.fulfill({ json: { items: [{ ...artifact, available: !revoked }], next_cursor: null } })
    } else if (path === `/runs/${fixtureRun.id}/findings`) {
      await route.fulfill({ json: { items: [{ id: 'EV-finding', sequence: 4, kind: 'observed_symptom', statement: 'The fixture preserved its original recorded output.', build: fixtureCase.build, received_at: fixtureCase.created_at, sources_available: !revoked, event_ids: [event.id], artifact_ids: [artifact.id], latest_review: { decision: 'accepted', feedback: 'Reviewed fixture evidence; independent verification remains unperformed.', reviewer: 'Fixture reviewer', received_at: fixtureCase.created_at } }], next_cursor: null } })
    } else if (path === '/artifacts/EV-log') {
      await route.fulfill({ json: revoked ? { ...artifact, available: false } : { ...artifact, content: 'Stored fixture command output: PASS' } })
    } else await route.fallback()
  })
  await page.goto(`/?view=agents&case=${fixtureCase.id}`)
  const workspace = page.locator('.investigation-workspace')
  await expect(workspace.locator('.iw-state-banner')).toContainText('Local validation')
  await expect(workspace).toContainText('Local validation attributed to Named test operator (locally supplied identity)')
  await expect(workspace).not.toContainText('Validation executed locally by Codex')
  await expect(workspace).toContainText('Review accepted · not verified')
  await expect(workspace).toContainText('Recorded fixture command exited successfully.')
  await workspace.getByRole('button', { name: 'Load more journal', exact: true }).click()
  await expect(workspace).toContainText('Second saved event from the next page.')
  const openLog = workspace.getByRole('button', { name: 'Inspect stored log', exact: true })
  await openLog.click()
  const inspector = workspace.getByRole('region', { name: 'Stored artifact contents', exact: true })
  await expect(inspector).toBeFocused()
  await expect(inspector).toContainText('Stored fixture command output: PASS')
  await expect(inspector).toContainText(artifact.sha256)
  await expect(inspector).toContainText('30')
  await inspector.getByRole('button', { name: 'Close log', exact: true }).click()
  await expect(openLog).toBeFocused()
  revoked = true
  await openLog.click()
  await expect(inspector).toContainText('Artifact content is unavailable or has been revoked.')
  await expect(inspector).not.toContainText('Stored fixture command output: PASS')
  await inspector.getByRole('button', { name: 'Close log', exact: true }).click()
  await workspace.getByRole('button', { name: 'Refresh evidence', exact: true }).click()
  await expect(openLog).toBeDisabled()
  await expect(workspace).toContainText('One or more sources are unavailable or revoked.')
  await expect(workspace.getByRole('button', { name: 'Start Hermes investigation', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})
