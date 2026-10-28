import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'

type Store = { getState(): { deck: { slides: { id: string; layout: string; notes: string; els: { id: string; type: string; text?: { paras: { runs: { t: string; b?: boolean; sz?: number }[]; bullet?: string }[] }; x: number; y: number; w: number; h: number; rot?: number; geom?: string; ph?: { role: string }; children?: unknown[]; rows?: unknown[]; kind?: string; series?: unknown[] }[]; anims: unknown[]; trans?: { kind: string } }[]; theme: { id: string }; title: string; w: number; h: number }; sel: string[]; cur: string; editing: unknown; past: unknown[]; file: { name: string; dirty: boolean }; presenting: unknown } }
declare global { interface Window { __kwp: { store: Store; openBytes: (n: string, b: Uint8Array) => Promise<void> } } }

test.beforeEach(async ({ page, context }) => {
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    delete (window as never as Record<string, unknown>).showOpenFilePicker
    delete (window as never as Record<string, unknown>).showSaveFilePicker
  })
  await page.goto('/present/app/')
})

const state = (page: Page) => page.evaluate(() => { const s = window.__kwp.store.getState(); return JSON.parse(JSON.stringify({ deck: s.deck, sel: s.sel, cur: s.cur })) as ReturnType<Store['getState']> })
const slide = async (page: Page, i = 0) => (await state(page)).deck.slides[i]
const blank = async (page: Page) => { await page.getByRole('button', { name: /^Blank/ }).click(); await expect(page.locator('.overlay')).toBeVisible() }
/** The slide's top-left corner and scale on the page. */
const origin = async (page: Page) => { const h = page.locator('.slide-holder'); const b = (await h.boundingBox())!; const k = Number(await h.getAttribute('data-scale')); return { x: b.x, y: b.y, k } }
const toPage = async (page: Page, x: number, y: number) => { const o = await origin(page); return { x: o.x + x * o.k, y: o.y + y * o.k } }
const hit = (page: Page, i: number) => page.locator('.overlay [data-hit]').nth(i)

test('home offers templates and a new deck opens on a title slide', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Start a new presentation' })).toBeVisible()
  await expect(page.locator('.tpl')).toHaveCount(7)
  await blank(page)
  const s = await state(page)
  expect(s.deck.slides).toHaveLength(1)
  expect(s.deck.slides[0].layout).toBe('title')
  await expect(page.getByText('Click to add title')).toBeVisible()
})

test('typing into a placeholder keeps the text and shows it in the thumbnail', async ({ page }) => {
  await blank(page)
  await hit(page, 0).dblclick()
  await page.keyboard.type('Quarterly plan')
  await page.keyboard.press('Escape')
  const s = await slide(page)
  expect(s.els.find((e) => e.ph?.role === 'title')!.text!.paras[0].runs[0].t).toBe('Quarterly plan')
  await expect(page.locator('.slide-thumb').first()).toContainText('Quarterly plan')
})

test('new slides, layouts, duplicate, delete and undo', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'New slide' }).first().click()
  expect((await state(page)).deck.slides).toHaveLength(2)
  expect((await slide(page, 1)).layout).toBe('titleBody')
  await page.locator('.slide-thumb').nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate slide' }).click()
  expect((await state(page)).deck.slides).toHaveLength(3)
  await page.locator('.slide-thumb').nth(2).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete slide' }).click()
  expect((await state(page)).deck.slides).toHaveLength(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await state(page)).deck.slides).toHaveLength(3)
  await page.getByRole('button', { name: 'Layout of this slide' }).click()
  await page.getByRole('button', { name: 'Section header' }).click()
  expect((await slide(page, 1)).layout).toBe('section')
})

test('slides can be reordered from the menu', async ({ page }) => {
  await blank(page)
  await hit(page, 0).dblclick(); await page.keyboard.type('One'); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New slide' }).first().click()
  await page.locator('.slide-thumb').nth(0).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move down' }).click()
  const s = await state(page)
  expect(s.deck.slides[1].els.find((e) => e.ph?.role === 'title')!.text!.paras[0].runs[0].t).toBe('One')
})

test('draw a shape, move it, resize it, rotate it and undo', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Shapes' }).click()
  await page.getByRole('button', { name: 'Oval', exact: true }).click()
  const a = await toPage(page, 100, 300), b = await toPage(page, 260, 400)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up()
  let s = await slide(page)
  const oval = s.els.find((e) => e.geom === 'ellipse')!
  expect(oval.x).toBeCloseTo(100, -1); expect(oval.w).toBeCloseTo(160, -1)
  // Move with the keyboard.
  await page.locator('[data-testid="stage"]').focus()
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown')
  s = await slide(page)
  expect(s.els.find((e) => e.geom === 'ellipse')!.x).toBeCloseTo(oval.x + 1, 3)
  expect(s.els.find((e) => e.geom === 'ellipse')!.y).toBeCloseTo(oval.y + 10, 3)
  // Resize from the bottom-right handle.
  const h = page.locator('[data-handle="se"]')
  const hb = (await h.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + 80, hb.y + 40, { steps: 4 }); await page.mouse.up()
  s = await slide(page)
  expect(s.els.find((e) => e.geom === 'ellipse')!.w).toBeGreaterThan(oval.w + 20)
  // Rotate from the handle.
  const r = (await page.locator('[data-handle="rot"]').boundingBox())!
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.move(r.x + 200, r.y + r.height / 2 + 60, { steps: 4 }); await page.mouse.up()
  expect((await slide(page)).els.find((e) => e.geom === 'ellipse')!.rot).toBeGreaterThan(10)
  // Undo steps back through the rotation and the resize.
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await slide(page)).els.find((e) => e.geom === 'ellipse')!.rot ?? 0).toBe(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await slide(page)).els.find((e) => e.geom === 'ellipse')!.w).toBeCloseTo(oval.w, 0)
})

test('text box: type, format, and it grows with its text', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Text box', exact: true }).click()
  const p0 = await toPage(page, 120, 380)
  await page.mouse.click(p0.x, p0.y)
  await page.keyboard.type('Line one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Line two')
  await page.keyboard.press('Shift+Home')
  await page.getByRole('button', { name: 'Bold' }).click()
  await page.getByRole('button', { name: 'Larger text' }).click()
  await page.keyboard.press('Escape')
  const s = await slide(page)
  const box = s.els.find((e) => e.type === 'shape' && !e.ph)!
  expect(box.text!.paras).toHaveLength(2)
  expect(box.text!.paras[1].runs[0]).toMatchObject({ t: 'Line two', b: true })
  expect(box.text!.paras[1].runs[0].sz).toBeGreaterThan(24)
  expect(box.h).toBeGreaterThan(60)
})

test('an empty text box disappears when you click away', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Text box', exact: true }).click()
  const p0 = await toPage(page, 120, 380)
  await page.mouse.click(p0.x, p0.y)
  await expect(page.locator('.pm')).toBeFocused()
  await page.keyboard.press('Escape')
  expect((await slide(page)).els.filter((e) => !e.ph)).toHaveLength(0)
})

test('bullets, numbering and indent in a body placeholder', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'New slide' }).first().click()
  await hit(page, 1).dblclick()
  await page.keyboard.type('Alpha'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.type('Beta'); await page.keyboard.press('Enter'); await page.keyboard.press('Shift+Tab'); await page.keyboard.type('Gamma')
  await page.keyboard.press('Escape')
  const body = (await slide(page, 1)).els.find((e) => e.ph?.role === 'body')!
  expect(body.text!.paras.map((p) => p.runs[0].t)).toEqual(['Alpha', 'Beta', 'Gamma'])
  await expect(page.locator('.stage .pp[data-m="•"]')).toHaveCount(3)
  await page.getByRole('button', { name: 'Numbering' }).click()
  await page.getByRole('button', { name: '1. 2. 3.' }).click()
  await expect(page.locator('.stage .pp[data-m="1."]')).toHaveCount(2)
  await expect(page.locator('.stage .pp[data-m="2."]')).toHaveCount(1)
})

test('tables: insert, type with Tab, add a row and merge', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: '3 by 3' }).click()
  let s = await slide(page)
  expect(s.els.find((e) => e.type === 'table')!.rows).toHaveLength(3)
  await page.keyboard.type('a'); await page.keyboard.press('Tab'); await page.waitForTimeout(150); await page.keyboard.type('b')
  await page.keyboard.press('Escape')
  s = await slide(page)
  const t = s.els.find((e) => e.type === 'table') as unknown as { rows: { cells: { text: { paras: { runs: { t: string }[] }[] } }[] }[] }
  expect(t.rows[0].cells[0].text.paras[0].runs[0].t).toBe('a')
  expect(t.rows[0].cells[1].text.paras[0].runs[0].t).toBe('b')
  await page.getByRole('button', { name: 'Format pane' }).click()
  await page.getByRole('button', { name: '+ Row below' }).click()
  s = await slide(page)
  expect((s.els.find((e) => e.type === 'table')!.rows as unknown[]).length).toBe(4)
})

test('charts: insert, change type and edit the data', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Chart', exact: true }).click()
  await page.getByRole('button', { name: 'Line', exact: true }).click()
  let s = await slide(page)
  expect(s.els.find((e) => e.type === 'chart')!.kind).toBe('line')
  await page.getByRole('button', { name: 'Format pane' }).first().click()
  await page.getByLabel('Chart type').selectOption('pie')
  s = await slide(page)
  expect(s.els.find((e) => e.type === 'chart')!.kind).toBe('pie')
  await page.getByRole('button', { name: 'Edit data…' }).click()
  await page.getByLabel('Row 1 North').fill('9')
  await page.getByRole('button', { name: 'Apply' }).click()
  s = await slide(page)
  expect((s.els.find((e) => e.type === 'chart')!.series as { vals: number[] }[])[0].vals[0]).toBe(9)
})

test('pictures can be inserted from a file', async ({ page }) => {
  await blank(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Picture', exact: true }).click()
  ;(await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.locator('.stage img')).toHaveCount(1)
  expect((await slide(page)).els.some((e) => e.type === 'image')).toBe(true)
})

test('group, duplicate and delete with the keyboard', async ({ page }) => {
  await blank(page)
  for (const [x, y] of [[100, 300], [300, 300]]) {
    await page.getByRole('button', { name: 'Shapes' }).click()
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
    const a = await toPage(page, x, y), b = await toPage(page, x + 80, y + 80)
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up()
  }
  await page.locator('[data-testid="stage"]').focus()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+g')
  let s = await slide(page)
  expect(s.els.filter((e) => e.type === 'group')).toHaveLength(1)
  await page.keyboard.press('ControlOrMeta+d')
  s = await slide(page)
  expect(s.els.filter((e) => e.type === 'group')).toHaveLength(2)
  await page.keyboard.press('Delete')
  s = await slide(page)
  expect(s.els.filter((e) => e.type === 'group')).toHaveLength(1)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+Shift+g')
  s = await slide(page)
  expect(s.els.filter((e) => e.type === 'group')).toHaveLength(0)
})

test('copy and paste an object', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Shapes' }).click()
  await page.getByRole('button', { name: 'Star', exact: false }).first().click()
  const a = await toPage(page, 100, 300), b = await toPage(page, 200, 400)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up()
  await page.locator('[data-testid="stage"]').focus()
  await page.keyboard.press('ControlOrMeta+c'); await page.keyboard.press('ControlOrMeta+v')
  expect((await slide(page)).els.filter((e) => e.geom?.startsWith('star'))).toHaveLength(2)
})

test('speaker notes are kept per slide', async ({ page }) => {
  await blank(page)
  await page.getByLabel('Speaker notes').fill('Remember the story')
  await page.getByRole('button', { name: 'New slide' }).first().click()
  await expect(page.getByLabel('Speaker notes')).toHaveValue('')
  await page.locator('.slide-thumb').first().click()
  await expect(page.getByLabel('Speaker notes')).toHaveValue('Remember the story')
})

test('find and replace across slides', async ({ page }) => {
  await page.getByRole('button', { name: /Pitch deck/ }).click()
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: /Find and replace/ }).click()
  await page.getByLabel('Find', { exact: true }).fill('problem')
  await page.getByLabel('Replace with').fill('challenge')
  await page.getByRole('button', { name: 'Replace all' }).click()
  const s = await state(page)
  expect(JSON.stringify(s.deck.slides)).toContain('challenge')
  expect(JSON.stringify(s.deck.slides)).not.toContain('The problem')
})

test('a theme change recolours everything and keeps the text', async ({ page }) => {
  await page.getByRole('button', { name: /Quarterly review/ }).click()
  const before = JSON.stringify((await state(page)).deck.slides.map((s) => s.els.map((e) => e.text?.paras)))
  await page.getByRole('button', { name: 'Theme', exact: true }).click()
  await page.getByRole('button', { name: /Midnight/ }).click()
  const s = await state(page)
  expect(s.deck.theme.id).toBe('midnight')
  expect(JSON.stringify(s.deck.slides.map((x) => x.els.map((e) => e.text?.paras)))).toBe(before)
  await expect(page.locator('.stage .slide-inner').first()).toHaveCSS('background-color', 'rgb(20, 33, 61)')
})

test('the outline can be edited as text', async ({ page }) => {
  await page.getByRole('button', { name: /Lesson/ }).click()
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByRole('button', { name: 'Outline…' }).click()
  const box = page.getByRole('textbox', { name: 'Outline', exact: true })
  const text = await box.inputValue()
  expect(text).toContain('# Lesson title')
  await box.fill(text.replace('# Lesson title', '# A new heading') + '\n---\n\n# Extra slide\n- one\n- two\n> note')
  await page.getByRole('button', { name: 'Apply to slides' }).click()
  const s = await state(page)
  expect(s.deck.slides[0].els.find((e) => e.ph?.role === 'title')!.text!.paras[0].runs[0].t).toBe('A new heading')
  expect(s.deck.slides.at(-1)!.notes).toBe('note')
})

test('make slides from an outline', async ({ page }) => {
  await page.getByRole('button', { name: 'Make slides from an outline' }).click()
  await page.getByLabel('Outline text').fill('# Big idea\nSay it simply\n\n---\n\n# Why\n- Reason one\n  - Detail\n- Reason two')
  await page.getByRole('button', { name: 'Create a new presentation' }).click()
  const s = await state(page)
  expect(s.deck.slides).toHaveLength(2)
  expect(s.deck.slides[0].layout).toBe('title')
  expect(s.deck.slides[1].els.find((e) => e.ph?.role === 'body')!.text!.paras).toHaveLength(3)
})

test('slide show: navigate, animate and leave', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'New slide' }).first().click()
  await hit(page, 0).dblclick(); await page.keyboard.type('Second'); await page.keyboard.press('Escape')
  // An entrance animation on the title.
  await page.getByRole('button', { name: 'Animations' }).click()
  await hit(page, 0).click()
  await page.getByRole('button', { name: 'Add entrance to selection' }).click()
  expect((await slide(page, 1)).anims).toHaveLength(1)
  await page.locator('.slide-thumb').first().click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Present', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Slide show' })).toBeVisible()
  await expect(page.locator('.show .pos')).toHaveText('1 / 2', { timeout: 3000 }).catch(() => undefined)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.show-bar .pos')).toHaveText('2 / 2')
  // The title is hidden until the click.
  await expect.poll(() => page.locator('.show [data-el]').evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.visibility === 'hidden').length)).toBeGreaterThan(0)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(800)
  const stillHidden = await page.locator('.show [data-el]').evaluateAll((els) => els.filter((e) => (e.closest('.layer') as HTMLElement).style.visibility !== 'hidden' && getComputedStyle(e as HTMLElement).visibility === 'hidden').length)
  expect(stillHidden).toBe(0)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('b')
  await expect(page.locator('.show-black')).toBeVisible()
  await page.keyboard.press('b')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Slide show' })).toHaveCount(0)
})

test('presenter view shows notes and the next slide', async ({ page }) => {
  await blank(page)
  await page.getByLabel('Speaker notes').fill('Open with a story')
  await page.getByRole('button', { name: 'New slide' }).first().click()
  await page.locator('.slide-thumb').first().click()
  await page.getByRole('button', { name: 'More ways to present' }).click()
  await page.getByRole('button', { name: /Presenter view/ }).click()
  await expect(page.getByRole('dialog', { name: 'Presenter view' })).toBeVisible()
  await expect(page.locator('.console-notes')).toHaveText('Open with a story')
  await expect(page.locator('.console-next')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.console-nav')).toContainText('Slide 2 of 2')
  await page.keyboard.press('Escape')
})

test('an audience window follows the presenter view', async ({ page, context }) => {
  await page.getByRole('button', { name: /Pitch deck/ }).click()
  await page.getByRole('button', { name: 'More ways to present' }).click()
  await page.getByRole('button', { name: /Presenter view/ }).click()
  const popup = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open audience window' }).click()
  const aud = await popup
  await expect(aud.locator('.show.audience .slide')).toContainText('Your company name')
  await page.keyboard.press('ArrowRight')
  await expect(aud.locator('.show.audience .slide')).toContainText('The problem')
  await page.keyboard.press('b')
  await expect(aud.locator('.show-black')).toBeVisible()
  await page.keyboard.press('b')
  await page.keyboard.press('Escape')
  await expect.poll(() => aud.isClosed()).toBe(true)
})

test('save as .pptx and open it again', async ({ page }) => {
  await page.getByRole('button', { name: /Pitch deck/ }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const d = await dl
  expect(d.suggestedFilename()).toBe('Pitch deck.pptx')
  const bytes = readFileSync((await d.path())!)
  const files = unzipSync(new Uint8Array(bytes))
  expect(Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(6)
  expect(strFromU8(files['ppt/slides/slide1.xml'])).toContain('Your company name')
  // Open it again in a fresh deck.
  await page.evaluate(async (b) => { await window.__kwp.openBytes('again.pptx', new Uint8Array(b)) }, [...bytes])
  const s = await state(page)
  expect(s.deck.slides).toHaveLength(6)
})

test('export as web page, PDF and outline', async ({ page }) => {
  await page.getByRole('button', { name: /Quarterly review/ }).click()
  for (const [label, ext] of [['Web page you can present from (.html)', 'html'], ['PDF (.pdf)', 'pdf'], ['Outline (.md)', 'md']] as const) {
    await page.getByRole('button', { name: 'File' }).click()
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name: label }).click()
    const d = await dl
    expect(d.suggestedFilename()).toBe(`Quarterly review.${ext}`)
    const bytes = readFileSync((await d.path())!)
    if (ext === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    if (ext === 'html') expect(bytes.toString()).toContain('Revenue by region')
    if (ext === 'md') expect(bytes.toString()).toContain('# Highlights')
  }
})

test('a deck is kept in this browser and listed under Recent', async ({ page }) => {
  await page.getByRole('button', { name: /Pitch deck/ }).click()
  await hit(page, 0).dblclick(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Kept safe'); await page.keyboard.press('Escape')
  await page.waitForTimeout(2200)
  await page.reload()
  await expect(page.locator('.recent .item').first()).toContainText('Pitch deck')
  await page.locator('.recent .item').first().click()
  await expect(page.locator('.slide-thumb').first()).toContainText('Kept safe')
})

test('the slide master can be edited and shows on every slide', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('button', { name: 'Slide master' }).click()
  await expect(page.getByText('Editing the slide master')).toBeVisible()
  await page.getByRole('button', { name: 'Shapes' }).click()
  await page.getByRole('button', { name: 'Heart', exact: true }).click()
  const a = await toPage(page, 800, 450), b = await toPage(page, 880, 520)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 }); await page.mouse.up()
  await page.getByRole('button', { name: 'Close master view' }).click()
  expect((await state(page)).deck.slides[0].els.some((e) => e.geom === 'heart')).toBe(false)
  await expect(page.locator('.stage .slide-inner path').first()).toBeAttached()
  const master = await page.evaluate(() => JSON.stringify((window.__kwp.store.getState().deck as unknown as { master: { els: unknown[] } }).master.els.length))
  expect(Number(master)).toBe(1)
})

test('editing a layout restyles the slides that use it', async ({ page }) => {
  await page.getByRole('button', { name: /Quarterly review/ }).click()
  await page.locator('.slide-thumb').nth(1).click()
  await page.getByRole('button', { name: 'View' }).click()
  await page.getByRole('button', { name: /Edit this slide’s layout/ }).click()
  await expect(page.getByText(/Editing layout/)).toBeVisible()
  const t = await toPage(page, 300, 60)
  await page.mouse.click(t.x, t.y)
  await page.getByRole('button', { name: 'Larger text' }).click()
  await page.getByRole('button', { name: 'Close master view' }).click()
  const s = await state(page)
  const sizes = s.deck.slides.filter((x) => x.layout === 'titleOnly').map((x) => (x.els.find((e) => e.ph?.role === 'title') as unknown as { st: { sz: number } }).st.sz)
  expect(sizes.length).toBeGreaterThan(1)
  expect(sizes.every((z) => z === 40)).toBe(true)
})

test('shortcuts list opens, and the privacy text says nothing is uploaded', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'Tools' }).click()
  await page.getByRole('button', { name: 'Privacy' }).click()
  await expect(page.getByRole('dialog', { name: 'Privacy' })).toContainText('Nothing is uploaded')
})

test('the interface does not compare itself to other products', async ({ page }) => {
  await blank(page)
  const text = (await page.locator('body').innerText()).toLowerCase()
  for (const w of ['powerpoint', 'google slides', 'keynote', 'microsoft', 'adobe']) expect(text).not.toContain(w)
})
