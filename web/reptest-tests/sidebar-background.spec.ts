import { test, expect } from '@playwright/test';

test('optional sidebar decoration does not intercept navigation or require private source', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('reptest.theme.v1', JSON.stringify({ mode: 'dark', reducedMotion: true, ambientEffects: false })));
  await page.goto('/?view=usage');
  const background = page.locator('.sidebar-backdrop');
  await expect(background).toHaveAttribute('aria-hidden', 'true');
  await expect(background.locator('canvas')).toHaveCount(0);
  expect(await background.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Team', exact: true }).click();
  await expect(page).toHaveURL(/view=team/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Usage', exact: true }).click();
  await expect(page).toHaveURL(/view=usage/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
