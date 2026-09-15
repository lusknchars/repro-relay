import { test, expect } from '@playwright/test';

test('usage reference layout filters real records and preserves unknown costs', async ({ page }) => {
  let offline = false;
  const now = new Date().toISOString();
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (offline && path.endsWith('/workspace/runs')) return route.fulfill({status: 503, json: {detail: 'Usage fixture offline'}});
    const data = path.endsWith('/account') ? {enabled: true, authenticated: true, role: 'owner', profile: {id: 'fixture', name: 'Fixture', username: 'fixture'}}
      : path.endsWith('/runner') ? {available: false}
      : path.endsWith('/architectures') ? {templates: [], settings: {}}
      : path.endsWith('/cases') ? [{id: 'CASE-A', title: 'Export failure fixture', status: 'new'}, {id: 'CASE-B', title: 'Webhook fixture', status: 'new'}]
      : path.endsWith('/workspace/runs') ? {items: [
        {id:'run-cost', case_id:'CASE-A', created_at:now, status:'completed', execution_kind:'hermes', usage:{total_tokens:1500, input_tokens:1000, output_tokens:500, cost_usd:2}},
        {id:'run-zero', case_id:'CASE-A', created_at:now, status:'completed', execution_kind:'hermes', usage:{total_tokens:500, cost_usd:0}},
        {id:'run-unknown', case_id:'CASE-B', created_at:now, status:'queued', execution_kind:'hermes', usage:null},
        {id:'run-old', case_id:'CASE-B', created_at:'2020-01-01T00:00:00Z', status:'completed', execution_kind:'hermes', usage:{cost_usd:5}},
        {id:'run-local', case_id:'CASE-A', created_at:now, status:'completed', execution_kind:'local_validation', usage:{cost_usd:999}}
      ], next_offset:null} : [];
    await route.fulfill({json:data});
  });
  await page.goto('/?view=usage');
  for (const name of ['Spend on one problem', 'Cost per attempt', 'Where the money went', 'Spend by problem', 'Agents', 'Efficiency']) {
    await expect(page.getByRole('heading', {name, exact:true})).toBeVisible();
  }
  const audit = page.getByRole('region', {name:'Usage audit table'});
  await expect(audit.getByRole('row')).toHaveCount(4);
  await expect(audit.getByRole('row').filter({hasText:'run-zero'})).toContainText('$0.00');
  await expect(audit.getByRole('row').filter({hasText:'run-unknown'})).toContainText('Not reported');
  await expect(audit).not.toContainText('run-local');
  await page.getByLabel('Work record', {exact:true}).selectOption('CASE-B');
  const selected = page.locator('section').filter({has:page.getByRole('heading',{name:'Spend on one problem',exact:true})});
  await expect(selected).toContainText('Not reported');
  await page.getByRole('button',{name:'All loaded',exact:true}).click();
  await expect(audit.getByRole('row')).toHaveCount(5);
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  expect((await download).suggestedFilename()).toBe('repro-relay-usage.json');
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:940});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({width:1440,height:940});
  offline=true;
  await page.getByRole('button',{name:'Refresh usage'}).click();
  await expect(page.getByRole('alert')).toContainText('Usage fixture offline');
  await expect(audit).not.toContainText('run-cost');
});
