import { test, expect } from '@playwright/test';

test('Plow leads to private Hermes model setup without claiming activation or changing MCP scope', async ({page}) => {
  let selection={revision:'a'.repeat(64),provider:'kimi-coding',model:'existing-model',managed:false,profile_exists:true,credential_saved:true,providers:[{id:'openai-api',name:'OpenAI API',credential_saved:false},{id:'anthropic',name:'Anthropic / Claude',credential_saved:false},{id:'kimi-coding',name:'Moonshot / Kimi API',credential_saved:true},{id:'openrouter',name:'OpenRouter',credential_saved:false}],mcp_servers:['relay_assessment'],activation:'Restart the dedicated Hermes gateway to load this selection.'};
  let writes=0;let stale=false;let modelCalls=0;
  page.on('request',r=>{if(/api\.anthropic\.com|api\.openai\.com|\/runs$|\/deliver/.test(r.url())&&r.method()==='POST')modelCalls++;});
  await page.route('**/api/v1/connections/model-provider', async r=>{
    if(r.request().method()==='POST'){
      writes++;const body=r.request().postDataJSON();
      if(stale)return r.fulfill({status:422,json:{detail:'Model settings changed. Reload settings and review before saving.'}});
      expect(body).toEqual({revision:selection.revision,provider:'anthropic',model:'model-from-account',api_key:'private-api-key'});
      selection={...selection,revision:'b'.repeat(64),provider:body.provider,model:body.model,managed:true,providers:selection.providers.map(p=>({...p,credential_saved:p.id==='anthropic'||p.id==='kimi-coding'}))};
    }
    return r.fulfill({json:selection});
  });
  await page.goto('/?view=settings&connection=plow');
  await expect(page.getByText(/MCP is the tool connection/)).toBeVisible();
  await page.getByRole('link',{name:'Configure Hermes model provider',exact:true}).click();
  const setup=page.getByRole('region',{name:'Hermes model setup'});
  await expect(setup.getByLabel('Model provider')).toHaveValue('kimi-coding');
  await setup.getByLabel('Model provider').selectOption('anthropic');
  await expect(setup.getByLabel('Model ID')).toHaveValue('');
  await setup.getByLabel('Model ID').fill('model-from-account');
  await setup.getByLabel('Provider API key').fill('private-api-key');
  await setup.getByRole('button',{name:'Save Hermes model'}).click();
  await expect(setup.getByRole('status')).toContainText('Saved for the next Hermes gateway start');
  await expect(setup.getByLabel('Provider API key')).toHaveValue('');
  await expect(setup).toContainText('anthropic / model-from-account');
  await page.reload();
  await expect(setup.getByLabel('Model provider')).toHaveValue('anthropic');
  await setup.getByText('MCP tools and other agent clients',{exact:true}).click();
  await expect(setup).toContainText('relay_assessment');
  stale=true;
  await setup.getByLabel('Model ID').fill('unsaved-model');
  await setup.getByRole('button',{name:'Save Hermes model'}).click();
  await expect(setup.getByRole('alert')).toContainText('Model settings changed');
  await expect(setup.getByLabel('Model ID')).toHaveValue('unsaved-model');
  await setup.getByRole('button',{name:'Reload model settings'}).click();
  await expect(setup.getByLabel('Model ID')).toHaveValue('model-from-account');
  expect(writes).toBe(2);expect(modelCalls).toBe(0);
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('private-api-key');
  await page.screenshot({path:'test-results/model-setup-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
