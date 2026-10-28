import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'

declare global {
  interface Window {
    __kwg: { store: { getState(): { book: { value(s: number, r: number, c: number): unknown; getCell(s: number, r: number, c: number): { f?: string; s: number } | undefined; display(s: number, r: number, c: number): { text: string }; styleOf(s: number, r: number, c: number): Record<string, unknown>; wb: { sheets: { id: number; name: string; hiddenRows: Set<number>; frozenRows: number; charts: unknown[]; merges: unknown[]; cf: unknown[]; validations: unknown[]; filter?: unknown }[]; active: number }; activeSheet: { id: number } }; sel: { r: number; c: number } } } }
  }
}

test.beforeEach(async ({ page, context }) => {
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    delete (window as never as Record<string, unknown>).showOpenFilePicker
    delete (window as never as Record<string, unknown>).showSaveFilePicker
  })
  await page.goto('/grid/app/')
})

const blank = async (page: Page) => {
  await page.getByRole('button', { name: /Blank spreadsheet/ }).click()
  await expect(page.locator('.grid-hit')).toBeVisible()
}
/** Centre of a cell in page coordinates (default sizes, no scrolling, 100% zoom). */
const at = async (page: Page, col: number, row: number) => { const b = (await page.locator('.grid-hit').boundingBox())!; return { x: b.x + 48 + col * 100 + 50, y: b.y + 24 + row * 22 + 11 } }
const click = async (page: Page, col: number, row: number) => { const p = await at(page, col, row); await page.mouse.click(p.x, p.y) }
const val = (page: Page, a1: string) => page.evaluate((a) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64
  const st = window.__kwg.store.getState(); return st.book.value(st.book.wb.active, Number(m[2]) - 1, c - 1)
}, a1)
const shown = (page: Page, a1: string) => page.evaluate((a) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a)!; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64
  const st = window.__kwg.store.getState(); return st.book.display(st.book.wb.active, Number(m[2]) - 1, c - 1).text
}, a1)
const typeAt = async (page: Page, col: number, row: number, text: string) => { await click(page, col, row); await page.keyboard.type(text); await page.keyboard.press('Enter') }
const fillSample = async (page: Page) => {
  const rows = [['Item', 'Qty', 'Price'], ['Pens', '10', '1.5'], ['Paper', '3', '4.25'], ['Ink', '2', '12']]
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 3; c++) await typeAt(page, c, r, rows[r][c])
}

test('the start screen offers templates, and a template opens with its numbers worked out', async ({ page }) => {
  for (const t of ['Blank spreadsheet', 'Monthly budget', 'Invoice', 'To-do list', 'Project tracker', 'Gradebook']) await expect(page.getByRole('button', { name: new RegExp(t) })).toBeVisible()
  await page.getByRole('button', { name: /Monthly budget/ }).click()
  expect(await shown(page, 'B9')).toBe('$2,230.00')
  expect(await shown(page, 'D4')).toBe('-$38.00')
})

test('typing numbers, text and formulas; results update when a cell changes', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await typeAt(page, 3, 1, '=B2*C2')
  await typeAt(page, 3, 4, '=SUM(D2:D4)')
  expect(await val(page, 'D2')).toBe(15)
  await typeAt(page, 1, 1, '20')
  expect(await val(page, 'D2')).toBe(30)
  expect(await val(page, 'A2')).toBe('Pens')
  await click(page, 3, 4)
  await expect(page.getByLabel('Formula bar')).toHaveValue('=SUM(D2:D4)')
  await expect(page.getByLabel('Name box')).toHaveValue('D5')
})

test('typed dates, percentages and currency become numbers with matching formats', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, '3/14/2026'); await typeAt(page, 0, 1, '12.5%'); await typeAt(page, 0, 2, '$1,234.50'); await typeAt(page, 0, 3, "'007")
  expect(await val(page, 'A1')).toBe(46095)
  expect(await shown(page, 'A1')).toBe('3/14/2026')
  expect(await shown(page, 'A2')).toBe('12.5%')
  expect(await shown(page, 'A3')).toBe('$1,234.50')
  expect(await val(page, 'A4')).toBe('007')
})

test('arrow keys, Ctrl+Arrow and the name box move around', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await click(page, 0, 0)
  await page.keyboard.press('Control+ArrowDown')
  await expect(page.getByLabel('Name box')).toHaveValue('A4')
  await page.keyboard.press('Control+ArrowRight')
  await expect(page.getByLabel('Name box')).toHaveValue('C4')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(page.getByLabel('Name box')).toHaveValue('C3:C4')
  await page.getByLabel('Name box').fill('B2:C3')
  await page.getByLabel('Name box').press('Enter')
  await expect(page.getByLabel('Name box')).toHaveValue('B2:C3')
})

test('formatting: bold, currency, fill colour and borders', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await click(page, 2, 1)
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown')
  await page.getByRole('button', { name: 'Format as currency' }).click()
  expect(await shown(page, 'C2')).toBe('$1.50')
  expect(await shown(page, 'C4')).toBe('$12.00')
  await page.keyboard.press('Control+b')
  expect(await page.evaluate(() => { const s = window.__kwg.store.getState(); return s.book.styleOf(s.book.wb.active, 2, 2).bold })).toBe(true)
  await page.getByRole('button', { name: 'Fewer decimal places' }).click()
  expect(await shown(page, 'C2')).toBe('$1.5')
  await page.getByRole('button', { name: 'Borders' }).click()
  await page.getByRole('button', { name: 'All borders' }).click()
  expect(await page.evaluate(() => { const s = window.__kwg.store.getState(); return s.book.styleOf(s.book.wb.active, 1, 2).bb })).toMatchObject({ style: 'thin' })
})

test('copy and paste keeps formulas moving with their cells', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, '2'); await typeAt(page, 0, 1, '3'); await typeAt(page, 1, 0, '=A1*10'); await typeAt(page, 1, 1, '=A2*10')
  await click(page, 1, 0)
  await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('ControlOrMeta+c')
  await click(page, 3, 0); await page.keyboard.press('ControlOrMeta+v')
  await expect.poll(() => page.evaluate(() => { const s = window.__kwg.store.getState(); return s.book.getCell(s.book.wb.active, 1, 3)?.f })).toBe('=C2*10')
  expect(await val(page, 'D1')).toBe(await val(page, 'B1') === 20 ? 0 : 0) // C1 is empty, so the copy reads zero
})

test('the fill handle continues a series and copies formulas', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, '1'); await typeAt(page, 0, 1, '2')
  await typeAt(page, 1, 0, 'Mon'); await typeAt(page, 2, 0, 'Item 1'); await typeAt(page, 3, 0, '=A1*2')
  await click(page, 0, 0); await page.keyboard.press('Shift+ArrowDown')
  // drag the fill handle at the bottom-right corner of A1:A2 down to row 5
  const end = await at(page, 0, 1)
  await page.mouse.move(end.x + 50, end.y + 11); await page.mouse.down()
  const to = await at(page, 0, 4)
  await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up()
  expect([await val(page, 'A3'), await val(page, 'A4'), await val(page, 'A5')]).toEqual([3, 4, 5])
  for (const col of [1, 2, 3]) { await click(page, col, 0); const e = await at(page, col, 0); await page.mouse.move(e.x + 50, e.y + 11); await page.mouse.down(); const t = await at(page, col, 2); await page.mouse.move(t.x, t.y, { steps: 6 }); await page.mouse.up() }
  expect([await val(page, 'B2'), await val(page, 'B3')]).toEqual(['Tue', 'Wed'])
  expect(await val(page, 'C3')).toBe('Item 3')
  expect(await val(page, 'D3')).toBe(6)
})

test('inserting and deleting rows and columns rewrites formulas', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, '1'); await typeAt(page, 0, 1, '2'); await typeAt(page, 0, 2, '3'); await typeAt(page, 1, 0, '=SUM(A1:A3)')
  await click(page, 0, 1)
  await page.getByRole('button', { name: 'Insert', exact: true }).first().click()
  await page.getByRole('button', { name: 'Row above' }).click()
  expect(await val(page, 'A3')).toBe(2)
  await expect.poll(() => page.evaluate(() => { const s = window.__kwg.store.getState(); return s.book.getCell(s.book.wb.active, 0, 1)?.f })).toBe('=SUM(A1:A4)')
  await page.keyboard.press('Control+z')
  expect(await val(page, 'A2')).toBe(2)
})

test('sorting, filtering and find and replace', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await click(page, 1, 1)
  await page.getByRole('button', { name: 'Data', exact: true }).click()
  await page.getByRole('button', { name: 'Sort Z → A' }).click()
  expect([await val(page, 'A2'), await val(page, 'A3'), await val(page, 'A4')]).toEqual(['Pens', 'Paper', 'Ink'])
  await click(page, 0, 0)
  await page.keyboard.press('Control+Shift+l')
  expect(await page.evaluate(() => !!window.__kwg.store.getState().book.activeSheet && !!(window.__kwg.store.getState().book.wb.sheets[0] as { filter?: unknown }).filter)).toBe(true)
  await page.keyboard.press('Control+f')
  await page.getByLabel('Find', { exact: true }).fill('paper')
  await expect(page.getByText('1 of 1 found')).toBeVisible()
  await page.getByLabel('Replace with').fill('Card')
  await page.getByRole('button', { name: 'Replace all' }).click()
  expect(await val(page, 'A3')).toBe('Card')
})

test('several sheets, with formulas that reach across them', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, '5')
  await page.getByRole('button', { name: 'Add sheet' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await typeAt(page, 0, 0, '=Sheet1!A1*3')
  expect(await val(page, 'A1')).toBe(15)
  await page.getByRole('tab', { name: /Sheet1/ }).click()
  await typeAt(page, 0, 0, '7')
  await page.getByRole('tab', { name: /Sheet2/ }).click()
  expect(await val(page, 'A1')).toBe(21)
  await page.getByRole('tab', { name: /Sheet2/ }).dblclick()
  await page.getByRole('textbox', { name: 'Sheet name', exact: true }).fill('Totals')
  await page.getByRole('textbox', { name: 'Sheet name', exact: true }).press('Enter')
  await expect(page.getByRole('tab', { name: /Totals/ })).toBeVisible()
})

test('charts: insert one from the data, then change it', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await click(page, 0, 0); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowDown'); await page.keyboard.press('Shift+ArrowRight')
  await page.getByRole('button', { name: 'Insert chart' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Stock')
  await page.getByRole('dialog').getByRole('button', { name: 'Insert', exact: true }).click()
  await expect(page.locator('.object svg')).toHaveCount(1)
  await expect(page.locator('.object svg text', { hasText: 'Stock' })).toBeVisible()
  expect(await page.evaluate(() => window.__kwg.store.getState().book.activeSheet && (window.__kwg.store.getState().book.wb.sheets[0].charts as unknown[]).length)).toBe(1)
})

test('data validation drop-downs and check boxes', async ({ page }) => {
  await blank(page)
  await click(page, 0, 0)
  await page.getByRole('button', { name: 'Insert', exact: true }).first().click()
  await page.getByRole('button', { name: 'Drop-down list…' }).click()
  await page.getByLabel('Items, separated by commas').fill('Red, Green, Blue')
  await page.getByRole('dialog', { name: 'Data validation' }).getByRole('button', { name: 'Save' }).click()
  await click(page, 0, 0)
  await page.keyboard.press('Alt+ArrowDown')
  await page.getByRole('option', { name: 'Green' }).click()
  expect(await val(page, 'A1')).toBe('Green')
  await typeAt(page, 0, 0, 'Purple')
  await expect(page.getByText('This value is not allowed in this cell.')).toBeVisible()
  expect(await val(page, 'A1')).toBe('Green')
})

test('freeze panes and merged cells', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await page.getByRole('button', { name: 'Freeze panes' }).click()
  await page.getByRole('button', { name: '1 row', exact: true }).click()
  expect(await page.evaluate(() => window.__kwg.store.getState().book.wb.sheets[0].frozenRows)).toBe(1)
  await click(page, 0, 5); await page.keyboard.press('Shift+ArrowRight')
  await page.getByRole('button', { name: 'Merge cells' }).click()
  await page.getByRole('button', { name: 'Merge all' }).click()
  expect(await page.evaluate(() => window.__kwg.store.getState().book.wb.sheets[0].merges.length)).toBe(1)
})

test('save as .xlsx, then open it again with everything intact', async ({ page }) => {
  await blank(page)
  await fillSample(page)
  await typeAt(page, 3, 1, '=B2*C2')
  await click(page, 0, 0); await page.keyboard.press('Control+b')
  await page.getByLabel('Spreadsheet name').fill('Stock take')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const file = await dl
  expect(file.suggestedFilename()).toBe('Stock take.xlsx')
  const zip = unzipSync(new Uint8Array(readFileSync((await file.path())!)))
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  expect(sheet).toContain('<f>B2*C2</f>')
  expect(strFromU8(zip['xl/sharedStrings.xml'])).toContain('Paper')
  await page.getByRole('button', { name: 'Home' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles((await file.path())!)
  await expect(page.locator('.grid-hit')).toBeVisible()
  expect(await val(page, 'D2')).toBe(15)
  expect(await val(page, 'A3')).toBe('Paper')
  expect(await page.evaluate(() => { const s = window.__kwg.store.getState(); return s.book.styleOf(s.book.wb.active, 0, 0).bold })).toBe(true)
})

test('opens CSV files, working out numbers and dates', async ({ page }, info) => {
  const fs = await import('node:fs')
  fs.mkdirSync(info.outputDir, { recursive: true })
  const csv = info.outputPath('data.csv')
  fs.writeFileSync(csv, 'name,qty,when\n"Smith, J",3,2026-03-14\nLee,1.5,3/15/2026\n')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles(csv)
  await expect(page.locator('.grid-hit')).toBeVisible()
  expect(await val(page, 'A2')).toBe('Smith, J')
  expect(await val(page, 'B3')).toBe(1.5)
  expect(await shown(page, 'C2')).toBe('2026-03-14')
})

test('undo and redo', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, 'one'); await typeAt(page, 0, 0, 'two')
  await page.keyboard.press('Control+z')
  expect(await val(page, 'A1')).toBe('one')
  await page.keyboard.press('Control+y')
  expect(await val(page, 'A1')).toBe('two')
})

test('dynamic array formulas fill the cells next to them', async ({ page }) => {
  await blank(page)
  await typeAt(page, 0, 0, '=SEQUENCE(3,2)')
  expect([await val(page, 'A1'), await val(page, 'B1'), await val(page, 'A3'), await val(page, 'B3')]).toEqual([1, 2, 5, 6])
  await typeAt(page, 3, 0, '=SORT({3;1;2})')
  expect([await val(page, 'D1'), await val(page, 'D2'), await val(page, 'D3')]).toEqual([1, 2, 3])
})

test('typing a formula shows function suggestions and the arguments', async ({ page }) => {
  await blank(page)
  await click(page, 0, 0)
  await page.keyboard.type('=VLO')
  await expect(page.getByRole('option', { name: /VLOOKUP/ })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Cell editor')).toHaveValue('=VLOOKUP(')
  await expect(page.locator('.fn-hint code')).toContainText('VLOOKUP(lookup, table, column')
})

test('the privacy dialog turns the anonymous launch counter on and off', async ({ page }) => {
  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('button', { name: /Privacy and counters/ }).click()
  const box = page.getByLabel('Count my launches anonymously')
  await expect(box).toBeChecked()
  await box.uncheck()
  expect(await page.evaluate(() => localStorage.getItem('kwiiva.usage'))).toBe('off')
})

test('nothing in the app mentions other products', async ({ page }) => {
  await blank(page)
  await expect(page.locator('body')).not.toContainText(/microsoft|google|excel|\bsheets\b(?! )/i)
})
