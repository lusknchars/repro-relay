import { test, expect } from '@playwright/test'

async function mockWebMCP(page: import('@playwright/test').Page, legacy = false) {
  await page.addInitScript(({ legacy }) => {
    const tools = new Map<string, { name: string; execute: (args: unknown, options?: { signal?: AbortSignal }) => Promise<unknown> }>()
    Object.assign(window, { relayTestTools: tools })
    const api = {
      registerTool(tool: { name: string; execute: (args: unknown) => Promise<unknown> }, options: { signal?: AbortSignal }) {
        if (tools.has(tool.name)) throw new Error('Tool already registered')
        tools.set(tool.name, tool)
        if (!legacy) options.signal?.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) })
        return legacy ? undefined : Promise.resolve()
      },
      unregisterTool(name: string) { tools.delete(name) },
    }
    Object.defineProperty(legacy ? navigator : document, 'modelContext', { value: api, configurable: true })
  }, { legacy })
}
async function invoke(page: import('@playwright/test').Page, name: string, args = {}) {
  return page.evaluate(async ({ name, args }) => {
    const tools = (window as unknown as { relayTestTools: Map<string, { execute: (args: unknown) => Promise<unknown> }> }).relayTestTools
    return tools.get(name)!.execute(args)
  }, { name, args })
}

test('WebMCP exposes bounded evidence without granting approval or write tools', async ({ page }) => {
  await mockWebMCP(page)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  let writes = 0; page.on('request', r => { if (r.method() !== 'GET' && r.url().includes('/autonomy')) writes++ })
  await page.goto('/?view=connections')
  await page.getByText('Terminal and browser setup', { exact: true }).click()
  await expect(page.getByText('3 browser tools registered')).toBeVisible()
  const status = await invoke(page, 'relay_workspace_status') as { tool_permissions: { approvals: boolean }; capabilities: { model_calls: boolean } }
  expect(status.tool_permissions.approvals).toBe(false)
  expect(status.capabilities.model_calls).toBe(false)
  const list = await invoke(page, 'relay_list_work', { limit: 1 }) as { items: { id: string }[] }
  expect(list.items.length).toBeLessThanOrEqual(1)
  if (list.items.length) {
    const detail = await invoke(page, 'relay_inspect_work', { audit_id: list.items[0].id, file_limit: 1 }) as { files: unknown[]; review_url: string; interpretation: string }
    expect(detail.files.length).toBeLessThanOrEqual(1)
    expect(detail.interpretation).toContain('Not an independently verified code change')
    expect(detail.review_url).toContain(list.items[0].id)
  }
  await expect(invoke(page, 'relay_list_work', { limit: 200 })).rejects.toThrow('Invalid limit')
  await expect(invoke(page, 'relay_workspace_status', { command: 'write source' })).rejects.toThrow('Unexpected argument')
  await expect(invoke(page, 'relay_workspace_status', { toString: 'unexpected' })).rejects.toThrow('Unexpected argument')
  await page.getByText('Recipe: inspect evidence and bring back a decision').click()
  await expect(page.getByText('Show the result and its review link to the user. Keep approvals in the application.')).toBeVisible()
  await page.getByRole('button', { name: 'Run evidence recipe' }).click()
  await expect(page.getByText('Evidence ready for review')).toBeVisible()
  await expect(page.getByText(/3 read-only tool calls/)).toBeVisible()
  await page.screenshot({ path: 'test-results/relay-tools-connections.png', fullPage: true })
  expect(writes).toBe(0); expect(errors).toEqual([])
})

test('legacy preview registers tools and unsupported browsers retain normal guidance', async ({ page }) => {
  await mockWebMCP(page, true)
  await page.goto('/?view=connections')
  await page.getByText('Terminal and browser setup', { exact: true }).click()
  await expect(page.getByText('3 browser tools registered')).toBeVisible()
  await expect(invoke(page, 'relay_inspect_work', { audit_id: '../AGENTS.md' })).rejects.toThrow('Invalid audit ID')
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/relay-tools-mobile.png', fullPage: true })
})

test('overview gives direct routes and guest sessions never register local tools', async ({ page }) => {
  await mockWebMCP(page)
  await page.goto('/')
  await page.getByLabel('Workspace guide').getByRole('button', { name: 'Go to connections', exact: true }).click()
  await expect(page).toHaveURL(/view=connections/)
  await page.goto('/?view=sessions')
  await page.route('**/api/v1/session', route => route.fulfill({ json: { mode: 'guest', authenticated: true } }))
  await page.reload()
  expect(await page.evaluate(() => (window as unknown as { relayTestTools: Map<string, unknown> }).relayTestTools.size)).toBe(0)
  await expect(page.getByRole('heading', { name: 'Autonomous work runs in your local workspace' })).toBeVisible()
})


test('unsupported WebMCP keeps the human recipe usable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'modelContext', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'modelContext', { value: undefined, configurable: true })
  })
  await page.goto('/?view=connections')
  await page.getByText('Terminal and browser setup', { exact: true }).click()
  await expect(page.getByText('Not available in this browser')).toBeVisible()
  await page.getByRole('button', { name: 'Run evidence recipe' }).click()
  await expect(page.getByText('Evidence ready for review')).toBeVisible()
  await page.getByRole('link', { name: 'Open this evidence' }).click()
  await expect(page).toHaveURL(/view=sessions&audit=SCAN-/)
})
