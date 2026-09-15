import { test, expect, type Page } from '@playwright/test';

// Explicitly synthetic console records; no Hermes runtime or model is contacted.
type Item = {
  id: string; session_id: string; prompt: string; status: string; output: string | null;
  usage: Record<string, number> | null; tool_events: Record<string, unknown>[]; error: string | null;
  created_at: string; updated_at: string;
};
type State = { items: Item[]; active: boolean; posts: Record<string, string>[]; stops: string[]; startError?: string };

async function workspace(page: Page, role: string, state: State) {
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const stop = path.match(/\/hermes\/console\/([^/]+)\/stop$/);
    if (stop) {
      state.stops.push(stop[1]);
      const item = state.items.find(i => i.id === stop[1])!;
      item.status = 'stopping';
      return route.fulfill({json: item});
    }
    if (path.endsWith('/hermes/console') && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.posts.push(body);
      if (state.startError) return route.fulfill({status: 409, json: {detail: state.startError}});
      const now = new Date().toISOString();
      const item = {id: body.id, session_id: body.session_id, prompt: body.prompt, status: 'running', output: null,
        usage: null, tool_events: [], error: null, created_at: now, updated_at: now};
      state.items.push(item);
      state.active = true;
      return route.fulfill({json: item});
    }
    if (path.endsWith('/hermes/console')) {
      return route.fulfill({json: {items: state.items, available: true, active: state.active, limit_seconds: 120}});
    }
    const data = path.endsWith('/account') ? {enabled: true, authenticated: true, local_access: true, role,
        profile: {id: 'fixture', name: 'Fixture Owner', username: 'fixture', bio: ''}}
      : path.endsWith('/team/directory') ? {members: [], has_more: false}
      : path.endsWith('/chat') ? {items: [], configured: false, connection: null}
      : path.endsWith('/runner') ? {available: true}
      : path.endsWith('/workspace/runs') ? {items: [], next_offset: null}
      : path.endsWith('/architectures') ? {templates: [], settings: {}} : [];
    await route.fulfill({json: data});
  });
}

test('owner runs a console prompt and sees tool calls, usage and stop', async ({page}) => {
  const state: State = {items: [], active: false, posts: [], stops: []};
  await workspace(page, 'owner', state);
  await page.goto('/?view=team');
  const region = page.getByRole('region', {name: 'Hermes test console'});
  await expect(region).toBeVisible();
  await region.getByLabel('Prompt for Hermes', {exact: true}).fill('Read notes.txt');
  await region.getByRole('button', {name: 'Run prompt', exact: true}).click();
  await expect(region.getByText('Running', {exact: true})).toBeVisible();
  expect(state.posts[0]).toMatchObject({prompt: 'Read notes.txt'});
  expect(state.posts[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.posts[0].session_id).toMatch(/^[0-9a-f-]{36}$/);

  await region.getByRole('button', {name: 'Stop run', exact: true}).click();
  await expect.poll(() => state.stops).toEqual([state.posts[0].id]);
  await expect(region.getByText('Stopping', {exact: true})).toBeVisible();

  Object.assign(state.items[0], {
    status: 'completed', output: 'Fixture reply', usage: {input_tokens: 120, output_tokens: 30, total_tokens: 150},
    tool_events: [
      {event: 'tool.started', tool: 'mcp__plow_latch__plow_read_file', preview: 'notes.txt'},
      {event: 'tool.completed', tool: 'mcp__plow_latch__plow_read_file', duration: 0.42, error: false},
    ],
  });
  state.active = false;
  await expect(region.getByText('Fixture reply', {exact: true})).toBeVisible();
  await expect(region).toContainText('plow_read_file');
  await expect(region).toContainText('0.42 s');
  await expect(region).toContainText('120 in · 30 out · 150 tokens');
  await expect(region.getByRole('button', {name: 'Stop run'})).toHaveCount(0);
  await page.screenshot({path: 'test-results/hermes-console-desktop.png', fullPage: true});
  await page.setViewportSize({width: 320, height: 900});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('console shows a busy Hermes without clearing the prompt', async ({page}) => {
  const state: State = {items: [], active: false, posts: [], stops: [],
    startError: 'Hermes is busy with another run. Try again when it finishes.'};
  await workspace(page, 'owner', state);
  await page.goto('/?view=team');
  const region = page.getByRole('region', {name: 'Hermes test console'});
  await region.getByLabel('Prompt for Hermes', {exact: true}).fill('Hello');
  await region.getByRole('button', {name: 'Run prompt', exact: true}).click();
  await expect(region.getByRole('alert')).toContainText('Hermes is busy');
  await expect(region.getByLabel('Prompt for Hermes', {exact: true})).toHaveValue('Hello');
});

test('teammates do not see the owner test console', async ({page}) => {
  await workspace(page, 'member', {items: [], active: false, posts: [], stops: []});
  await page.goto('/?view=team');
  await expect(page.getByRole('region', {name: 'Hermes team conversation'})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Hermes test console'})).toHaveCount(0);
});
