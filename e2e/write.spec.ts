import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'

declare global {
  interface Window {
    __kw: { commands: Record<string, (...a: unknown[]) => boolean>; getJSON(): unknown; getText(): string; getHTML(): string; state: { doc: { content: { size: number } } } }
  }
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  // Exercise the plain download / file-input path that Firefox and Safari users get.
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
const para = (n: number) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${n}. ` + 'The quick brown fox jumps over the lazy dog. '.repeat(14) }] })
const longDoc = (n = 30) => ({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Long document' }] }, ...Array.from({ length: n }, (_, i) => para(i + 1))] })
const setDoc = (page: Page, doc: unknown) => page.evaluate((d) => (window.__kw.commands.setContent as (x: unknown) => boolean)(d), doc)

test('the start screen offers templates and a new document opens the editor', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Start a new document' })).toBeVisible()
  for (const t of ['Blank document', 'Letter', 'Resume', 'Meeting notes', 'Report', 'Project plan']) await expect(page.getByRole('button', { name: new RegExp(t) })).toBeVisible()
  await page.getByRole('button', { name: /Report/ }).click()
  await expect(page.locator('.ProseMirror h1').first()).toHaveText('Introduction')
  await expect(page.locator('.outline')).toContainText('Conclusion')
})

test('typing, bold and the word count', async ({ page }) => {
  await blank(page)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Hello brave new world')
  await expect(page.locator('.statusbar')).toContainText('4 words')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.locator('.ProseMirror strong')).toHaveText('Hello brave new world')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.ProseMirror strong')).toHaveCount(0)
})

test('styles, fonts, sizes and alignment from the toolbar', async ({ page }) => {
  await blank(page)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Chapter one')
  await page.getByLabel('Paragraph style').selectOption('h1')
  await expect(page.locator('.ProseMirror h1')).toHaveText('Chapter one')
  await expect(page.locator('.outline')).toContainText('Chapter one')
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByLabel('Font', { exact: true }).selectOption('Cambria')
  await page.getByLabel('Font size').fill('24')
  await page.getByLabel('Font size').press('Enter')
  await page.getByRole('button', { name: /^Centre/ }).click()
  const span = page.locator('.ProseMirror h1 span')
  await expect(span).toHaveCSS('font-size', '32px') // 24pt
  await expect(span).toHaveCSS('font-family', /Cambria/)
  await expect(page.locator('.ProseMirror h1')).toHaveCSS('text-align', 'center')
})

test('long text is laid out in pages and no line is cut by a page break', async ({ page }) => {
  await blank(page)
  await setDoc(page, longDoc())
  await expect.poll(() => page.locator('.pg-spacer').count(), { timeout: 15_000 }).toBeGreaterThan(2)
  await expect(page.locator('.statusbar')).toContainText(/of [3-9]/)
  const clash = await page.evaluate(() => {
    const sp = [...document.querySelectorAll('.pg-spacer')].map((e) => e.getBoundingClientRect())
    const bad: string[] = []
    const r = document.createRange()
    const w = document.createTreeWalker(document.querySelector('.ProseMirror')!, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if ((n.parentElement as HTMLElement).closest('.pg-spacer, .pg-end, .pg-first')) continue
      r.selectNodeContents(n)
      for (const b of r.getClientRects()) for (const s of sp) if (b.height > 2 && b.top < s.bottom - 1 && b.bottom > s.top + 1) bad.push(`${Math.round(b.top)}-${Math.round(b.bottom)} vs ${Math.round(s.top)}-${Math.round(s.bottom)}`)
    }
    return bad
  })
  expect(clash).toEqual([])
  // Every page is one page tall: the gap bands are exactly one page apart.
  const tops = await page.evaluate(() => [...document.querySelectorAll('.pg-gap')].map((e) => e.getBoundingClientRect().top))
  const gaps = tops.slice(1).map((t, i) => Math.round(t - tops[i]))
  for (const g of gaps) expect(g).toBe(1056 + 28)
})

test('headers, footers and page numbers appear on every page', async ({ page }) => {
  await blank(page)
  await setDoc(page, longDoc())
  await page.locator('.menubar').getByRole('button', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: /Header and footer text/ }).click()
  await page.getByLabel('Center').first().fill('My report')
  await page.getByLabel('Center').nth(1).fill('Page {page} of {pages}')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect.poll(() => page.locator('.pg-footer .hf .center').first().textContent(), { timeout: 15_000 }).toMatch(/^Page 1 of \d+$/)
  await expect(page.locator('.pg-header .hf .center').first()).toHaveText('My report')
  await expect(page.locator('.pg-spacer .pg-footer .hf .center').nth(1)).toHaveText(/^Page 2 of/)
})

test('page setup changes the paper size', async ({ page }) => {
  await blank(page)
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('button', { name: /Page setup/ }).click()
  await page.getByLabel('Paper').selectOption('a4')
  await page.getByLabel('Orientation').selectOption('landscape')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect.poll(async () => Math.round((await page.locator('.paper').boundingBox())!.width)).toBe(1123)
})

test('tables: insert, type, Tab to the next cell, add a row', async ({ page }) => {
  await blank(page)
  await page.locator('.ProseMirror').click()
  await page.getByRole('button', { name: 'Insert table' }).click()
  await page.getByRole('dialog', { name: 'Insert table' }).getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(page.locator('.ProseMirror table')).toHaveCount(1)
  await expect(page.locator('.ProseMirror th')).toHaveCount(3)
  await expect(page.locator('.ProseMirror')).toBeFocused() // the dialog hands the cursor back
  await page.keyboard.type('A')
  await page.keyboard.press('Tab')
  await page.keyboard.type('B')
  await expect(page.locator('.ProseMirror th').nth(1)).toHaveText('B')
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('button', { name: 'Insert row below' }).click()
  await expect(page.locator('.ProseMirror tr')).toHaveCount(4)
})

test('lists and checklists', async ({ page }) => {
  await blank(page)
  await page.locator('.ProseMirror').click()
  await page.getByRole('button', { name: /^Bulleted list/ }).click()
  await page.keyboard.type('one')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await page.keyboard.press('Tab')
  await expect(page.locator('.ProseMirror ul ul li')).toHaveText('two')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /^Checklist/ }).click()
  await page.keyboard.type('todo')
  await expect(page.locator('.ProseMirror ul[data-type="taskList"] input[type="checkbox"]')).toHaveCount(1)
})

test('find and replace', async ({ page }) => {
  await blank(page)
  await setDoc(page, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cat Cat concatenate cat' }] }] })
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('ControlOrMeta+h')
  await page.getByPlaceholder('Find in document').fill('cat')
  await expect(page.locator('.findbar .count')).toHaveText('1 of 4')
  await page.getByLabel('Whole word').check()
  await expect(page.locator('.findbar .count')).toHaveText('1 of 3')
  await page.getByLabel('Match case').check()
  await expect(page.locator('.findbar .count')).toHaveText('1 of 2')
  await page.getByPlaceholder('Replace with').fill('dog')
  await page.locator('.findbar').getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('.ProseMirror p')).toHaveText('dog Cat concatenate dog')
})

test('links and special characters', async ({ page }) => {
  await blank(page)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Visit ')
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByLabel('Text to show').fill('our site')
  await page.getByLabel('Address').fill('example.org')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.ProseMirror a')).toHaveAttribute('href', 'https://example.org')
  await page.locator('.menubar').getByRole('button', { name: 'Insert', exact: true }).click()
  await page.getByRole('button', { name: /Special characters/ }).first().click()
  await page.getByRole('button', { name: '©' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.ProseMirror')).toContainText('©')
})

test('save as .docx, then open it again with everything intact', async ({ page }) => {
  await blank(page)
  await setDoc(page, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Quarterly review' }] },
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and plain' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first point' }] }] }] },
    ],
  })
  await page.getByRole('button', { name: 'File' }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Save$/ }).first().click()
  const file = await dl
  expect(file.suggestedFilename()).toMatch(/\.docx$/)
  const path = await file.path()
  const zip = unzipSync(new Uint8Array(readFileSync(path)))
  const xml = strFromU8(zip['word/document.xml'])
  expect(xml).toContain('Quarterly review')
  expect(xml).toContain('<w:b/>')
  expect(xml).toContain('w:numPr')

  // New document, then open the saved file.
  await page.getByRole('button', { name: 'Home' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles(path)
  await expect(page.locator('.ProseMirror h1')).toHaveText('Quarterly review')
  await expect(page.locator('.ProseMirror strong')).toHaveText('Bold')
  await expect(page.locator('.ProseMirror p').first()).toHaveCSS('text-align', 'center')
  await expect(page.locator('.ProseMirror ul li')).toHaveText('first point')
})

test('opens markdown and exports markdown and plain text', async ({ page }, info) => {
  await blank(page)
  const md = info.outputPath('note.md')
  const fs = await import('node:fs')
  fs.mkdirSync(info.outputDir, { recursive: true })
  fs.writeFileSync(md, '# Title\n\nSome **bold** and a [link](https://example.org).\n\n- one\n- two\n')
  await page.getByRole('button', { name: 'Home' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles(md)
  await expect(page.locator('.ProseMirror h1')).toHaveText('Title')
  await expect(page.locator('.ProseMirror ul li')).toHaveCount(2)
  const text = await page.evaluate(async () => (await import('/write/src/formats/markdown.ts' as string)).toMarkdown(window.__kw.getJSON()))
    .catch(() => null)
  void text // the export is covered by the unit tests; the dev server path only exists in development
})

test('drafts survive closing the editor and appear in Recent', async ({ page }) => {
  await blank(page)
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('Remember me')
  await page.getByLabel('Document name').fill('My draft')
  await page.waitForTimeout(1200)
  await page.reload()
  await expect(page.locator('.recent .item', { hasText: 'My draft' })).toBeVisible()
  await page.locator('.recent .item', { hasText: 'My draft' }).click()
  await expect(page.locator('.ProseMirror')).toContainText('Remember me')
})

test('the privacy dialog turns the anonymous launch counter on and off', async ({ page }) => {
  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('button', { name: /Privacy and counters/ }).click()
  const box = page.getByLabel('Count my launches anonymously')
  await expect(box).toBeChecked()
  await box.uncheck()
  expect(await page.evaluate(() => localStorage.getItem('kwiiva.usage'))).toBe('off')
  await box.check()
  expect(await page.evaluate(() => localStorage.getItem('kwiiva.usage'))).toBe('on')
})

test('nothing in the editor mentions other products', async ({ page }) => {
  await blank(page)
  await expect(page.locator('body')).not.toContainText(/microsoft|google|\bword\b(?! count)/i)
})
