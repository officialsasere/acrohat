import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'], viewport: { width: 393, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { delete (window as never as Record<string, unknown>).showOpenFilePicker })
  await page.goto('/grid/app/')
})

test('fits a phone screen, has a menu sheet, and cells can be tapped and edited', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Start a new spreadsheet' })).toBeVisible()
  await page.getByRole('button', { name: /Monthly budget/ }).click()
  await expect(page.locator('.grid-hit')).toBeVisible()
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  expect(m.doc).toBeLessThanOrEqual(m.win)
  await expect(page.locator('.menubar')).toBeHidden()
  const b = (await page.locator('.grid-hit').boundingBox())!
  // tap B2 (row 2, column B), then double tap to edit
  const x = b.x + 48 + 100 + 50, y = b.y + 24 + 22 + 11
  await page.touchscreen.tap(x, y)
  await expect(page.getByLabel('Name box')).toHaveValue('B2')
  await page.touchscreen.tap(x, y)
  await expect(page.getByLabel('Cell editor')).toBeVisible()
  await page.keyboard.type('77'); await page.keyboard.press('Enter')
  await expect(page.getByLabel('Name box')).toHaveValue('B3')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
  await page.getByRole('button', { name: 'Close menu' }).click()
})

test('can be installed to the home screen', async ({ page, request }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const m = await (await request.get(new URL(href!, page.url()).toString())).json()
  expect(m).toMatchObject({ name: 'Kwiiva Grid', display: 'standalone', start_url: '/grid/app/' })
  for (const icon of m.icons) expect((await request.get(new URL(icon.src, page.url()).toString())).ok()).toBe(true)
})
