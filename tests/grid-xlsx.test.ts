import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { Book } from '../grid/src/engine/book'
import { newWorkbook } from '../grid/src/engine/model'
import { readXlsx } from '../grid/src/formats/xlsxRead'
import { writeXlsx } from '../grid/src/formats/xlsxWrite'
import { readCsv, writeCsv } from '../grid/src/formats/csv'
import { key } from '../grid/src/engine/types'

function sample(): Book {
  const b = new Book(newWorkbook('Budget'))
  const s1 = b.wb.sheets[0]
  const set = (r: number, c: number, t: string) => b.setInput(s1.id, r, c, t)
  b.load(() => {
    set(0, 0, 'Item'); set(0, 1, 'Qty'); set(0, 2, 'Price'); set(0, 3, 'Total')
    set(1, 0, 'Pens'); set(1, 1, '10'); set(1, 2, '$1.50'); set(1, 3, '=B2*C2')
    set(2, 0, 'Paper'); set(2, 1, '3'); set(2, 2, '$4.25'); set(2, 3, '=B3*C3')
    set(3, 0, 'Sum'); set(3, 3, '=SUM(D2:D3)')
    set(5, 0, '3/14/2026'); set(5, 1, '=A6+30'); set(5, 2, 'TRUE'); set(5, 3, '=SEQUENCE(2)')
    set(7, 0, '=IFS(B2>5,"many",TRUE,"few")'); set(7, 1, '=XLOOKUP("Paper",A2:A3,B2:B3)')
  })
  b.setStyle(s1.id, [{ r1: 0, c1: 0, r2: 0, c2: 3 }], { bold: true, bg: '#f4cccc', color: '#990000' })
  b.setStyle(s1.id, [{ r1: 1, c1: 2, r2: 3, c2: 3 }], { fmt: '$#,##0.00', h: 'right' })
  b.setStyle(s1.id, [{ r1: 3, c1: 0, r2: 3, c2: 3 }], { bt: { style: 'thin', color: '#000000' } })
  b.transaction('x', () => {
    b.prop(s1, 'merges', [{ r1: 9, c1: 0, r2: 9, c2: 2 }])
    b.prop(s1, 'frozenRows', 1)
    b.mapSet(s1.colW, 0, 180)
    b.mapSet(s1.rowH, 0, 36)
    b.setAdd(s1.hiddenCols, 5, true)
    b.prop(s1, 'tabColor', '#8a5a36')
    b.prop(s1, 'cf', [{ id: 'a', ranges: [{ r1: 1, c1: 1, r2: 2, c2: 1 }], type: 'cell', op: '>', v1: '5', style: { bg: '#d9ead3' } }, { id: 'b', ranges: [{ r1: 1, c1: 3, r2: 2, c2: 3 }], type: 'scale', scale: { min: { type: 'min', color: '#ffffff' }, max: { type: 'max', color: '#ff0000' } } }])
    b.prop(s1, 'validations', [{ id: 'v', ranges: [{ r1: 1, c1: 0, r2: 5, c2: 0 }], type: 'list', list: ['Pens', 'Paper', 'Ink'], allowBlank: true, dropdown: true }])
    b.prop(s1, 'charts', [{ id: 'c1', kind: 'column', range: 'Sheet1!A1:B3', headerRow: true, headerCol: true, byRows: false, title: 'Qty', xTitle: '', yTitle: '', legend: 'right', stacked: false, percent: false, smooth: false, points: false, gridlines: true, x: 300, y: 40, w: 400, h: 260 }])
  })
  b.patchCell(s1.id, 1, 0, { link: 'https://example.org/pens', note: 'Bought in bulk' })
  const s2 = b.addSheet('Notes')
  b.setInput(s2.id, 0, 0, "='Sheet1'!D4*2")
  b.wb.names.push({ name: 'Rate', ref: 'Sheet1!$C$2' })
  b.setInput(b.wb.sheets[0].id, 9, 5, '=Rate*2')
  b.setActive(s1.id)
  b.recalc(true)
  return b
}

describe('xlsx files', () => {
  const b = sample()
  const bytes = writeXlsx(b)

  it('can be read by an independent reader, with values, formulas and styles intact', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(bytes as unknown as ArrayBuffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Sheet1', 'Notes'])
    const ws = wb.getWorksheet('Sheet1')!
    expect(ws.getCell('A1').value).toBe('Item')
    expect(ws.getCell('A1').font?.bold).toBe(true)
    expect((ws.getCell('A1').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFF4CCCC')
    expect(ws.getCell('B2').value).toBe(10)
    expect(ws.getCell('D2').value).toMatchObject({ formula: 'B2*C2', result: 15 })
    expect(ws.getCell('D2').numFmt).toBe('$#,##0.00')
    expect(ws.getCell('D4').value).toMatchObject({ formula: 'SUM(D2:D3)' })
    expect(ws.getCell('C6').value).toBe(true)
    expect(ws.getCell('A8').value).toMatchObject({ formula: '_xlfn.IFS(B2>5,"many",TRUE,"few")', result: 'many' })
    expect(ws.getCell('B8').value).toMatchObject({ formula: '_xlfn.XLOOKUP("Paper",A2:A3,B2:B3)', result: 3 })
    expect(ws.getCell('A2').value).toMatchObject({ hyperlink: 'https://example.org/pens' })
    expect(ws.getColumn(1).width).toBeGreaterThan(20)
    expect(ws.getRow(1).height).toBeCloseTo(27, 0)
    expect(ws.getColumn(6).hidden).toBe(true)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.model.merges).toEqual(['A10:C10'])
    expect(ws.getWorksheet).toBeUndefined
    expect(wb.getWorksheet('Notes')!.getCell('A1').value).toMatchObject({ formula: "Sheet1!D4*2", result: 55.5 })
    expect(wb.definedNames.model).toBeTruthy()
  })

  it('round-trips through this app: everything comes back', () => {
    const r = readXlsx(bytes, 'Budget.xlsx')
    const id = r.wb.sheets[0].id
    const v = (row: number, col: number) => r.value(id, row, col)
    expect(r.wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Notes'])
    expect(v(0, 0)).toBe('Item')
    expect(v(1, 3)).toBe(15)
    expect(r.getCell(id, 1, 3)?.f).toBe('=B2*C2')
    expect(v(3, 3)).toBe(27.75)
    expect(v(5, 2)).toBe(true)
    expect(v(5, 3)).toBe(1); expect(v(6, 3)).toBe(2) // the array formula's cells
    expect(r.getCell(id, 7, 0)?.f).toBe('=IFS(B2>5,"many",TRUE,"few")')
    expect(v(7, 0)).toBe('many')
    expect(v(7, 1)).toBe(3)
    expect(r.display(id, 1, 3).text).toBe('$15.00')
    expect(r.display(id, 5, 0).text).toBe('3/14/2026')
    const st = r.styleOf(id, 0, 0)
    expect(st).toMatchObject({ bold: true, bg: '#f4cccc', color: '#990000' })
    expect(r.styleOf(id, 3, 1).bt).toMatchObject({ style: 'thin' })
    const sh = r.wb.sheets[0]
    expect(sh.merges).toEqual([{ r1: 9, c1: 0, r2: 9, c2: 2 }])
    expect(sh.frozenRows).toBe(1)
    expect(sh.colW.get(0)).toBe(180)
    expect(sh.rowH.get(0)).toBe(36)
    expect(sh.hiddenCols.has(5)).toBe(true)
    expect(sh.tabColor).toBe('#8a5a36')
    expect(sh.cf).toHaveLength(2)
    expect(sh.cf[0]).toMatchObject({ type: 'cell', op: '>', v1: '5' })
    expect(sh.validations[0]).toMatchObject({ type: 'list', list: ['Pens', 'Paper', 'Ink'] })
    expect(sh.charts[0]).toMatchObject({ kind: 'column', title: 'Qty' })
    expect(sh.cells.get(key(1, 0))).toMatchObject({ link: 'https://example.org/pens', note: 'Bought in bulk' })
    expect(r.wb.names).toEqual([{ name: 'Rate', ref: 'Sheet1!$C$2', scope: undefined }])
    expect(v(9, 5)).toBe(3)
    expect(r.value(r.wb.sheets[1].id, 0, 0)).toBe(55.5)
    expect(r.wb.title).toBe('Budget')
  })

  it('refuses things that are not spreadsheets', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('csv', () => {
  it('reads quotes, commas inside text, and guesses numbers and dates', () => {
    const b = readCsv('name,qty,when,note\n"Smith, J",3,2026-03-14,"say ""hi"""\nLee,1.5,3/15/2026,\n')
    const id = b.wb.sheets[0].id
    expect(b.value(id, 1, 0)).toBe('Smith, J')
    expect(b.value(id, 1, 1)).toBe(3)
    expect(b.display(id, 1, 2).text).toBe('2026-03-14')
    expect(b.value(id, 1, 3)).toBe('say "hi"')
    expect(b.value(id, 2, 1)).toBe(1.5)
  })
  it('detects semicolons and tabs', () => {
    expect(readCsv('a;b;c\n1;2;3').value(1, 1, 1)).toBe(2)
    expect(readCsv('a\tb\tc\n1\t2\t3').value(1, 1, 2)).toBe(3)
  })
  it('writes what is shown, quoting where needed', () => {
    const b = readCsv('a,b\n"x,y",2\n')
    expect(writeCsv(b)).toBe('a,b\r\n"x,y",2\r\n')
  })
})
