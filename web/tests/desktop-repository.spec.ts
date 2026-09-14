import { test, expect } from '@playwright/test'

test('native repository tools stay usable offline and keep Git and runtime state separate',async({page})=>{
  const writes:string[]=[]
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{
    let selected=false
    const commands:string[]=[]
    const snapshot={root:'/workspace/relay demo',branch:'main',head:'a'.repeat(40),changes:' M src/report.ts',worktrees:'worktree /workspace/relay demo\nHEAD '+ 'a'.repeat(40)+'\nbranch refs/heads/main\n\nworktree /workspace/candidate\nHEAD '+ 'b'.repeat(40)+'\ndetached'}
    Object.defineProperty(window,'__TAURI_INTERNALS__',{value:{invoke:async(command:string)=>{
      commands.push(command)
      if(command==='repository_status')return selected?snapshot:null
      if(command==='select_repository'){selected=true;return snapshot}
      if(command==='open_repository_terminal')return null
      throw new Error('Native event service is not part of this fixture')
    }}})
    Object.defineProperty(window,'nativeFixtureCommands',{value:commands})
  })
  await page.route('**/api/v1/**',route=>{
    if(route.request().method()!=='GET')writes.push(route.request().url())
    return route.fulfill({status:503,json:{detail:'Fixture workspace is offline'}})
  })
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.setViewportSize({width:1280,height:900})
  await page.goto('/')
  const dock=page.getByRole('region',{name:'Native repository tools'})
  await expect(page.getByRole('heading',{name:'Connect your local workspace.'})).toBeVisible()
  await expect(dock.getByRole('button',{name:'Open terminal'})).toBeDisabled()
  await dock.getByRole('button',{name:'Open repository',exact:true}).click()
  await expect(dock).toContainText('relay demo')
  await expect(dock).toContainText('src/report.ts')
  await expect(dock).toContainText('Workspace offline')
  await dock.getByRole('button',{name:'Worktrees',exact:true}).click()
  await expect(dock).toContainText('/workspace/candidate')
  await expect(dock).toContainText('Detached checkout')
  await dock.getByRole('button',{name:'Connection',exact:true}).click()
  await expect(dock).toContainText('Runtime availability has not been confirmed.')
  await dock.getByRole('button',{name:'Open terminal'}).click()
  await expect(dock.getByRole('status')).toHaveText('Terminal opened in this repository.')
  await dock.getByRole('button',{name:'Refresh Git'}).click()
  await expect(dock.getByRole('button',{name:'Refresh Git'})).toBeEnabled()
  await expect.poll(()=>dock.evaluate(e=>parseFloat(getComputedStyle(document.body).paddingBottom)>=e.getBoundingClientRect().height-1)).toBe(true)
  await page.screenshot({path:'test-results/desktop-repository-panel.png'})
  await page.setViewportSize({width:780,height:700})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await expect(dock.getByRole('button',{name:'Workspace offline'})).toBeVisible()
  await dock.getByRole('button',{name:'Worktrees',exact:true}).focus()
  await page.keyboard.press('Escape')
  await expect(dock.getByRole('button',{name:'relay demo',exact:true})).toBeFocused()
  await expect(dock.getByRole('button',{name:'relay demo',exact:true})).toHaveAttribute('aria-expanded','false')
  const commands=await page.evaluate(()=>(window as unknown as {nativeFixtureCommands:string[]}).nativeFixtureCommands)
  expect(commands).toContain('select_repository')
  expect(commands).toContain('open_repository_terminal')
  expect(writes).toEqual([])
  expect(errors).toEqual([])
})
