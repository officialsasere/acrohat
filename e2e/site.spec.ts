import { expect, test, type Page } from '@playwright/test'

const ORIGIN = 'http://localhost:4173'
// Download buttons go through the site's own counter, which then redirects to GitHub Releases.
const DL = '/api/download/paper'
const RELEASE = { name: 'Kwiiva Paper v0.1.0', tag_name: 'paper-latest' }

/**
 * `arch` fakes what Chromium reports about the processor. Left undefined, the browser has no such API (like Safari
 * and Firefox), so tests never depend on the machine they run on.
 */
async function visit(page: Page, opts: { platform: string; release: boolean; path?: string; ua?: string; arch?: 'arm' | 'x86'; stats?: { json: unknown } }) {
  await page.addInitScript(({ platform, ua, arch }) => {
    Object.defineProperty(navigator, 'platform', { get: () => platform })
    if (ua) Object.defineProperty(navigator, 'userAgent', { get: () => ua })
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      get: () => (arch ? { getHighEntropyValues: async () => ({ architecture: arch }) } : undefined),
    })
  }, { platform: opts.platform, ua: opts.ua, arch: opts.arch })
  await page.route('https://api.github.com/**', (route) =>
    opts.release ? route.fulfill({ json: RELEASE }) : route.fulfill({ status: 404, json: { message: 'Not Found' } }),
  )
  await page.route('**/api/stats', (route) => route.fulfill(opts.stats ?? { status: 404, body: 'no counters here' }))
  await page.goto(ORIGIN + (opts.path ?? '/paper/'))
}

const main = (page: Page) => page.locator('[data-role="main"]').first()

test('Kwiiva home page lists every app, each with a one-click download', async ({ page }) => {
  await visit(page, { platform: 'Linux x86_64', release: true, path: '/' })
  await expect(page.getByRole('heading', { name: 'Kwiiva Write' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kwiiva Paper' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kwiiva Grid' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kwiiva Present' })).toBeVisible()
  const mains = page.locator('[data-role="main"]')
  await expect(mains).toHaveCount(4)
  await expect(mains.nth(0)).toHaveAttribute('href', '/api/download/paper/KwiivaPaper-Linux.AppImage')
  await expect(mains.nth(1)).toHaveAttribute('href', '/api/download/write/KwiivaWrite-Linux.AppImage')
  await expect(mains.nth(2)).toHaveAttribute('href', '/api/download/grid/KwiivaGrid-Linux.AppImage')
  await expect(mains.nth(3)).toHaveAttribute('href', '/api/download/present/KwiivaPresent-Linux.AppImage')
  await expect(page.getByRole('link', { name: 'Learn more about Kwiiva Write' })).toHaveAttribute('href', '/write/')
})

test('Kwiiva Write page: one click downloads the installer for the visitor\'s system', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true, path: '/write/' })
  await expect(main(page)).toHaveText('Download for Windows')
  await expect(main(page)).toHaveAttribute('href', '/api/download/write/KwiivaWrite-Windows-Setup.exe')
  await expect(page.locator('[data-os="mac"] a[data-file="KwiivaWrite-macOS-Intel.dmg"]')).toHaveAttribute('href', '/api/download/write/KwiivaWrite-macOS-Intel.dmg')
  await expect(page.getByRole('link', { name: 'Open in browser' }).first()).toHaveAttribute('href', '/write/app/')
})

test('Kwiiva Present page: one click downloads the installer for the visitor\'s system', async ({ page }) => {
  await visit(page, { platform: 'MacIntel', release: true, path: '/present/' })
  await expect(main(page)).toHaveText('Download for macOS')
  await expect(main(page)).toHaveAttribute('href', '/api/download/present/KwiivaPresent-macOS-AppleSilicon.dmg')
  await expect(page.locator('[data-os="win"] a[data-file="KwiivaPresent-Windows.msi"]')).toHaveAttribute('href', '/api/download/present/KwiivaPresent-Windows.msi')
  await expect(page.getByRole('link', { name: 'Open in browser' }).first()).toHaveAttribute('href', '/present/app/')
})

test('Kwiiva Grid page: one click downloads the installer for the visitor\'s system', async ({ page }) => {
  await visit(page, { platform: 'MacIntel', release: true, path: '/grid/' })
  await expect(main(page)).toHaveText('Download for macOS')
  await expect(main(page)).toHaveAttribute('href', '/api/download/grid/KwiivaGrid-macOS-AppleSilicon.dmg')
  await expect(page.locator('[data-os="linux"] a[data-file="KwiivaGrid-Linux.deb"]')).toHaveAttribute('href', '/api/download/grid/KwiivaGrid-Linux.deb')
  await expect(page.getByRole('link', { name: 'Open in browser' }).first()).toHaveAttribute('href', '/grid/app/')
})

test('the site shows how many downloads and launches there have been', async ({ page }) => {
  const stats = { status: 200, contentType: 'application/json', body: JSON.stringify({ products: { paper: { downloads: 1234, opens: 98765, devices: 4321, opens30: 5 }, write: { downloads: 7, opens: 80, devices: 6, opens30: 5 } } }) }
  await visit(page, { platform: 'Win32', release: true, path: '/', stats: stats as never })
  const all = page.locator('[data-stats="all"]')
  await expect(all).toBeVisible()
  await expect(all.locator('[data-stat="downloads"]')).toHaveText('1,241')
  await expect(all.locator('[data-stat="opens"]')).toHaveText('98,845')
  await expect(page.locator('[data-stats="paper"] [data-stat="downloads"]')).toHaveText('1,234')
  await expect(page.locator('[data-stats="write"] [data-stat="devices"]')).toHaveText('6')
})

test('without counters (offline or blocked) the numbers simply stay hidden', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true, path: '/' })
  await expect(page.locator('[data-stats="all"]')).toBeHidden()
})

test('Kwiiva home page lists Kwiiva Paper with a one-click download', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true, path: '/' })
  await expect(page.getByRole('heading', { name: 'Kwiiva Paper' })).toBeVisible()
  await expect(main(page)).toHaveText('Download for Windows')
  await expect(main(page)).toHaveAttribute('href', `${DL}/KwiivaPaper-Windows-Setup.exe`)
  await expect(page.getByRole('link', { name: 'Learn more about Kwiiva Paper' })).toHaveAttribute('href', '/paper/')
  await expect(page.getByRole('link', { name: 'Open in browser' }).first()).toHaveAttribute('href', '/paper/app/')
})

test('Windows visitor: one click downloads the Windows installer directly', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true })
  const top = main(page)
  await expect(top).toHaveText('Download for Windows')
  await expect(top).toHaveAttribute('href', `${DL}/KwiivaPaper-Windows-Setup.exe`)
  await expect(top).toHaveAttribute('download', '')
  await expect(page.locator('[data-os="win"]')).toHaveClass(/you/)
  await expect(page.locator('[data-role="status"]')).toContainText('v0.1.0')
})

test('Mac visitor (browser that cannot tell the chip) gets Apple silicon, with the Intel one right there', async ({ page }) => {
  await visit(page, { platform: 'MacIntel', release: true })
  await expect(main(page)).toHaveText('Download for macOS')
  await expect(main(page)).toHaveAttribute('href', /KwiivaPaper-macOS-AppleSilicon\.dmg$/)
  await expect(page.locator('a[data-file="KwiivaPaper-macOS-Intel.dmg"]')).toHaveAttribute('href', `${DL}/KwiivaPaper-macOS-Intel.dmg`)
})

test('Mac visitor on Chrome/Edge gets the build for their actual chip', async ({ page }) => {
  await visit(page, { platform: 'MacIntel', release: true, arch: 'x86' })
  await expect(main(page)).toHaveAttribute('href', /KwiivaPaper-macOS-Intel\.dmg$/)
  await expect(page.locator('[data-role="hint"]').first()).toContainText('Intel')
  const arm = await page.context().newPage()
  await visit(arm, { platform: 'MacIntel', release: true, arch: 'arm' })
  await expect(main(arm)).toHaveAttribute('href', /KwiivaPaper-macOS-AppleSilicon\.dmg$/)
})

test('Linux visitor gets the AppImage; every installer has a visible link', async ({ page }) => {
  await visit(page, { platform: 'Linux x86_64', release: true })
  await expect(main(page)).toHaveAttribute('href', /KwiivaPaper-Linux\.AppImage$/)
  const files = await page.locator('a[data-file]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).dataset.file))
  expect(files.sort()).toEqual(['KwiivaPaper-Linux.AppImage', 'KwiivaPaper-Linux.deb', 'KwiivaPaper-Windows-Setup.exe', 'KwiivaPaper-Windows.msi', 'KwiivaPaper-macOS-AppleSilicon.dmg', 'KwiivaPaper-macOS-Intel.dmg'])
})

test('before the first release is published, nobody is sent to a dead link', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: false })
  await expect(page.locator('[data-role="status"]')).toContainText('being prepared')
  await expect(main(page)).toHaveText('Open in browser')
  await expect(main(page)).toHaveAttribute('href', '/paper/app/')
  for (const a of await page.locator('a[data-file]').all()) await expect(a).toHaveAttribute('href', '/paper/app/')
})

test('phone visitors are pointed to the browser version', async ({ page }) => {
  await visit(page, { platform: 'iPhone', release: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })
  await expect(page.locator('[data-role="hint"]').first()).toContainText('browser version')
  await expect(main(page)).toHaveAttribute('href', '/paper/app/')
})

test('the website does not compare itself to other products', async ({ page }) => {
  for (const path of ['/', '/paper/', '/write/', '/grid/', '/present/']) {
    await visit(page, { platform: 'Win32', release: true, path })
    await expect(page.locator('body')).not.toContainText(/acrobat|microsoft|google|\bwords?\b(?! count)/i)
  }
  await expect(page.locator('body')).toContainText('Installing an unsigned app')
})

test('the "Open in browser" link opens the editor', async ({ page }) => {
  await visit(page, { platform: 'Win32', release: true })
  await page.getByRole('link', { name: 'Open in browser' }).first().click()
  await expect(page).toHaveURL(/\/paper\/app\/$/)
  await expect(page.getByRole('button', { name: 'Open a PDF' })).toBeVisible()
})

test('the old /app/ address still reaches the editor', async ({ page }) => {
  const res = await page.goto(ORIGIN + '/paper/app')
  expect(res?.ok()).toBeTruthy()
})
