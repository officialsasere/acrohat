// Takes the screenshots used in the README and on GitHub: yarn screenshots
// It builds the site, serves it locally, drives each app in a real browser and saves PNGs to docs/screenshots/.
import { chromium, devices } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const PORT = 4181
const OUT = 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

if (!process.env.SKIP_BUILD) {
  const b = spawnSync('yarn', ['build'], { stdio: 'inherit' })
  if (b.status !== 0) process.exit(b.status ?? 1)
}
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const base = `http://localhost:${PORT}`
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/')).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }

/** A page that looks like a real document, so the Paper screenshot has something worth editing. */
async function sampleBrochure() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([612, 792])
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold), reg = await pdf.embedFont(StandardFonts.Helvetica), serif = await pdf.embedFont(StandardFonts.TimesRoman)
  page.drawRectangle({ x: 0, y: 692, width: 612, height: 100, color: rgb(0.54, 0.35, 0.21) })
  page.drawText('Harbour Street Bakery', { x: 54, y: 735, size: 30, font: bold, color: rgb(1, 0.97, 0.92) })
  page.drawText('Spring menu and opening hours', { x: 54, y: 708, size: 14, font: reg, color: rgb(0.96, 0.9, 0.8) })
  page.drawText('Fresh every morning', { x: 54, y: 650, size: 20, font: bold, color: rgb(0.17, 0.11, 0.08) })
  const lines = ['We bake sourdough, rye and seeded loaves before sunrise, so the', 'first customers always get bread that is still warm. Our pastries', 'use butter from a dairy ten miles up the road, and our coffee is', 'roasted in small batches by a friend two doors down.']
  lines.forEach((l, i) => page.drawText(l, { x: 54, y: 622 - i * 17, size: 12, font: serif, color: rgb(0.1, 0.1, 0.1) }))
  page.drawText('Opening hours', { x: 54, y: 530, size: 16, font: bold })
  ;[['Monday to Friday', '7:00 – 17:00'], ['Saturday', '7:30 – 15:00'], ['Sunday', 'Closed']].forEach(([d, h], i) => { page.drawText(d, { x: 54, y: 504 - i * 22, size: 12, font: reg }); page.drawText(h, { x: 250, y: 504 - i * 22, size: 12, font: bold }) })
  page.drawRectangle({ x: 54, y: 380, width: 504, height: 54, color: rgb(0.99, 0.94, 0.85), borderColor: rgb(0.8, 0.6, 0.35), borderWidth: 1 })
  page.drawText('Order ahead for Saturday: call 555 0142 or visit us in person.', { x: 70, y: 402, size: 12, font: reg })
  const path = join(tmpdir(), 'Harbour Street Bakery.pdf')
  writeFileSync(path, await pdf.save())
  return path
}
const browser = await chromium.launch()
const noPickers = () => { delete window.showOpenFilePicker; delete window.showSaveFilePicker }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (page, name) => { await wait(500); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('saved', name) }

try {
  const desktop = { viewport: { width: 1440, height: 900 }, colorScheme: 'light' }
  const phone = { ...devices['Pixel 7'], viewport: { width: 390, height: 800 }, colorScheme: 'light' }
  const ctx = await browser.newContext({ ...desktop, deviceScaleFactor: 1 })
  const pctx = await browser.newContext({ ...phone, deviceScaleFactor: 2 })

  // ---- the website
  let page = await ctx.newPage()
  await page.route('https://api.github.com/**', (r) => r.fulfill({ status: 404, json: {} }))
  await page.goto(base + '/'); await shot(page, 'website')

  // ---- Kwiiva Paper
  page = await ctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/paper/app/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a PDF' }).click()
  await (await chooser).setFiles(await sampleBrochure())
  await page.waitForSelector('.page canvas'); await wait(1200)
  await page.keyboard.press('e'); await wait(300)
  const box = await page.locator('.page').first().boundingBox()
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * (1 - 615 / 792))
  await wait(600); await shot(page, 'paper')

  // ---- Kwiiva Write
  page = await ctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/write/app/')
  await page.getByRole('button', { name: /Report/ }).click(); await wait(900)
  await page.evaluate(() => {
    const ed = window.__kw
    const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
    const h = (l, t) => ({ type: 'heading', attrs: { level: l }, content: [{ type: 'text', text: t }] })
    ed.commands.setContent({ type: 'doc', content: [
      { type: 'paragraph', attrs: { pStyle: 'title' }, content: [{ type: 'text', text: 'Quarterly review' }] },
      { type: 'paragraph', attrs: { pStyle: 'subtitle' }, content: [{ type: 'text', text: 'Prepared for the leadership team' }] },
      { type: 'tableOfContents' },
      h(1, 'Highlights'),
      p('Revenue grew by ten percent compared with the same quarter last year, driven by strong demand across all regions. Customer satisfaction reached its highest level in three years, and support response times fell by a third.'),
      { type: 'bulletList', content: ['Two new products launched on schedule', 'Churn down to 2.1%', 'Three offices moved to the new platform'].map((t) => ({ type: 'listItem', content: [p(t)] })) },
      h(1, 'Results by region'),
      { type: 'table', content: [['Region', 'Q1', 'Q2', 'Change'], ['North', '120', '150', '+25%'], ['South', '90', '110', '+22%'], ['East', '200', '180', '−10%']].map((r, i) => ({ type: 'tableRow', content: r.map((c) => ({ type: i ? 'tableCell' : 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [p(c)] })) })) },
      h(2, 'What we learned'),
      p('Smaller teams shipped faster. Clear owners for every task made reviews shorter, and a weekly written update replaced two recurring meetings.'),
    ] })
  })
  await wait(1500); await shot(page, 'write')

  // ---- Kwiiva Grid
  page = await ctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/grid/app/')
  await page.getByRole('button', { name: /Monthly budget/ }).click(); await wait(800)
  await page.evaluate(() => {
    const s = window.__kwg.store.getState(), b = s.book, sh = b.activeSheet
    b.transaction('chart', () => b.prop(sh, 'charts', [{ id: 'c1', kind: 'column', range: 'Sheet1!A1:C8', headerRow: true, headerCol: true, byRows: false, title: 'Planned vs actual', xTitle: '', yTitle: '', legend: 'bottom', stacked: false, percent: false, smooth: false, points: false, gridlines: true, x: 590, y: 24, w: 560, h: 330 }]))
    b.setStyle(sh.id, [{ r1: 1, c1: 1, r2: 7, c2: 2 }], { fmt: '$#,##0' })
    b.wb.sheets[0].cf.push({ id: 'bar', ranges: [{ r1: 1, c1: 2, r2: 7, c2: 2 }], type: 'bar', bar: { color: '#e2b98f' } })
    s.set({ sel: { ranges: [{ r1: 3, c1: 3, r2: 3, c2: 3 }], r: 3, c: 3, ar: 3, ac: 3 } })
  })
  await wait(900); await shot(page, 'grid')

  // ---- Kwiiva Present
  page = await ctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/present/app/')
  await page.getByRole('button', { name: /Quarterly review/ }).click()
  await page.locator('[data-slide]').nth(2).click()
  await wait(500)
  const chartHit = page.locator('.overlay [data-hit]').nth(1)
  await chartHit.click()
  await page.getByRole('button', { name: 'Format pane' }).first().click()
  await wait(900); await shot(page, 'present')

  // ---- on a phone
  page = await pctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/write/app/'); await page.getByRole('button', { name: /Resume/ }).click(); await wait(900); await shot(page, 'write-mobile')
  page = await pctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/grid/app/'); await page.getByRole('button', { name: /Monthly budget/ }).click(); await wait(900); await shot(page, 'grid-mobile')
  page = await pctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/present/app/'); await page.getByRole('button', { name: /Pitch deck/ }).click(); await page.locator('.slide-thumb').nth(1).tap(); await wait(900); await shot(page, 'present-mobile')
  page = await pctx.newPage(); await page.addInitScript(noPickers)
  await page.goto(base + '/paper/app/')
  const ch = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Open a PDF' }).click(); await (await ch).setFiles('tests/fixtures/sample.pdf')
  await page.waitForSelector('.page canvas'); await wait(900); await shot(page, 'paper-mobile')
} finally {
  await browser.close()
  server.kill()
}
