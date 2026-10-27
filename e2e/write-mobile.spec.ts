import { devices, expect, test, type Page } from '@playwright/test'

// A phone: narrow, touch, no hover. Same editor, same engine.
test.use({ ...devices['Pixel 7'], viewport: { width: 393, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as never as Record<string, unknown>).showOpenFilePicker
    delete (window as never as Record<string, unknown>).showSaveFilePicker
  })
  await page.goto('/write/app/')
})

const blank = async (page: Page) => {
  await page.getByRole('button', { name: /Blank document/ }).click()
  await expect(page.locator('.ProseMirror')).toBeVisible()
}


test('fits the screen, has a menu sheet, and can be typed in', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Start a new document' })).toBeVisible()
  await blank(page)
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }))
  expect(m.doc).toBeLessThanOrEqual(m.win)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Typed on a phone')
  await expect(page.locator('.ProseMirror')).toContainText('Typed on a phone')
  await expect(page.locator('.menubar')).toBeHidden()
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
  await page.getByRole('button', { name: 'Close menu' }).click()
  const tb = page.locator('.toolbar')
  expect(await tb.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const box = await page.getByRole('button', { name: 'Bold (Ctrl+B)' }).boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(38)
})

test('can be installed to the home screen', async ({ page, request }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const m = await (await request.get(new URL(href!, page.url()).toString())).json()
  expect(m).toMatchObject({ name: 'Kwiiva Write', display: 'standalone', start_url: '/write/app/' })
  for (const icon of m.icons) expect((await request.get(new URL(icon.src, page.url()).toString())).ok()).toBe(true)
})
