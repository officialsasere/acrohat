import { devices, expect, test } from '@playwright/test'

const SAMPLE = 'tests/fixtures/sample.pdf'

// A phone: narrow, touch, no hover. Same app, same engine.
test.use({ ...devices['Pixel 7'], viewport: { width: 393, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as never as Record<string, unknown>).showOpenFilePicker
    delete (window as never as Record<string, unknown>).showSaveFilePicker
  })
  await page.goto('/paper/app/')
})

async function open(page: import('@playwright/test').Page) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a PDF' }).click()
  await (await chooser).setFiles(SAMPLE)
  await expect(page.locator('.page')).toHaveCount(3)
}

test('the editor fits a phone screen without sideways scrolling', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Open a PDF' })).toBeVisible()
  await open(page)
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, page: document.querySelector('.page')!.getBoundingClientRect().width }))
  expect(m.doc).toBeLessThanOrEqual(m.win)
  expect(m.page).toBeLessThanOrEqual(m.win) // fit-to-width
  await page.screenshot({ path: 'e2e/shots/mobile.png' })
})

test('the page list is a drawer that starts closed and closes after choosing a page', async ({ page }) => {
  await open(page)
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await page.getByTitle('Toggle page thumbnails').click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.locator('.thumb').nth(2).click()
  await expect(page.locator('.sidebar')).toHaveCount(0)
})

test('the toolbar scrolls sideways and its buttons are finger-sized', async ({ page }) => {
  await open(page)
  const tb = page.locator('.toolbar')
  expect(await tb.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const box = await page.getByTitle('Highlight (H)').boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(40)
  expect(box!.height).toBeGreaterThanOrEqual(40)
})

test('it can be installed to the home screen', async ({ page, request }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const res = await request.get(new URL(href!, page.url()).toString())
  const m = await res.json()
  expect(m.display).toBe('standalone')
  expect(m.start_url).toBe('/paper/app/')
  for (const icon of m.icons) expect((await request.get(new URL(icon.src, page.url()).toString())).ok()).toBe(true)
})
