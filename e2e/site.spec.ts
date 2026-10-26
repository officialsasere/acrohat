import { expect, test, type Page } from '@playwright/test'

const SITE = 'http://localhost:4173/'
const REPO = 'https://github.com/officialsasere/acrohat'

async function visit(page: Page, opts: { platform: string; release: boolean; ua?: string }) {
  await page.addInitScript(({ platform, ua }) => {
    Object.defineProperty(navigator, 'platform', { get: () => platform })
    if (ua) Object.defineProperty(navigator, 'userAgent', { get: () => ua })
  }, { platform: opts.platform, ua: opts.ua })
  await page.route('https://api.github.com/**', (route) =>
    opts.release ? route.fulfill({ json: { tag_name: 'v0.1.0' } }) : route.fulfill({ status: 404, json: { message: 'Not Found' } }),
  )
  await page.goto(SITE)
}

test('Windows visitor: one click downloads the Windows installer directly', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true })
  const top = page.locator('#download')
  await expect(top).toHaveText('Download for Windows')
  await expect(top).toHaveAttribute('href', `${REPO}/releases/latest/download/Acrohat-Windows-Setup.exe`)
  await expect(top).toHaveAttribute('download', '')
  await expect(page.locator('#dl-win')).toHaveClass(/you/)
  await expect(page.locator('#releases-status')).toContainText('v0.1.0')
})

test('Mac visitor gets the Apple silicon build, with the Intel one right there', async ({ page }) => {
  await visit(page, { platform: 'MacIntel', release: true })
  await expect(page.locator('#download')).toHaveText('Download for macOS')
  await expect(page.locator('#download')).toHaveAttribute('href', /Acrohat-macOS-AppleSilicon\.dmg$/)
  await expect(page.locator('a[data-file="Acrohat-macOS-Intel.dmg"]')).toHaveAttribute('href', `${REPO}/releases/latest/download/Acrohat-macOS-Intel.dmg`)
})

test('Linux visitor gets the AppImage; every installer has a visible link', async ({ page }) => {
  await visit(page, { platform: 'Linux x86_64', release: true })
  await expect(page.locator('#download')).toHaveAttribute('href', /Acrohat-Linux\.AppImage$/)
  const files = await page.locator('a[data-file]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).dataset.file))
  expect(files.sort()).toEqual(['Acrohat-Linux.AppImage', 'Acrohat-Linux.deb', 'Acrohat-Windows-Setup.exe', 'Acrohat-Windows.msi', 'Acrohat-macOS-AppleSilicon.dmg', 'Acrohat-macOS-Intel.dmg'])
})

test('before the first release is published, nobody is sent to a dead link', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: false })
  await expect(page.locator('#releases-status')).toContainText('being prepared')
  await expect(page.locator('#download')).toHaveText('Open in browser')
  await expect(page.locator('#download')).toHaveAttribute('href', 'app/')
  for (const a of await page.locator('a[data-file]').all()) await expect(a).toHaveAttribute('href', 'app/')
})

test('phone visitors are pointed to the browser version', async ({ page }) => {
  await visit(page, { platform: 'iPhone', release: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })
  await expect(page.locator('#os-hint')).toContainText('browser version')
})

test('the website no longer compares itself to other products', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true })
  await expect(page.locator('body')).not.toContainText(/acrobat/i)
  await expect(page.locator('body')).toContainText('Installing an unsigned app')
})

test('the "Use it in the browser" link opens the editor', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true })
  await page.getByRole('link', { name: 'Open in browser' }).click()
  await expect(page).toHaveURL(/\/app\/$/)
  await expect(page.getByRole('button', { name: 'Open a PDF' })).toBeVisible()
})
