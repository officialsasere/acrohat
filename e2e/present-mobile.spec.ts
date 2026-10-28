import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'], viewport: { width: 393, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { delete (window as never as Record<string, unknown>).showOpenFilePicker })
  await page.goto('/present/app/')
})

const open = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /Pitch deck/ }).click()
  await expect(page.locator('.overlay')).toBeVisible()
}

test('fits a phone screen, with a slide strip, a menu sheet and a format sheet', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Start a new presentation' })).toBeVisible()
  await open(page)
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  expect(m.doc).toBeLessThanOrEqual(m.win)
  await expect(page.locator('.menubar')).toBeHidden()
  await expect(page.locator('.slide-thumb')).toHaveCount(6)
  await page.locator('.slide-thumb').nth(2).tap()
  await expect(page.locator('.statusbar')).toContainText('Slide 3 of 6')
  await page.getByRole('button', { name: 'Open menu' }).tap()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
  await page.getByRole('button', { name: 'Close menu' }).tap()
  await page.getByRole('button', { name: 'Format pane' }).first().tap()
  await expect(page.locator('.side-panel')).toBeVisible()
  const sheet = (await page.locator('.side-panel').boundingBox())!
  expect(sheet.width).toBeLessThanOrEqual(393)
})

test('tapping selects, and pop-up menus stay on screen', async ({ page }) => {
  await open(page)
  await page.locator('.slide-thumb').nth(1).tap()
  const b = (await page.locator('.overlay [data-hit]').first().boundingBox())!
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
  await expect(page.locator('[data-handle="se"]')).toBeVisible()
  await page.getByRole('button', { name: 'Shapes' }).tap()
  const gal = (await page.locator('.shape-gallery').boundingBox())!
  expect(gal.x).toBeGreaterThanOrEqual(0)
  expect(gal.x + gal.width).toBeLessThanOrEqual(393)
  await page.getByRole('button', { name: 'Oval', exact: true }).tap()
})

test('a slide show can be started and tapped through', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Slide show', exact: true }).tap()
  await expect(page.getByRole('dialog', { name: 'Slide show' })).toBeVisible()
  await page.touchscreen.tap(330, 300)
  await expect(page.locator('.show-bar .pos')).toHaveText('2 / 6')
  await page.waitForTimeout(300)
  await page.touchscreen.tap(330, 300)
  await expect(page.locator('.show-bar .pos')).toHaveText('3 / 6')
  await page.waitForTimeout(300)
  await page.touchscreen.tap(10, 300)
  await expect(page.locator('.show-bar .pos')).toHaveText('2 / 6')
  await page.getByRole('button', { name: 'End show' }).evaluate((b) => (b as HTMLElement).click())
  await expect(page.getByRole('dialog', { name: 'Slide show' })).toHaveCount(0)
})
