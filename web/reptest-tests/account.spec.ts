import { expect, test } from '@playwright/test';

test('desktop account chooser signs in through IPC without navigating away', async ({ page }) => {
  const calls: {path:string;method:string;body?:unknown}[] = [];
  let signedIn = false;
  const anonymous = {enabled:true,authenticated:false,bootstrap_available:true};
  const profile = {enabled:true,authenticated:true,role:'owner',profile:{id:'fixture',name:'Account fixture',username:'fixture',bio:''}};
  await page.exposeFunction('nativeAccount', async (command:string, args:{path:string;method:string;body?:{password?:string}}) => {
    expect(command).toBe('account_request');
    calls.push(args);
    if(args.path==='/account/login') {
      if(args.body?.password!=='fixture password long enough') return {status:401,body:{detail:'Username or password is incorrect.'},session_persistent:false};
      signedIn = true;
    }
    if(args.path==='/account/logout') signedIn=false;
    return {status:200,body:args.path==='/team'?{members:[],invites:[]}:signedIn?profile:anonymous,session_persistent:true};
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {value:{invoke:(command:string,args:unknown)=>(window as unknown as {nativeAccount:(c:string,a:unknown)=>Promise<unknown>}).nativeAccount(command,args)}});
  });
  await page.route('**/api/v1/**', route => {
    const path=new URL(route.request().url()).pathname;
    if(path.includes('/account')||path.includes('/team')) throw new Error('Desktop account escaped native transport');
    return route.fulfill({json:path.endsWith('/runner')?{available:false}:path.endsWith('/runs')?{items:[],next_offset:null}:[]});
  });
  await page.goto('/?view=work');
  await page.getByRole('button',{name:/^Account:/}).click();
  const dialog=page.getByRole('dialog',{name:'Relay account'});
  await expect(dialog.getByRole('heading',{name:'Choose a way to sign in or sign up'})).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await page.emulateMedia({colorScheme:'dark'});
  await expect(dialog.getByRole('button',{name:'Sign in to Relay',exact:true})).toHaveCSS('color','rgb(236, 236, 241)');
  await dialog.screenshot({path:'test-results/account-chooser-dark.png', animations:'disabled'});
  await dialog.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(dialog.getByLabel('Display name')).toBeVisible();
  await expect(dialog.getByLabel('Invitation link or token')).toHaveCount(0);
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  await dialog.getByRole('button',{name:'Sign in to Relay',exact:true}).click();
  await dialog.getByLabel('Username',{exact:true}).fill('fixture');
  await dialog.getByLabel('Password',{exact:true}).fill('wrong password');
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Username or password is incorrect.');
  await dialog.getByLabel('Password',{exact:true}).fill('fixture password long enough');
  await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Account fixture',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/view=work/);
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('fixture password');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button',{name:/^Account:/})).toBeFocused();
  await page.reload();
  await page.getByRole('button',{name:/^Account:/}).click();
  await expect(dialog.getByRole('heading',{name:'Account fixture',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Sign in to Relay',exact:true})).toBeVisible();
  await page.setViewportSize({width:320,height:740});
  const bounds=await dialog.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x||0)+(bounds?.width||0)).toBeLessThanOrEqual(320);
  expect(calls.filter(c=>c.path==='/account/login')).toHaveLength(2);
  expect(calls.filter(c=>c.path==='/account/logout')).toHaveLength(1);
});
