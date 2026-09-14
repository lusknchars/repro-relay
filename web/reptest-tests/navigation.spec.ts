import { expect, test } from '@playwright/test'

test('supplied screens, work detail, appearance persistence and phone navigation', async ({ page }) => {
  const errors: string[] = []
  const apiWrites: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') apiWrites.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByText('reptest · prototype', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Work history' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected work' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Conversation and decisions' })).toBeVisible()
  await page.screenshot({ path: 'test-results/reptest-work-exact.png' })

  for (const name of ['Team', 'Knowledge', 'Usage', 'Settings', 'Work']) {
    await page.locator('aside[aria-label="Primary navigation"]').getByRole('button', { name: new RegExp(name) }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Customize appearance' }).click()
  await expect(page.getByRole('dialog', { name: 'Appearance' })).toBeVisible()
  await page.getByRole('dialog').getByRole('radio', { name: 'Violet', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: 'test-results/reptest-work-dark-exact.png' })

  await page.setViewportSize({ width: 390, height: 844 })
  const phone = page.getByRole('navigation', { name: 'Phone navigation' })
  for (const name of ['Team', 'Knowledge', 'Usage', 'Settings', 'Work']) {
    await phone.getByRole('button', { name, exact: true }).click()
    await expect(phone.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.screenshot({ path: 'test-results/reptest-phone-exact.png' })
  expect(errors).toEqual([])
  expect(apiWrites).toEqual([])
})
