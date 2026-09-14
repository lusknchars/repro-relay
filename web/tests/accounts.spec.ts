import { test, expect, type BrowserContext } from '@playwright/test'

const item = {id:'RR-team-case',title:'Shared accessibility investigation',project:'Relay',url:'http://127.0.0.1:5178/',description:'Saved report',expected:'Keep the original evidence',build:'fixture-build',status:'new',revision:1,owner_version:1,created_at:'2026-09-14T12:00:00Z',updated_at:'2026-09-14T12:00:00Z',observations:[],events:[],handoffs:[]}
const invite = 'a'.repeat(64)
async function fixture(context: BrowserContext, mode: 'local' | 'team', signedIn = false) {
  let signed=signedIn, created=signedIn, name='Test teammate', bio='', role=mode==='local'?'owner':'viewer'
  const writes: {path:string;body:Record<string,unknown>}[]=[]
  await context.route('**/api/v1/**',async route => {
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1',''),body=req.method()==='POST'?req.postDataJSON():{}
    if(req.method()==='POST')writes.push({path,body})
    if(path==='/account/register') {signed=true;created=true;name=body.name;return route.fulfill({json:{authenticated:true,return_to:mode==='team'?'/?view=agents&case=RR-team-case':'/'}})}
    if(path==='/account/logout'){signed=false;return route.fulfill({json:{authenticated:false}})}
    if(path==='/account' && req.method()==='POST'){name=body.name;bio=body.bio}
    const result=path==='/session'?{mode,authenticated:mode==='local'||signed,role:signed?role:undefined}
      : path==='/account'?{enabled:true,authenticated:signed,bootstrap_available:mode==='local'&&!created,shared:mode==='team',role:signed?role:null,profile:signed?{id:'ACC-fixture',username:'teammate',name,bio}:undefined}
      : path==='/team/invites'?{id:'INV-fixture',url:`http://127.0.0.1:5178/#invite=${invite}`,local_only:true,role:'viewer'}
      : path==='/team'?{members:[{id:'ACC-fixture',name,username:'teammate',role}],invites:[]}
      : path==='/health'?{status:'ok',mode,integrations:{}}
      : path==='/cases'?[item]
      : path==='/runner'?{available:false,reason:'Fixture runtime disconnected'}
      : path.endsWith('/investigation-preview')?{context:{},context_hash:'fixture',case_revision:1,owner_version:1,build:item.build,follow_up_review_id:null}
      : path.endsWith('/runs')||path.endsWith('/run-reviews')?[]
      : /\/(journal|artifacts|findings)$/.test(path)?{items:[],next_cursor:null}:[]
    return route.fulfill({json:result})
  })
  return writes
}

test('owner creates a profile and an invitation to the selected investigation',async({page,context})=>{
  const writes=await fixture(context,'local')
  await page.goto('/')
  await page.getByRole('button',{name:'Account & team',exact:true}).click()
  await page.getByRole('menuitem',{name:'Create account',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Account & team',exact:true})
  await dialog.getByLabel('Display name',{exact:true}).fill('Taylor')
  await dialog.getByLabel('Username',{exact:true}).fill('taylor')
  await dialog.getByLabel('Password',{exact:true}).fill('fixture-only-long-password')
  await dialog.getByRole('button',{name:'Create owner account',exact:true}).click()
  await expect(dialog).toHaveCount(0)
  await page.goto('/?view=agents&case=RR-team-case')
  await page.getByRole('button',{name:'Account & team',exact:true}).click()
  await page.getByRole('menuitem',{name:'My profile',exact:true}).click()
  await dialog.getByLabel('About you').fill('Product and test coverage')
  await dialog.getByRole('button',{name:'Save profile',exact:true}).click()
  await expect(dialog.getByRole('status')).toHaveText('Profile saved.')
  await dialog.getByRole('button',{name:'Team',exact:true}).click()
  await dialog.getByRole('button',{name:'Create invitation link',exact:true}).click()
  await expect(dialog.getByLabel('Local preview invitation')).toHaveValue(`http://127.0.0.1:5178/#invite=${invite}`)
  expect(writes.find(x=>x.path==='/team/invites')?.body.return_to).toBe('/?view=agents&case=RR-team-case')
  await expect(dialog).toContainText('This localhost link opens only on this Mac.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Account & team',exact:true})).toBeFocused()
})

test('invited teammate joins the saved case and returns with viewer controls',async({page,context})=>{
  const writes=await fixture(context,'team')
  await page.setViewportSize({width:320,height:900})
  await page.goto(`/#invite=${invite}`)
  await expect(page.getByRole('heading',{name:'Return to your team’s work'})).toBeVisible()
  await page.getByRole('button',{name:'Create an account',exact:true}).click()
  await page.getByLabel('Display name',{exact:true}).fill('Morgan')
  await page.getByLabel('Username',{exact:true}).fill('morgan')
  await page.getByLabel('Password',{exact:true}).fill('fixture-only-long-password')
  await page.getByRole('button',{name:'Create account and join',exact:true}).click()
  await expect(page).toHaveURL(/view=agents&case=RR-team-case/)
  await expect(page.getByText(/Viewer access · Follow/)).toBeVisible()
  await expect(page.getByRole('heading',{name:item.title,exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'New investigation report',exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'Start Hermes investigation',exact:true})).toHaveCount(0)
  expect(writes[0].body.invite_token).toBe(invite)
  await page.reload()
  await expect(page.getByRole('heading',{name:item.title,exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.getByRole('button',{name:'Account & team',exact:true}).click()
  await page.getByRole('menuitem',{name:'My profile',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Account & team'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Create invitation link'})).toHaveCount(0)
  await page.screenshot({path:'test-results/team-viewer-profile.png',fullPage:true})
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Return to your team’s work'})).toBeVisible()
  expect(writes.map(w=>w.path)).toEqual(['/account/register','/account/logout'])
})


test('profile menu keeps identity, settings, theme and navigation connected', async ({page,context}) => {
  const writes=await fixture(context,'local',true)
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/')
  const trigger=page.getByRole('button',{name:'Account & team',exact:true})
  await trigger.focus()
  await page.keyboard.press('Enter')
  const menu=page.getByRole('menu',{name:'Account & team'})
  await expect(menu).toContainText('Test teammate')
  await expect(menu).toContainText('owner')
  await menu.getByRole('menuitem',{name:'My profile',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Account & team',exact:true})
  await dialog.getByLabel('Display name',{exact:true}).fill('Morgan Lee')
  await dialog.getByRole('button',{name:'Save profile',exact:true}).click()
  await expect(dialog.getByRole('status')).toHaveText('Profile saved.')
  await expect(dialog.getByLabel('Current password')).toBeHidden()
  await expect(dialog.getByRole('button',{name:'Create invitation link'})).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(trigger).toContainText('ML')
  await trigger.click()
  await expect(menu).toContainText('Morgan Lee')
  await menu.getByRole('menuitemcheckbox',{name:'Dark mode'}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
  await expect(menu.getByRole('menuitemcheckbox',{name:'Dark mode'})).toBeChecked()
  await page.screenshot({path:'test-results/profile-menu-dark.png'})
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'Switch to light theme'}).click()
  await trigger.click()
  await expect(menu.getByRole('menuitemcheckbox',{name:'Dark mode'})).not.toBeChecked()
  await menu.getByRole('menuitem',{name:'Password & security'}).click()
  await expect(dialog.getByLabel('Current password')).toBeVisible()
  await expect(dialog.getByLabel('About you')).toBeHidden()
  await page.keyboard.press('Escape')
  await trigger.click()
  await menu.getByRole('menuitem',{name:'Connections & setup'}).click()
  await expect(page).toHaveURL(/view=connections/)
  await page.setViewportSize({width:320,height:900})
  await trigger.click()
  await expect(menu).toBeVisible()
  expect(await menu.evaluate(e=>e.getBoundingClientRect().right<=innerWidth && e.getBoundingClientRect().left>=0)).toBe(true)
  await page.screenshot({path:'test-results/profile-menu-phone.png'})
  await menu.getByRole('menuitem',{name:'Sign out',exact:true}).click()
  await expect(trigger).toHaveAttribute('title','Account & team')
  await trigger.click()
  await expect(menu.getByRole('menuitem',{name:'Sign in',exact:true})).toBeVisible()
  expect(writes.map(w=>w.path)).toEqual(['/account','/account/logout'])
  expect(errors).toEqual([])
})
