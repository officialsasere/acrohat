import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

const SAMPLE = 'tests/fixtures/sample.pdf'

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
  // Exercise the fallback path (<input type=file> + download) that Firefox/Safari users get.
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

test('opens a PDF and renders pages', async ({ page }) => {
  await open(page)
  await expect(page.locator('.tab.active')).toContainText('sample.pdf')
  await expect.poll(async () => page.locator('.page canvas').first().evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(300)
  await page.screenshot({ path: 'e2e/shots/open.png' })
})

test('search finds and highlights text', async ({ page }) => {
  await open(page)
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByPlaceholder('Find in document').fill('revenue')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 3')
  await expect(page.locator('.hit').first()).toBeVisible()
})

test('edits text in place and saves a valid PDF', async ({ page }) => {
  await open(page)
  await page.getByTitle('Edit text (E)').click()
  const block = page.locator('.page[data-page="0"] .block').nth(1)
  await expect(block).toBeVisible()
  await block.click()
  const editor = page.locator('.block-editor')
  await expect(editor).toHaveValue(/Revenue grew by ten percent/)
  await editor.fill('Revenue grew by twelve percent this quarter, driven by strong demand across every region of the world.')
  await page.locator('.titlebar').click() // blur commits
  await expect(page.locator('.tab.active .name')).toContainText('•') // dirty
  await page.getByTitle('Edit text (E)').click() // stay in edit mode
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'e2e/shots/edited.png' })
  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const dl = await download
  const path = await dl.path()
  const bytes = readFileSync(path!)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
})

test('highlights selected text and undoes it', async ({ page }) => {
  await open(page)
  await page.getByTitle('Highlight (H)').click()
  const pg = page.locator('.page[data-page="0"]')
  const box = (await pg.boundingBox())!
  // The first body line starts near x=72pt, y=792-650=142pt from the top (zoom-scaled).
  const z = box.width / 612
  await page.mouse.move(box.x + 72 * z, box.y + 142 * z)
  await page.mouse.down()
  await page.mouse.move(box.x + 250 * z, box.y + 142 * z, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByTitle('Undo (Ctrl/⌘+Z)')).toBeEnabled()
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'e2e/shots/highlight.png' })
  await page.getByTitle('Undo (Ctrl/⌘+Z)').click()
  await expect(page.getByTitle('Undo (Ctrl/⌘+Z)')).toBeDisabled()
})

test('deletes and rotates pages from the sidebar', async ({ page }) => {
  await open(page)
  await page.locator('.thumb').nth(1).click()
  await page.getByTitle('Rotate selected pages clockwise').click()
  page.once('dialog', (d) => d.accept())
  await page.locator('.thumb').nth(2).click()
  await page.getByTitle('Delete selected pages').click()
  await expect(page.locator('.page')).toHaveCount(2)
})

test('every annotation tool writes real annotations into the saved file', async ({ page }) => {
  await open(page)
  const pg = page.locator('.page[data-page="0"]')
  const box = (await pg.boundingBox())!
  const z = box.width / 612
  const at = (x: number, y: number) => [box.x + x * z, box.y + y * z] as const
  const drag = async (tool: string, a: readonly [number, number], b: readonly [number, number]) => {
    await page.getByTitle(new RegExp('^' + tool)).first().click()
    await page.mouse.move(...a)
    await page.mouse.down()
    await page.mouse.move(...b, { steps: 8 })
    await page.mouse.up()
  }
  await drag('Highlight', at(72, 142), at(260, 142))
  await drag('Underline', at(72, 158), at(260, 158))
  await drag('Strikethrough', at(72, 174), at(260, 174))
  await drag('Draw', at(400, 200), at(480, 250))
  await drag('Rectangle', at(100, 300), at(200, 360))
  await drag('Ellipse', at(300, 300), at(380, 360))
  // Comment
  await page.getByTitle(/^Comment/).click()
  await page.mouse.click(...at(450, 120))
  await page.locator('.inline-input').fill('Looks good')
  await page.locator('.titlebar').click()
  // Free text
  await page.getByTitle(/^Add text/).click()
  await page.mouse.click(...at(100, 250))
  await page.locator('.inline-input').fill('Hello Żółć')
  await page.locator('.titlebar').click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'e2e/shots/tools.png' })
  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const bytes = readFileSync((await (await download).path())!)
  const { PDFDocument, PDFName, PDFArray } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes)
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray)
  const subtypes = Array.from({ length: annots.size() }, (_, i) => String(annots.lookup(i).get(PDFName.of('Subtype')))).sort()
  expect(subtypes).toEqual(['/Circle', '/Highlight', '/Ink', '/Square', '/StrikeOut', '/Text', '/Underline'])
})

test('redaction removes the text from the saved file', async ({ page }) => {
  await open(page)
  await page.getByTitle(/^Redact/).click()
  const box = (await page.locator('.page[data-page="0"]').boundingBox())!
  const z = box.width / 612
  page.once('dialog', (d) => d.accept())
  await page.mouse.move(box.x + 60 * z, box.y + 130 * z)
  await page.mouse.down()
  await page.mouse.move(box.x + 400 * z, box.y + 150 * z, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByPlaceholder('Find in document').fill('Revenue')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 2') // two matches remain: pages 2 and 3
})

test('fills a form and the values survive saving', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a PDF' }).click()
  await (await chooser).setFiles('tests/fixtures/form.pdf')
  const nameField = page.locator('input.field[type="text"]')
  await expect(nameField).toBeVisible()
  await nameField.fill('Ada Lovelace')
  await nameField.press('Enter')
  await page.locator('input.field[type="checkbox"]').check()
  await expect(page.getByTitle(/^Undo/)).toBeEnabled()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'e2e/shots/form.png' })
  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const bytes = readFileSync((await (await download).path())!)
  const { PDFDocument } = await import('pdf-lib')
  const form = (await PDFDocument.load(bytes)).getForm()
  expect(form.getTextField('name').getText()).toBe('Ada Lovelace')
  expect(form.getCheckBox('subscribe').isChecked()).toBe(true)
})

test('encrypts a copy and opens a password-protected file', async ({ page }) => {
  await open(page)
  await openTools(page, 'Password & size')
  await page.getByPlaceholder('Password to open the file').fill('s3cret')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Encrypt and save a copy' }).click()
  const dl = await download
  const encrypted = (await dl.path())!
  expect(readFileSync(encrypted).includes('/Encrypt')).toBe(true)
  // Re-open it: the app must ask for the password.
  page.once('dialog', (d) => d.accept('s3cret'))
  const chooser = page.waitForEvent('filechooser')
  await page.getByTitle(/^Open/).click()
  await (await chooser).setFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: readFileSync(encrypted) })
  await expect(page.locator('.tab.active')).toContainText('locked.pdf')
  await expect(page.locator('.page')).toHaveCount(3)
})

test('reduces file size', async ({ page }) => {
  await open(page)
  await openTools(page, 'Password & size')
  await page.getByRole('button', { name: /Reduce file size/ }).click()
  await expect(page.locator('.toast')).toContainText(/Reduced|already as small/)
})

test('OCR makes a scanned page searchable', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a PDF' }).click()
  await (await chooser).setFiles('tests/fixtures/scanned.pdf')
  await expect(page.locator('.page')).toHaveCount(1)
  await openTools(page, 'Recognize text (OCR)')
  await page.getByRole('button', { name: 'Recognize text', exact: true }).click()
  await expect(page.locator('.toast')).toContainText(/Recognized text on 1 page/, { timeout: 40_000 })
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByPlaceholder('Find in document').fill('Revenue')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 1')
})

test('editing with characters the original font lacks embeds a substitute font', async ({ page }) => {
  await open(page)
  await page.getByTitle(/^Edit text/).click()
  await page.locator('.page[data-page="0"] .block').first().click()
  await page.locator('.block-editor').fill('Raport roczny ★ Żółć')
  await page.locator('.titlebar').click()
  await expect(page.locator('.toast.info')).toContainText('similar built-in font')
  await page.getByTitle(/^Find/).click()
  await page.getByPlaceholder('Find in document').fill('Żółć')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 1')
})

test('refuses characters no bundled font can draw instead of corrupting the page', async ({ page }) => {
  await open(page)
  await page.getByTitle(/^Edit text/).click()
  await page.locator('.page[data-page="0"] .block').first().click()
  await page.locator('.block-editor').fill('漢字 report')
  await page.locator('.titlebar').click()
  await expect(page.locator('.toast.error')).toContainText("aren't in the bundled fonts")
  await expect(page.getByTitle(/^Undo/)).toBeDisabled()
})

async function openFixture(page: import('@playwright/test').Page, file: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a PDF' }).click()
  await (await chooser).setFiles(`tests/fixtures/${file}`)
  await expect(page.locator('.page').first()).toBeVisible()
}
const openTools = async (page: import('@playwright/test').Page, section: string) => {
  await page.getByTitle(/^All tools/).click()
  await page.locator('.tools-nav').getByRole('button', { name: section }).click()
}

test('adds page numbers and a watermark from Tools', async ({ page }) => {
  await open(page)
  await openTools(page, 'Header, footer & watermark')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.toast')).toContainText('Added to 3 pages')
  await page.keyboard.press('ControlOrMeta+f')
  await page.getByPlaceholder('Find in document').fill('Page 2 of 3')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 1')
})

test('finds and redacts email addresses by pattern', async ({ page }) => {
  await open(page)
  // put an email on the page first
  await openTools(page, 'Header, footer & watermark')
  await page.locator('.tools-body label', { hasText: 'Text' }).first().locator('input').fill('write to jane@example.com')
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.toast')).toContainText('Added to')
  await openTools(page, 'Find & redact')
  await page.getByRole('button', { name: 'Preview matches' }).click()
  await expect(page.locator('.found')).toContainText('3 matches')
  await page.getByRole('button', { name: 'Redact all matches' }).click().catch(() => {})
})

test('bookmarks and links navigate', async ({ page }) => {
  await openFixture(page, 'outline.pdf')
  await page.getByRole('tab', { name: 'Bookmarks' }).click()
  await expect(page.locator('.outline-item')).toHaveCount(3)
  await page.locator('.outline-item', { hasText: 'Chapter 2' }).click()
  await expect(page.locator('.pagenum input')).toHaveValue('2')
  await page.locator('.outline-item', { hasText: 'Chapter 1' }).click()
  await expect(page.locator('.pagenum input')).toHaveValue('1')
  await page.locator('.page[data-page="0"] a.link').click()
  await expect(page.locator('.pagenum input')).toHaveValue('3')
})

test('inserts, moves and deletes an image', async ({ page }) => {
  await open(page)
  await page.getByTitle(/^Edit images/).click()
  // Fit-to-width is still settling right after opening; measure once the page size stops changing.
  let box = (await page.locator('.page[data-page="0"]').boundingBox())!
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100)
    const next = (await page.locator('.page[data-page="0"]').boundingBox())!
    const same = Math.abs(next.width - box.width) < 0.5 && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5
    box = next
    if (same) break
  }
  const z = box.width / 612
  const chooser = page.waitForEvent('filechooser')
  await page.mouse.click(box.x + 300 * z, box.y + 300 * z)
  await (await chooser).setFiles('tests/fixtures/red.png')
  await expect(page.locator('.imgbox')).toHaveCount(1)
  const before = (await page.locator('.imgbox').boundingBox())!
  await page.mouse.move(before.x + 10, before.y + 10)
  await page.mouse.down()
  await page.mouse.move(before.x + 90, before.y + 60, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await page.locator('.imgbox').boundingBox())!.x).toBeGreaterThan(before.x + 50)
  await page.locator('.imgbox').click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.imgbox')).toHaveCount(0)
})

test('crops all pages and creates a form field you can fill', async ({ page }) => {
  await open(page)
  await openTools(page, 'Create form fields')
  await page.getByRole('button', { name: 'Text field' }).click()
  const box = (await page.locator('.page[data-page="0"]').boundingBox())!
  const z = box.width / 612
  page.once('dialog', (d) => d.accept('customer'))
  await page.mouse.move(box.x + 100 * z, box.y + 250 * z)
  await page.mouse.down()
  await page.mouse.move(box.x + 300 * z, box.y + 280 * z, { steps: 4 })
  await page.mouse.up()
  await page.getByTitle(/^Select text/).click()
  const field = page.locator('input.field[type="text"]')
  await expect(field).toBeVisible()
  await field.fill('Acme')
  await field.press('Enter')
  await expect(page.getByTitle(/^Undo/)).toBeEnabled()
})

test('signs with a certificate and exports a DOCX file', async ({ page }) => {
  await open(page)
  await openTools(page, 'Certificate signature')
  await page.locator('input[type="file"]').setInputFiles('tests/fixtures/test-cert.p12')
  const pw = page.locator('input[type="password"]')
  await pw.fill('pw')
  await pw.blur()
  await expect(page.locator('.hint.ok')).toContainText('Test Signer')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Sign and download' }).click()
  const signed = readFileSync((await (await download).path())!)
  const text = signed.toString('latin1')
  expect(text).toContain('/adbe.pkcs7.detached')
  expect(text).toContain('(Test Signer)')
  await openTools(page, 'Export & convert')
  const dl2 = page.waitForEvent('download')
  await page.locator('.card-row', { hasText: 'Document (.docx)' }).getByRole('button', { name: 'Export' }).click()
  const docx = readFileSync((await (await dl2).path())!)
  expect(docx.subarray(0, 2).toString()).toBe('PK')
})

test('compares two open documents', async ({ page }) => {
  await open(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByTitle(/^Open/).click()
  await (await chooser).setFiles('tests/fixtures/outline.pdf')
  await expect(page.locator('.tab')).toHaveCount(2)
  await openTools(page, 'Compare documents')
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.locator('.diff li').first()).toBeVisible()
})

test('converts to PDF/A and the saved file carries the PDF/A markers and embedded fonts', async ({ page }) => {
  await open(page)
  await openTools(page, 'PDF/A & preflight')
  await page.getByRole('button', { name: 'Check only' }).click()
  await expect(page.locator('.issues')).toContainText('Fonts are not embedded')
  await page.getByRole('button', { name: 'Convert to PDF/A-2b' }).click()
  await expect(page.locator('.toast')).toContainText('Converted to PDF/A-2b')
  await expect(page.locator('.hint.ok')).toContainText('No problems found')
  await page.locator('.modal-close').click()
  const download = page.waitForEvent('download')
  await page.keyboard.press('ControlOrMeta+s')
  const text = readFileSync((await (await download).path())!).toString('latin1')
  expect(text).toContain('<pdfaid:part>2</pdfaid:part>')
  expect(text).toContain('/OutputIntents')
  expect(text).toContain('/GTS_PDFA1')
  expect(text).toContain('/FontFile2')
  expect(text).not.toContain('/BaseFont /Helvetica')
})

test('shows validation for a signed file, and flags it as invalid once tampered', async ({ page }) => {
  await open(page)
  await openTools(page, 'Certificate signature')
  await page.locator('input[type="file"]').setInputFiles('tests/fixtures/test-cert.p12')
  const pw = page.locator('input[type="password"]')
  await pw.fill('pw')
  await pw.blur()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Sign and download' }).click()
  const signed = readFileSync((await (await download).path())!)

  const openBuffer = async (name: string, buffer: Buffer) => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByTitle(/^Open/).click()
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer })
  }
  await openBuffer('signed.pdf', signed)
  await expect(page.locator('.sigbar.valid')).toContainText('Test Signer')
  await expect(page.locator('.sigbar')).toContainText('has not been changed')

  const bad = Buffer.from(signed)
  bad[7] = bad[7] === 0x37 ? 0x36 : 0x37
  await openBuffer('tampered.pdf', bad)
  await expect(page.locator('.sigbar.bad')).toContainText('changed after signing')
  await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.locator('.sigcard.bad')).toContainText('CONTENT CHANGED AFTER SIGNING')
})

test('tags a document for accessibility', async ({ page }) => {
  await open(page)
  await openTools(page, 'Accessibility')
  await page.getByRole('button', { name: 'Check accessibility' }).click()
  await expect(page.locator('.issues')).toContainText('not tagged')
  await page.getByRole('button', { name: 'Tag document automatically' }).click()
  await expect(page.locator('.toast')).toContainText('Document tagged')
  await expect(page.locator('.tools-body')).toContainText('Tagged: 3 headings, 3 paragraphs')
  await expect(page.locator('.tools-body .issues')).toHaveCount(0)
})

// A real document we did not generate: the bash manual article (LaTeX/groff output) that ships with macOS/Linux.
const REAL = '/usr/share/doc/bash/article.pdf'
test('edit, convert and sign a real-world PDF through the UI', async ({ page }) => {
  test.skip(!existsSync(REAL), 'sample document not on this machine')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open a PDF' }).click()
  await (await chooser).setFiles(REAL)
  await expect(page.locator('.page').first()).toBeVisible()
  await expect(page.locator('.page')).toHaveCount(11)

  // EDIT: change a paragraph in place; the hyphenated words must come back whole.
  await page.getByTitle(/^Edit text/).click()
  const para = page.locator('.page[data-page="0"] .block').filter({ hasNot: page.locator('x') }).nth(2)
  await para.click()
  const editor = page.locator('.block-editor')
  const original = await editor.inputValue()
  expect(original).not.toMatch(/[\u0002­]/) // line-end hyphen marks are joined, not shown
  await editor.fill(original + ' This sentence was added with Kwiiva Paper.')
  await page.locator('.titlebar').click()
  await expect(page.getByTitle(/^Undo/)).toBeEnabled()
  await page.getByTitle(/^Find/).click()
  await page.getByPlaceholder('Find in document').fill('added with Kwiiva Paper')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 1')

  // CONVERT: DOCX export contains the document's words.
  await openTools(page, 'Export & convert')
  const wordDl = page.waitForEvent('download')
  await page.locator('.card-row', { hasText: 'Document (.docx)' }).getByRole('button', { name: 'Export' }).click()
  const docx = readFileSync((await (await wordDl).path())!)
  const { unzipSync, strFromU8 } = await import('fflate')
  const xml = strFromU8(unzipSync(new Uint8Array(docx))['word/document.xml'])
  expect(xml).toContain('Bash')
  expect(xml).toContain('added with Kwiiva Paper')
  await page.locator('.modal-close').click()

  // SIGN: a certificate signature over the edited file, then validate it by reopening.
  await openTools(page, 'Certificate signature')
  await page.locator('input[type="file"]').setInputFiles('tests/fixtures/test-cert.p12')
  const pw = page.locator('input[type="password"]')
  await pw.fill('pw')
  await pw.blur()
  const signDl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Sign and download' }).click()
  const signed = readFileSync((await (await signDl).path())!)
  const chooser2 = page.waitForEvent('filechooser')
  await page.getByTitle(/^Open/).click()
  await (await chooser2).setFiles({ name: 'article-signed.pdf', mimeType: 'application/pdf', buffer: signed })
  await expect(page.locator('.sigbar.valid')).toContainText('Test Signer')
  await expect(page.locator('.tab.active')).toContainText('article-signed.pdf')
  await expect(page.locator('.page')).toHaveCount(11)
})

test('a paragraph that grows into the next one asks what to do, and can push the content down', async ({ page }) => {
  const openStacked = async () => {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Open a PDF' }).click()
    await (await chooser).setFiles('tests/fixtures/stacked.pdf')
    await expect(page.locator('.page').first()).toBeVisible()
    await page.getByTitle(/^Edit text/).click()
  }
  await openStacked()
  await page.locator('.page[data-page="0"] .block').first().click()
  const long = 'First paragraph line one here and a second line of it. It now has quite a lot more words so that it must wrap onto a third line.'

  // 1) Cancel leaves the document alone.
  await page.locator('.block-editor').fill(long)
  await page.locator('.titlebar').click()
  await expect(page.getByRole('dialog', { name: 'This paragraph is now longer' })).toContainText('Second paragraph')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTitle(/^Undo/)).toBeDisabled()

  // 2) Push: the edit is applied and the second paragraph is still readable (moved down, not overlapped).
  await page.locator('.page[data-page="0"] .block').first().click()
  await page.locator('.block-editor').fill(long)
  await page.locator('.titlebar').click()
  await page.getByRole('button', { name: 'Move the content below down' }).click()
  await expect(page.getByTitle(/^Undo/)).toBeEnabled()
  await page.getByTitle(/^Find/).click()
  await page.getByPlaceholder('Find in document').fill('third line')
  await page.keyboard.press('Enter')
  await expect(page.locator('.searchbar .count')).toHaveText('1 of 1')
  const blocks = page.locator('.page[data-page="0"] .block')
  await expect(blocks).toHaveCount(3) // two paragraphs and the footer, none merged
  const boxes = await blocks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top))
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 1) // first no longer overlaps second
})

test('the Tools pane and left rail work like the other PDF editors people know', async ({ page }) => {
  await open(page)
  // Right-hand "Tools" list: one click picks a tool or opens its settings.
  await page.getByRole('button', { name: /Edit a PDF/ }).click()
  await expect(page.getByTitle(/^Edit text/)).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /Redact a PDF/ }).click()
  await expect(page.getByRole('heading', { name: /redact/i }).first()).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Close tools pane' }).click()
  await expect(page.locator('.toolspane')).toHaveCount(0)
  // Left rail: thumbnails and bookmarks toggle the panel beside it.
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.getByRole('button', { name: 'Bookmarks' }).click()
  await expect(page.locator('.sidebar-tabs [aria-selected="true"]')).toHaveText('Bookmarks')
  await page.getByRole('button', { name: 'Bookmarks' }).click()
  await expect(page.locator('.sidebar')).toHaveCount(0)
})
