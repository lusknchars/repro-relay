import { test, expect } from '@playwright/test';

test('Reach hosts a call and saves a transcript-backed todo without sending a message', async ({ page }) => {
  let configured = false; let room: any; const passages: any[] = []; let action: any;
  let consent = false; let saves = 0; let sent = 0;
  await page.route('**/api/v1/account', r => r.fulfill({json: {enabled:true,authenticated:true,local_access:true,role:'owner',profile:{name:'Meeting owner'}}}));
  await page.route('**/api/v1/connections/daily', async r => {
    if (r.request().method() === 'POST') { expect(r.request().postDataJSON()).toEqual({token:'private-daily-key'});configured=true; }
    await r.fulfill({json:{configured}});
  });
  await page.route('**/api/v1/meetings', async r => {
    if (r.request().method() === 'POST') { const body=r.request().postDataJSON();room={...body,url:'https://fixture.daily.co/relay-fixture',status:'ready',expires_at:Math.floor(Date.now()/1000)+3600};await r.fulfill({json:room}); }
    else await r.fulfill({json:{items:room?[room]:[]}});
  });
  await page.route('**/api/v1/meetings/*/join', r => r.fulfill({json:{url:room.url,token:'private-owner-token'}}));
  await page.route('**/api/v1/meetings/*/capture', async r => { consent=r.request().postDataJSON().consent_acknowledged;await r.fulfill({json:{capture_allowed:true}}); });
  await page.route('**/api/v1/meetings/*/transcript', async r => {
    if (r.request().method()==='POST') { expect(consent).toBe(true);saves++;if(saves===1)return r.fulfill({status:503,json:{detail:'Fixture storage interruption'}}); for(const s of r.request().postDataJSON().segments) if(!passages.some(p=>p.id===s.id))passages.push(s);await r.fulfill({json:{saved:true}}); }
    else await r.fulfill({json:{items:passages}});
  });
  await page.route('**/api/v1/meetings/*/actions', async r => {action=r.request().postDataJSON();await r.fulfill({json:{id:`calendar-${action.id}`,created:true,delivery_status:'not_sent'}});});
  await page.route('**/api/v1/meetings/*/close', async r => {room.status='closed';await r.fulfill({json:room});});
  page.on('request', r => {if(r.method()==='POST' && /deliver|plow.*send/.test(r.url()))sent++;});
  // Replace only the SDK boundary in this browser test; production uses Daily.
  await page.route('**/src/lib/daily-client.ts*', r => r.fulfill({contentType:'application/javascript',body:`
    export function createDailyClient(container) {
      const handlers={};const emit=(name,event={})=>(handlers[name]||[]).forEach(fn=>fn(event));
      const panel=document.createElement('div');panel.textContent='Fixture video surface';container.append(panel);
      const speech=document.createElement('button');speech.textContent='Fixture participant speaks';panel.append(speech);
      speech.onclick=()=>emit('transcription-message',{participantId:'participant-one',text:'Review the flaky tests tomorrow.',timestamp:'2026-09-15T12:00:00Z'});
      return {on(name,fn){(handlers[name]||=[]).push(fn);return this;},
        async join(access){if(access.token!=='private-owner-token')throw Error('Missing owner token');emit('joined-meeting');},
        participants(){return {remote:{session_id:'participant-one',user_name:'Alex'}};},
        startTranscription(){setTimeout(()=>emit('transcription-started'),30);},stopTranscription(){emit('transcription-stopped');},
        async leave(){emit('left-meeting');},async destroy(){panel.remove();}};
    }` }));
  await page.goto('/?view=settings&connection=daily');
  await page.getByLabel('Daily API key',{exact:true}).fill('private-daily-key');
  await page.getByRole('button',{name:'Connect Daily',exact:true}).click();
  await expect(page.getByRole('region',{name:'Daily connection'}).getByRole('status')).toContainText('Daily access checked');
  await expect(page.getByLabel('Daily API key',{exact:true})).toHaveValue('');
  await page.goto('/?view=reach');
  await page.getByLabel('Meeting title',{exact:true}).fill('Repository planning');
  await page.getByRole('button',{name:'Create call',exact:true}).click();
  await expect(page.getByText('https://fixture.daily.co/relay-fixture',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Join in Relay',exact:true}).click();
  await expect(page.getByText('Joined',{exact:true})).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'Work',exact:true}).click();
  await expect(page.getByText(/Leave the call and save pending/)).toBeVisible();
  await expect(page).toHaveURL(/view=reach/);
  await expect(page.getByRole('button',{name:'Start transcription',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:/Everyone has agreed/}).check();
  await page.getByRole('button',{name:'Start transcription',exact:true}).click();
  await expect(page.getByText('Transcription: Live',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Fixture participant speaks'}).click();
  await expect(page.getByText(/Transcript not saved: Fixture storage interruption/)).toBeVisible();
  await page.getByRole('button',{name:'Retry transcript save'}).click();
  await expect(page.getByRole('region',{name:'Saved meeting transcript'})).toContainText('Review the flaky tests tomorrow.');
  await page.getByRole('button',{name:'Make todo',exact:true}).click();
  await page.getByLabel('Todo title',{exact:true}).fill('Review flaky repository tests');
  await page.getByRole('button',{name:'Save Reach todo',exact:true}).click();
  await expect(page.getByText(/Todo saved in Reach and Calendar/)).toBeVisible();
  expect(action.segment_id).toBe(passages[0].id);expect(passages[0].speaker).toBe('Alex');expect(passages).toHaveLength(1);expect(sent).toBe(0);
  expect(await page.locator('body').innerText()).not.toContain('private-owner-token');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toMatch(/private-owner-token|private-daily-key/);
  await page.getByRole('button',{name:'Stop transcription',exact:true}).click();
  await expect(page.getByText('Transcription: Off',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Leave call',exact:true}).click();
  await expect(page.getByText('Left call',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'End room for everyone',exact:true}).click();
  await expect(page.getByText('Room closed',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Join in Relay',exact:true})).toBeDisabled();
  await page.screenshot({path:'test-results/reach-meeting-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
