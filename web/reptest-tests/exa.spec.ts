import { test, expect } from '@playwright/test';
test('Exa setup, explicit search, saved sources and private keys', async ({ page }) => {
  let configured = false; const queries: string[] = [];
  const record = { id: 'research-fixture', query: 'Rust architecture patterns', status: 'completed', result: { captured_at: '2026-09-15T12:00:00Z', estimated_cost_usd: 0.007, sources: [{ title: 'Official architecture guide', url: 'https://example.org/architecture', text: 'Reference architecture from the documentation.', published_at: '' }] } };
  await page.route('**/api/v1/account', r => r.fulfill({json: {enabled: true, authenticated: true, local_access: true, role: 'owner', profile: {name: 'Fixture owner'}}}));
  await page.route('**/api/v1/connections/exa', async r => {
    if (r.request().method() === 'POST') { expect(r.request().postDataJSON()).toEqual({token: 'private-exa-fixture'}); configured = true; }
    await r.fulfill({json: {configured}});
  });
  await page.route('**/api/v1/architectures/research', async r => {
    if (r.request().method() === 'POST') { const b = r.request().postDataJSON(); expect(Object.keys(b).sort()).toEqual(['id', 'query']); queries.push(b.query); await r.fulfill({json: record}); }
    else await r.fulfill({json: {items: queries.length ? [record] : []}});
  });
  await page.goto('/?view=settings');
  const list = page.getByRole('button', {name: /^Exa Architecture research/}); await list.click();
  await page.getByLabel('Exa API key', {exact: true}).fill('private-exa-fixture');
  await page.getByRole('button', {name: 'Save Exa key', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Exa connection'})).toContainText('Key saved');
  await expect(page.getByLabel('Exa API key', {exact: true})).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('private-exa-fixture');
  expect(queries).toHaveLength(0);
  await page.route('**/api/v1/architectures/repository', r => r.fulfill({json: {current: true, snapshot: {repository: 'Fixture repo', revision: 'fixture-revision', dirty: false, nodes: []}}}));
  await page.route('**/api/v1/runner', r => r.fulfill({json: {available: true}}));
  await page.route('**/api/v1/workspace/runs*', r => r.fulfill({json: {items: []}}));
  let assessmentBody: any;
  await page.route('**/api/v1/cases', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    assessmentBody = r.request().postDataJSON();
    await r.fulfill({json: {...assessmentBody, id: 'exa-work-fixture', revision: 1, status: 'new'}});
  });
  await page.route('**/api/v1/cases/exa-work-fixture/runs', r => r.fulfill({json: {id: 'fixture-run', status: 'queued'}}));
  await page.goto('/?view=architecture');
  await page.getByText('Search architectures & tools with Exa', {exact: true}).click();
  await page.getByLabel('Search query', {exact: true}).fill(record.query);
  await page.getByRole('button', {name: 'Search with Exa', exact: true}).click();
  await expect(page.getByText('completed · Exa estimate: $0.0070', {exact: false})).toBeVisible();
  await page.getByRole('checkbox', {name: 'Use source: Official architecture guide'}).check();
  await expect(page.getByText('Search architectures & tools with Exa · 1 sources selected', {exact: true})).toBeVisible();
  await page.getByText('Extracted text', {exact: true}).click();
  await expect(page.getByText('Reference architecture from the documentation.', {exact: true})).toBeVisible();
  await page.screenshot({path: 'test-results/exa-research-desktop.png', fullPage: true});
  await page.getByRole('button', {name: 'Research improvements · 2 min', exact: true}).click();
  await expect.poll(() => assessmentBody?.description || '').toContain('https://example.org/architecture');
  expect(assessmentBody.description.toLowerCase()).toContain('untrusted');
  expect(assessmentBody.description).toContain(record.id);
  expect(assessmentBody.description).not.toContain('private-exa-fixture');
  await page.goto('/?view=architecture'); await page.getByText('Search architectures & tools with Exa', {exact: true}).click();
  await page.getByLabel('Recent searches').selectOption(record.id);
  await expect(page.getByRole('checkbox', {name: 'Use source: Official architecture guide'})).not.toBeChecked();
  expect(queries).toEqual([record.query]);
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Search query', {exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/exa-research-mobile.png',fullPage:true});
});
