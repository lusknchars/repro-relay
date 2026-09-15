import { test, expect } from '@playwright/test';

test('Discord setup collects a chosen channel and rechecks a message before saving a todo', async ({ page }) => {
  let configured = false; let watch: any; let intent = false; let collected = false;
  let action: any; let attempts = 0; let sent = 0;
  const message = {id:'123456789012345678',channel_id:'223456789012345678',author_id:'323456789012345678',author:'Alex',text:'Review the failing repository tests.',timestamp:'2026-09-15T12:00:00Z',captured_at:'2026-09-15T12:00:05Z',source_hash:'original-source',url:'https://discord.com/channels/423456789012345678/223456789012345678/123456789012345678'};
  await page.route('**/api/v1/account', r => r.fulfill({json:{enabled:true,authenticated:true,local_access:true,role:'owner',profile:{name:'Discord owner'}}}));
  await page.route('**/api/v1/connections/discord', async r => {
    if (r.request().method()==='POST') { expect(r.request().postDataJSON()).toEqual({token:'private-discord-bot-key'});configured=true;return r.fulfill({json:{configured:true,bot_name:'Relay bot',message_content:false}}); }
    return r.fulfill({json:{configured,bot:configured?{name:'Relay bot'}:null,watch,install_url:configured?'https://discord.com/oauth2/authorize?client_id=523456789012345678&scope=bot&permissions=66560&integration_type=0':null}});
  });
  await page.route('**/api/v1/connections/discord/guilds', r => r.fulfill({json:{items:[{id:'423456789012345678',name:'Repository team'}]}}));
  await page.route('**/api/v1/connections/discord/guilds/*/channels', r => r.fulfill({json:{items:[{id:message.channel_id,name:'planning'}]}}));
  await page.route('**/api/v1/connections/discord/watch', async r => {
    const body=r.request().postDataJSON();expect(body).toEqual({guild_id:'423456789012345678',channel_id:message.channel_id});
    if(!intent){intent=true;return r.fulfill({status:409,json:{detail:'Enable Message Content Intent before collecting this channel.'}});}
    watch={...body,guild_name:'Repository team',channel_name:'planning',enabled:true,last_imported:0};return r.fulfill({json:{enabled:true}});
  });
  await page.route('**/api/v1/connections/discord/sync', r => {collected=true;watch.last_imported=1;watch.last_checked='2026-09-15T12:00:05Z';return r.fulfill({json:{imported:1,empty:false}});});
  await page.route('**/api/v1/connections/discord/pause', r => {watch.enabled=false;return r.fulfill({json:{enabled:false}});});
  await page.route('**/api/v1/discord/messages*', r => r.fulfill({json:{items:collected?[message]:[]}}));
  await page.route('**/api/v1/discord/actions', r => {
    action=r.request().postDataJSON();attempts++;
    if(attempts===1){expect(action.source_hash).toBe('original-source');message.text='Review the failing repository tests on staging.';message.source_hash='edited-source';return r.fulfill({status:409,json:{detail:'Discord source changed. Review the updated message and select it again.'}});}
    expect(action.source_hash).toBe('edited-source');return r.fulfill({json:{id:action.id,created:true,delivery_status:'not_sent'}});
  });
  page.on('request', r=>{if(r.method()==='POST' && /deliver|plow.*send/.test(r.url()))sent++;});
  await page.goto('/?view=settings&connection=discord');
  const settings=page.getByRole('region',{name:'Discord connection',exact:true});
  await settings.getByLabel('Discord bot token').fill('private-discord-bot-key');
  await settings.getByRole('button',{name:'Connect Discord bot',exact:true}).click();
  await expect(settings.getByRole('status')).toContainText('Enable Message Content Intent');
  await expect(settings.getByLabel('Discord bot token')).toHaveValue('');
  await expect(settings.getByRole('link',{name:/Add bot to your Discord server/})).toHaveAttribute('href',/permissions=66560/);
  await settings.getByRole('button',{name:'Load Discord servers'}).click();
  await settings.getByLabel('Discord server',{exact:true}).selectOption('423456789012345678');
  await settings.getByLabel('Discord text channel').selectOption(message.channel_id);
  await settings.getByRole('button',{name:'Start collecting channel'}).click();
  await expect(settings.getByRole('alert')).toContainText('Enable Message Content Intent');
  await settings.getByRole('button',{name:'Start collecting channel'}).click();
  await expect(settings.getByRole('status')).toContainText('Collection enabled');
  await settings.getByRole('button',{name:'Sync Discord now'}).click();
  await expect(settings.getByRole('status')).toContainText('1 new or updated messages saved');
  await page.screenshot({path:'test-results/discord-connection.png',fullPage:true});
  await page.goto('/?view=reach');
  const discussion=page.getByRole('region',{name:'Discord discussion',exact:true});
  await expect(discussion).toContainText('Alex');
  await expect(discussion.getByRole('link',{name:'Open in Discord'})).toHaveAttribute('href',message.url);
  await discussion.getByRole('button',{name:'Make Reach todo',exact:true}).click();
  await discussion.getByLabel('Discord todo title').fill('Review failing tests');
  await discussion.getByRole('button',{name:'Save Discord todo'}).click();
  await expect(discussion.getByRole('alert')).toContainText('source changed');
  await expect(discussion.getByText(message.text,{exact:true})).toBeVisible();
  await discussion.getByRole('button',{name:'Make Reach todo',exact:true}).click();
  await discussion.getByLabel('Discord todo title').fill('Review failing tests on staging');
  await discussion.getByRole('button',{name:'Save Discord todo'}).click();
  await expect(discussion.getByRole('status')).toContainText('Todo saved in Reach and Calendar');
  expect(action.title).toBe('Review failing tests on staging');expect(action.message_id).toBe(message.id);expect(sent).toBe(0);
  expect(await page.locator('body').innerText()).not.toContain('private-discord-bot-key');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('private-discord-bot-key');
  await page.screenshot({path:'test-results/discord-discussion.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto('/?view=settings&connection=discord');
  await settings.getByRole('button',{name:'Pause Discord collection'}).click();
  await expect(settings.getByRole('status')).toContainText('Collection paused');
  await expect(settings.getByRole('button',{name:'Sync Discord now'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
