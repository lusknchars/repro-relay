import { test, expect } from '@playwright/test';

test('runtime counters refresh without becoming work costs and handle disconnection', async ({ page }) => {
  let input = 100, unavailable = false;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/usage/runtime')) {
      return route.fulfill({json: unavailable ? {available:false, reason:'Runtime ledger unavailable'} : {
        available:true, totals:{input_tokens:input,output_tokens:25,cache_read_tokens:50,cache_write_tokens:0,total_tokens:input+75,model_calls:1},
        models:[{model:'fixture-model',total_tokens:input+75}], last_activity_at:new Date().toISOString()
      }});
    }
    const data = path.endsWith('/account') ? {enabled:true,authenticated:true,role:'owner',profile:{id:'fixture',name:'Fixture',username:'fixture'}}
      : path.endsWith('/runner') ? {available:true}
      : path.endsWith('/workspace/runs') ? {items:[],next_offset:null}
      : path.endsWith('/architectures') ? {templates:[],settings:{}} : [];
    await route.fulfill({json:data});
  });
  await page.goto('/?view=usage');
  const runtime = page.getByRole('region', {name:'Hermes runtime usage'});
  await expect(runtime).toContainText('175');
  await expect(runtime).toContainText('Dollar cost: Not reported');
  await expect(runtime).toContainText('All time');
  input=120;
  await page.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await expect(runtime).toContainText('195');
  await expect(runtime).not.toContainText('175');
  await expect(runtime).toContainText('not added to case costs');
  await page.screenshot({path:'test-results/runtime-usage-desktop.png',fullPage:true});
  await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  unavailable=true;
  await page.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await expect(runtime).toContainText('Runtime ledger unavailable');
  await expect(runtime).not.toContainText('195');
});
