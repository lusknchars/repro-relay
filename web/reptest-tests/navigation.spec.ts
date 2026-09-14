import {expect,test} from '@playwright/test'

test('real case, bounded investigation, persisted review and inline usage in supplied shell',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const report=await page.request.post('/api/v1/cases',{headers:{'Idempotency-Key':`live-ui-${Date.now()}`},data:{title:`Connected UI fixture ${Date.now()}`,project:'UI integration fixture',url:'https://example.com',description:'Controlled test of Relay persistence. No live browser investigation.',expected:'Retain the report and review',build:'fixture-ui'}});
 expect(report.ok()).toBe(true);const item=await report.json();
 await page.goto(`/?case=${item.id}`);
 await expect(page.getByRole('heading',{name:item.title,exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Conversation and decisions'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Investigate · 2 min limit'})).toBeEnabled();
 const submitted=page.waitForResponse(r=>r.url().endsWith(`/cases/${item.id}/runs`)&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Investigate · 2 min limit'}).click();expect((await submitted).ok()).toBe(true);
 await expect(page.getByText('Controlled fixture proposal',{exact:false})).toBeVisible({timeout:25000});
 await page.getByLabel('Reviewer',{exact:true}).fill('UI fixture reviewer');await page.getByLabel('Review feedback').fill('Fixture-only assessment; persistence verified.');
 const reviewed=page.waitForResponse(r=>r.url().includes('/reviews')&&r.request().method()==='POST');await page.getByRole('button',{name:'Accept result',exact:true}).click();expect((await reviewed).ok()).toBe(true);
 await page.reload();await expect(page.getByRole('heading',{name:item.title,exact:true})).toBeVisible();
 const reviews=await page.request.get(`/api/v1/cases/${item.id}/run-reviews`);expect(await reviews.json()).toEqual(expect.arrayContaining([expect.objectContaining({decision:'accepted'})]));
 await page.locator('aside').getByRole('button',{name:'Usage',exact:true}).click();await page.getByRole('combobox',{name:/^Work record/}).selectOption(item.id);
 await expect(page.getByRole('cell',{name:'0.0020',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:/fixture-model/})).toBeVisible();
 await page.screenshot({path:'test-results/live-ui-usage.png'});
 for(const name of ['Team','Knowledge','Settings','Work']){await page.locator('aside').getByRole('button',{name:new RegExp(`^${name}`)}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();}
 await page.getByRole('button',{name:'Customize appearance'}).click();await page.getByRole('dialog').getByRole('radio',{name:'Violet',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-accent','violet');
 await page.getByRole('button',{name:'Switch to dark mode'}).click();await expect(page.locator('html')).toHaveClass(/dark/);
 await page.setViewportSize({width:390,height:844});for(const name of ['Team','Knowledge','Usage','Settings','Work']){await page.getByRole('navigation',{name:'Phone navigation'}).getByRole('button',{name,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 if (await page.getByRole('button',{name:'Work history',exact:true}).isVisible()) await page.getByRole('button',{name:'Work history',exact:true}).click();
 await page.getByRole('region',{name:'Work history'}).getByRole('button',{name:new RegExp(item.title)}).click(); await expect(page.getByRole('heading',{name:item.title,exact:true})).toBeVisible(); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('API failure is visible and never leaves invented work or connection success',async({page})=>{
 await page.route('**/api/v1/workspace/runs*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Workspace temporarily unavailable.'})}));
 await page.goto('/');await expect(page.getByRole('alert')).toContainText('Workspace temporarily unavailable.');await expect(page.getByText('REL-142',{exact:true})).toHaveCount(0);
 await page.locator('aside').getByRole('button',{name:/^Settings/}).click();
 await page.route('**/api/v1/connections/plow/check',route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({detail:'Line verification unavailable.'})}));
 await page.getByRole('button',{name:'Check Plow connection'}).click();await expect(page.getByRole('alert')).toContainText('Line verification unavailable.');await expect(page.getByText('Line and owner chat verified.',{exact:true})).toHaveCount(0);
});


test('sign-in stays available when workspace reads require authentication', async ({page}) => {
 await page.route('**/api/v1/account', route => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,authenticated:false,shared:true,bootstrap_available:false})}));
 await page.route('**/api/v1/cases?*', route => route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({detail:'Sign in to view this workspace.'})}));
 await page.goto('/?view=team');
 await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 await expect(page.getByLabel('Username',{exact:true})).toBeVisible();
});
