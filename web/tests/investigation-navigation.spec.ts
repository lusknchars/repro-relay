import { test, expect } from '@playwright/test'

test('case triage and investigation sections preserve context without starting an agent', async ({ page }) => {
  const base = { project: 'Navigation fixture', url: 'https://example.com', description: 'UI fixture only. No application was tested.', expected: 'Inspect evidence', build: 'fixture-build', owner_version: 1, handoffs: [], source: 'web', revision: 1, created_at: '2026-09-14T12:00:00Z', updated_at: '2026-09-14T12:00:00Z', observations: [], events: [] }
  const cases = [
    { ...base, id: 'RR-needs-context', title: 'Fixture: investigate a slow report', status: 'needs_context' },
    { ...base, id: 'RR-blocked', title: 'Fixture: blocked test environment', status: 'blocked' },
    { ...base, id: 'RR-new', title: 'Fixture: new report', status: 'new' },
  ]
  const run = { id: 'RUN-navigation', case_id: cases[0].id, case_revision: 1, owner_version: 1, build: base.build, version: 1, status: 'completed', detail: 'Fixture saved result', created_at: base.created_at, checked_at: base.updated_at, deadline: base.updated_at, max_seconds: 120, remote_id: 'fixture', output: 'UI fixture: collect timing measurements before drawing a conclusion.', usage: null, stop_requested: false, context_stale: false, context: {}, events: [] }
  const writes: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    if (route.request().method() !== 'GET') writes.push(path)
    const payload = path === '/session' ? { mode: 'local', authenticated: true }
      : path === '/health' ? { status: 'ok', mode: 'local', memory: 'reviewed_exact_lookup', integrations: {} }
      : path === '/cases' ? cases
      : path === '/runner' ? { available: false, reason: 'Fixture: Hermes is not connected.' }
      : path.endsWith('/investigation-preview') ? { context: {}, context_hash: 'fixture-hash', case_revision: 1, owner_version: 1, build: base.build, follow_up_review_id: null }
      : path.endsWith('/runs') ? path.includes(cases[0].id) ? [run] : []
      : /\/(findings|artifacts|journal)$/.test(path) ? { items: [], next_cursor: null }
      : []
    return route.fulfill({ json: payload })
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Investigation desk' })).toHaveCount(0)
  await expect(page.getByText('Reported cases', {exact:true})).toHaveCount(0)
  const inbox = page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Case inbox', exact: true })
  await expect(inbox).toHaveAccessibleDescription('Triage reported problems')
  await inbox.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/view=inbox/)
  await page.getByLabel('Filter cases by status').selectOption('needs_context')
  const table = page.getByRole('region', { name: 'Cases', exact: true })
  await expect(table).toContainText('Check what is missing before another attempt.')
  await expect(table.getByRole('button', { name: 'Open '+cases[1].title, exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 844 })
  const investigate = table.getByRole('button', { name: 'View investigation for '+cases[0].title, exact: true })
  const bounds = await investigate.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await investigate.click()
  await page.setViewportSize({ width: 1440, height: 960 })
  await expect(page).toHaveURL(/view=agents/)
  await expect(page).toHaveURL(/case=RR-needs-context/)
  const sections = page.getByRole('navigation', { name: 'Sections in this investigation' })
  await expect(page.locator('.iw-orientation')).toContainText('Read the findings and their evidence')
  const packet = page.getByText('Exact context packet', { exact: true }).locator('..')
  await expect(packet).not.toHaveAttribute('open', '')
  for (const [label, id] of [['Test evidence', 'iw-test-evidence'], ['Token cost', 'iw-usage'], ['Run controls', 'iw-run-controls'], ['Findings', 'iw-findings']]) {
    await sections.getByRole('button', { name: label, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#'+id)).toBeFocused()
    expect(await page.locator('#'+id).evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(56)
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: cases[0].title, exact: true })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 844 })
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await sections.getByRole('button', { name: 'Token cost', exact: true }).click()
    await expect(page.locator('#iw-usage')).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/investigation-navigation-${theme}-mobile.png` })
  }
  await page.goto('/?view=agents&case=RR-new')
  await expect(page.locator('.iw-orientation')).toContainText('Connect Hermes before starting')
  await expect(sections.getByRole('button', { name: 'Test evidence' })).toBeDisabled()
  await sections.getByRole('button', { name: 'Run controls' }).click()
  await expect(page.getByRole('button', { name: 'Start Hermes investigation', exact: true })).toBeDisabled()
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
