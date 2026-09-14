import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve('test-results/autonomy-repository')
const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: 'pipe' })
function harness() { run('python3', ['../integrations/context-harness/worker.py', '--repo', root, '--api', 'http://127.0.0.1:8180/api/v1', '--once']) }
function fixture() {
  mkdirSync(resolve(root, 'nested'), { recursive: true })
  const instructions = `Browser workflow fixture ${Date.now()}. Preserve every evidence source and revision.\n`.repeat(60)
  writeFileSync(resolve(root, 'AGENTS.md'), instructions)
  writeFileSync(resolve(root, 'nested/AGENTS.md'), instructions)
  run('git', ['-C', root, 'init', '-q'])
  run('git', ['-C', root, 'add', 'AGENTS.md', 'nested/AGENTS.md'])
  run('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Controlled context harness fixture'])
  harness()
}

test('automatic discovery and evaluation finish before candidate approval', async ({ page }) => {
  fixture()
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/?view=sessions')
  await expect(page.getByRole('heading', { name: 'Reusable context candidate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(1) // Activity search only.
  await expect(page.getByRole('heading', { name: 'Evaluation result' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve candidate', exact: true })).toBeEnabled()
  const approve = page.getByRole('button', { name: 'Approve candidate', exact: true })
  const decisionRoute = '**/autonomy/proposals/*/decision'
  await page.route(decisionRoute, route => route.fulfill({ status: 503, json: { detail: 'Approval unavailable in fixture' } }), { times: 1 })
  await approve.click()
  await expect(approve).toHaveAttribute('data-approval-state', 'error')
  await expect(approve).toHaveCSS('background-color', 'rgb(185, 28, 28)')
  await expect(page.getByRole('alert')).toContainText('Approval unavailable')
  await page.screenshot({ path: 'test-results/approval-error.png' })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let submissions = 0
  await page.route(decisionRoute, async route => { submissions++; await held; await route.continue() })
  await approve.click()
  await expect(approve).toHaveAttribute('data-approval-state', 'loading')
  await expect(approve).toBeDisabled()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(approve.locator('.approval-spinner')).toHaveCSS('animation-name', 'none')
  await expect(approve.locator('.approval-label')).toHaveCSS('transform', 'none')
  await page.screenshot({ path: 'test-results/approval-loading.png' })
  await approve.evaluate((element: HTMLButtonElement) => element.click())
  expect(submissions).toBe(1)
  release()
  await expect(approve).toHaveAttribute('data-approval-state', 'success')
  await expect(approve).toHaveCSS('background-color', 'rgb(4, 120, 87)')
  await expect(approve).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Candidate approved')
  await page.screenshot({ path: 'test-results/approval-success.png' })
  harness()
  await expect(page.getByRole('heading', { name: 'Evaluation result' })).toBeVisible()
  await expect(page.getByLabel('Work review')).toContainText('LLM token savings')
  await expect(page.getByLabel('Work review')).toContainText('Not measured')
  const url = page.url()
  await page.reload()
  await expect(page).toHaveURL(url)
  await expect(page.getByRole('heading', { name: 'Evaluation result' })).toBeVisible()
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.screenshot({ path: 'test-results/autonomous-work-desktop.png', fullPage: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    for (const name of ['Activity', 'Review', 'Monitor']) {
      await page.getByRole('button', { name, exact: true }).click()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  }
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await page.screenshot({ path: 'test-results/autonomous-work-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('lost decision response is reconciled and declined work stays declined', async ({ page }) => {
  fixture()
  await page.goto('/?view=sessions')
  await page.route('**/autonomy/proposals/*/decision', async route => { await route.fetch(); await route.abort('failed') })
  await page.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Work review')).toContainText('This candidate will not be offered to a context adapter.')
  harness()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Approve candidate', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Work review')).toContainText('Declined')
})

test('pause persists and old notes are archived without a direction composer', async ({ page }) => {
  const note = await page.request.post('/api/v1/work-sessions', { data: { request_id: `archive-${Date.now()}`, title: 'Earlier direction', project: 'Repro Relay', prompt: 'This saved note predates autonomous discovery.' } })
  expect(note.ok()).toBe(true)
  await page.goto('/?view=sessions')
  await page.getByRole('button', { name: 'Earlier notes' }).click()
  await page.getByText('Earlier direction', { exact: true }).first().click()
  await expect(page.getByText('This saved note predates autonomous discovery.').first()).toBeVisible()
  await expect(page.locator('textarea')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pause monitoring' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Resume monitoring' })).toBeVisible()
  harness() // Paused worker exits without scanning or claiming.
  await page.getByRole('button', { name: 'Resume monitoring' }).click()
  await expect(page.getByRole('status')).toContainText('Monitoring resumed')
  await page.route('**/api/v1/autonomy', route => route.abort('failed'))
  await page.getByRole('button', { name: 'Refresh work', exact: true }).click()
  await expect(page.getByLabel('Repository monitor')).toContainText('Connection unavailable')
  await page.unroute('**/api/v1/autonomy')
  await page.getByRole('button', { name: 'Refresh work', exact: true }).click()
  await expect(page.getByLabel('Repository monitor')).toContainText('Watching agent instructions')
})
