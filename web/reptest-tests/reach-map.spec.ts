import { test, expect } from '@playwright/test';

test('Reach maps saved assignments without claiming teammate delivery', async ({ page }) => {
  const members = [{id:'alice',name:'Alice Rivera',role:'maintainer'}, {id:'bob',name:'Bob Chen',role:'viewer'}];
  await page.route('**/api/v1/team/directory', r => r.fulfill({json:{members,has_more:false}}));
  await page.route('**/api/v1/connections/plow', r => r.fulfill({json:{configured:true,grant_verified:true}}));
  await page.route('**/api/v1/reach?**', r => r.fulfill({json:{truncated:false,items:[{id:'request-1',kind:'call_transcript',title:'Review export scope',text:'Confirm archived projects belong in the export.',case_id:'case-1',project:'Billing',due_on:null,members,version:1,source_hash:'fixture',stale:false,action:{title:'Review export scope',member_id:'alice',due_on:null,status:'planned',message_draft:'Alice, please confirm the export scope.'}}]}}));
  await page.goto('/?view=reach');
  const map = page.getByRole('region',{name:'Team communication map'});
  await expect(map.getByText('Owner chat configured',{exact:true})).toBeVisible();
  await expect(map.locator('.reach-wires path')).toHaveCount(1);
  await map.getByRole('button',{name:'Context connection for Alice Rivera',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#reach-communication-details')).toBeFocused();
  await map.getByRole('button',{name:'Inspect Alice Rivera',exact:true}).click();
  await expect(map.getByRole('heading',{name:'Alice Rivera',exact:true})).toBeVisible();
  await expect(map.getByText('Teammate delivery not connected',{exact:true})).toBeVisible();
  await map.getByText('Prepared message & source context',{exact:true}).click();
  await expect(map.getByText('Alice, please confirm the export scope.',{exact:true})).toBeVisible();
  await map.getByRole('button',{name:'Review follow-up',exact:true}).click();
  await expect(page.getByLabel('Reach action',{exact:true})).toHaveValue('Review export scope');
  await expect(page.locator('#reach-review')).toBeFocused();
  await map.getByRole('button',{name:'Inspect Bob Chen',exact:true}).click();
  await expect(map.getByText(/No open follow-ups for this teammate/)).toBeVisible();
  await map.getByLabel('Map project').selectOption('Billing');
  await expect(map.getByRole('button',{name:'Inspect Bob Chen',exact:true})).toHaveCount(0);
  await map.getByLabel('Find teammate in Reach').fill('missing');
  await expect(map.getByText('No teammates match this filter.',{exact:true})).toBeVisible();
  await map.getByLabel('Find teammate in Reach').fill('');
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:940});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await map.getByRole('button',{name:'New follow-up',exact:true}).click();
  await expect(page.getByLabel('New Reach todo',{exact:true})).toBeFocused();
});

test('Reach shows directory failures and an honest empty map after retry', async ({ page }) => {
  let failed = true;
  await page.route('**/api/v1/team/directory', r => failed ? r.fulfill({status:503,json:{error:'Directory offline'}}) : r.fulfill({json:{members:[],has_more:false}}));
  await page.route('**/api/v1/connections/plow', r => r.fulfill({json:{configured:false}}));
  await page.route('**/api/v1/reach?**', r => r.fulfill({json:{items:[],truncated:false}}));
  await page.goto('/?view=reach');
  const map = page.getByRole('region',{name:'Team communication map'});
  await expect(map.getByText('Plow not connected',{exact:true})).toBeVisible();
  await expect(map.getByText(/Team directory unavailable/)).toBeVisible();
  await expect(map.locator('.reach-wires path')).toHaveCount(0);
  failed = false;
  await map.getByRole('button',{name:'Retry team directory',exact:true}).click();
  await expect(map.getByText('Invite teammates in Team to start coordinating follow-ups.',{exact:true})).toBeVisible();
});
