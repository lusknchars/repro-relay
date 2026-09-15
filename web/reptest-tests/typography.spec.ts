import { test, expect } from '@playwright/test';

test('Sans is bundled, font choice persists and Usage metrics share a scale', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('reptest.theme.v1')) localStorage.setItem('reptest.theme.v1', JSON.stringify({fontScale:1, reducedMotion:true}));
  });
  await page.goto('/?view=usage');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('html')).toHaveAttribute('data-font','sans');
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Inter' && font.status === 'loaded'))).toBeTruthy();
  const metrics = await page.locator('.usage-metric').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize));
  expect(metrics.length).toBeGreaterThan(0);
  expect(metrics.every(size => size === '24px')).toBeTruthy();
  await page.getByRole('button',{name:'Customize appearance'}).click();
  await page.getByRole('combobox',{name:'Interface font'}).selectOption({label:'System'});
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font','system');
  await page.getByRole('button',{name:'Customize appearance'}).click();
  await page.getByRole('combobox',{name:'Interface font'}).selectOption({label:'Inter'});
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-font','sans');
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});
