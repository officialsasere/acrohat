import { describe, expect, it, beforeEach } from 'vitest'
import { Book } from '../grid/src/engine/book'
import { CfEvaluator } from '../grid/src/engine/cf'
import { checkInput } from '../grid/src/engine/validation'
import { buildPivot } from '../grid/src/engine/pivot'
import { newWorkbook } from '../grid/src/engine/model'
import { parseA1 } from '../grid/src/engine/address'
import { fill, findAll, removeDuplicates, replaceAll, sortRange } from '../grid/src/actions/data'
import { useStore } from '../grid/src/store'
import { isErr } from '../grid/src/engine/types'

let book: Book
let id: number
const set = (a: string, t: string) => { const p = parseA1(a)!; book.setInput(id, p.row, p.col, t) }
const v = (a: string) => { const p = parseA1(a)!; return book.value(id, p.row, p.col) }
const load = (rows: string[][]) => book.load(() => rows.forEach((row, r) => row.forEach((t, c) => { if (t !== '') book.setInput(id, r, c, t) })))

beforeEach(() => {
  book = new Book(newWorkbook('t'))
  id = book.wb.sheets[0].id
  useStore.setState({ book })
})

describe('sorting', () => {
  it('sorts by several keys, keeps rows together, moves formulas with their rows, and leaves blanks last', () => {
    load([['name', 'team', 'score', 'x2'], ['Ann', 'B', '5', '=C2*2'], ['Bob', 'A', '9', '=C3*2'], ['Cy', 'B', '7', '=C4*2'], ['Di', 'A', '9', '=C5*2'], ['', '', '', '']])
    sortRange({ r1: 0, c1: 0, r2: 4, c2: 3 }, [{ col: 1, asc: true }, { col: 2, asc: false }], true)
    expect(['A2', 'A3', 'A4', 'A5'].map(v)).toEqual(['Bob', 'Di', 'Cy', 'Ann'])
    expect(['D2', 'D3', 'D4', 'D5'].map(v)).toEqual([18, 18, 14, 10])
    expect(book.getCell(id, 3, 3)?.f).toBe('=C4*2')
    book.undo()
    expect(v('A2')).toBe('Ann')
  })
  it('puts numbers before text and empty cells last, in either direction', () => {
    load([['v'], ['b'], ['3'], [''], ['a'], ['1']])
    sortRange({ r1: 0, c1: 0, r2: 5, c2: 0 }, [{ col: 0, asc: true }], true)
    expect(['A2', 'A3', 'A4', 'A5', 'A6'].map(v)).toEqual([1, 3, 'a', 'b', null])
    sortRange({ r1: 0, c1: 0, r2: 5, c2: 0 }, [{ col: 0, asc: false }], true)
    expect(['A2', 'A3', 'A4', 'A5', 'A6'].map(v)).toEqual(['b', 'a', 3, 1, null])
  })
})

describe('filling', () => {
  it('continues number, month and text-with-number patterns, and copies formulas', () => {
    load([['1', 'Jan', 'Item 1', '=A1+1'], ['3', 'Feb', 'Item 2', '']])
    fill({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 2, c1: 0, r2: 4, c2: 0 })
    expect(['A3', 'A4', 'A5'].map(v)).toEqual([5, 7, 9])
    fill({ r1: 0, c1: 1, r2: 1, c2: 1 }, { r1: 2, c1: 1, r2: 4, c2: 1 })
    expect(['B3', 'B4', 'B5'].map(v)).toEqual(['Mar', 'Apr', 'May'])
    fill({ r1: 0, c1: 2, r2: 1, c2: 2 }, { r1: 2, c1: 2, r2: 3, c2: 2 })
    expect(['C3', 'C4'].map(v)).toEqual(['Item 3', 'Item 4'])
    fill({ r1: 0, c1: 3, r2: 0, c2: 3 }, { r1: 1, c1: 3, r2: 2, c2: 3 })
    expect(book.getCell(id, 2, 3)?.f).toBe('=A3+1')
  })
  it('fills upwards too', () => {
    load([[], [], ['5'], ['6']])
    fill({ r1: 2, c1: 0, r2: 3, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 0 })
    expect(['A1', 'A2'].map(v)).toEqual([3, 4])
  })
})

describe('find, replace and duplicates', () => {
  it('finds in values and formulas, with options', () => {
    load([['Cat', 'cat food', '=CONCAT("a","cat")'], ['Dog']])
    const base = { matchCase: false, whole: false, regex: false, formulas: false, allSheets: false }
    expect(findAll('cat', base)).toHaveLength(3)
    expect(findAll('cat', { ...base, matchCase: true })).toHaveLength(2)
    expect(findAll('cat', { ...base, whole: true })).toHaveLength(1)
    expect(findAll('^c', { ...base, regex: true })).toHaveLength(2)
    expect(findAll('CONCAT', { ...base, formulas: true })).toHaveLength(1)
    expect(replaceAll('cat', 'owl', base)).toBe(3)
    expect(v('B1')).toBe('owl food')
  })
  it('removes duplicate rows, keeping the first', () => {
    load([['id', 'n'], ['1', 'a'], ['2', 'b'], ['1', 'c'], ['2', 'b']])
    expect(removeDuplicates({ r1: 0, c1: 0, r2: 4, c2: 1 }, [0], true)).toBe(2)
    expect([v('A2'), v('B2'), v('A3'), v('B3'), v('A4')]).toEqual([1, 'a', 2, 'b', null])
  })
})

describe('conditional formatting and validation', () => {
  it('colours cells by value, duplicates, top values, formulas and scales', () => {
    load([['5'], ['12'], ['12'], ['30']])
    const sh = book.wb.sheets[0]
    const r = [{ r1: 0, c1: 0, r2: 3, c2: 0 }]
    sh.cf = [
      { id: 'a', ranges: r, type: 'cell', op: '>', v1: '10', style: { bg: '#111111' } },
      { id: 'b', ranges: r, type: 'duplicates', style: { color: '#222222' } },
      { id: 'c', ranges: r, type: 'top', op: 'top', n: 1, style: { bold: true } },
      { id: 'd', ranges: r, type: 'formula', formula: '=A1<10', style: { italic: true } },
      { id: 'e', ranges: r, type: 'scale', scale: { min: { type: 'min', color: '#000000' }, max: { type: 'max', color: '#ffffff' } } },
    ]
    const cf = new CfEvaluator(book, sh)
    expect(cf.styleFor(0, 0)?.style).toMatchObject({ italic: true })
    expect(cf.styleFor(0, 0)?.style?.bg).toBeUndefined()
    expect(cf.styleFor(1, 0)?.style).toMatchObject({ bg: '#111111', color: '#222222' })
    expect(cf.styleFor(3, 0)?.style).toMatchObject({ bg: '#111111', bold: true })
    expect(cf.styleFor(0, 0)?.bg).toBe('#000000')
    expect(cf.styleFor(3, 0)?.bg).toBe('#ffffff')
  })
  it('checks what is typed against the rules', () => {
    const sh = book.wb.sheets[0]
    sh.validations = [
      { id: '1', ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], type: 'list', list: ['Red', 'Green'] },
      { id: '2', ranges: [{ r1: 1, c1: 0, r2: 1, c2: 0 }], type: 'integer', op: 'between', v1: '1', v2: '10' },
      { id: '3', ranges: [{ r1: 2, c1: 0, r2: 2, c2: 0 }], type: 'custom', v1: '=LEN(A3)<4' },
      { id: '4', ranges: [{ r1: 3, c1: 0, r2: 3, c2: 0 }], type: 'date', op: '>', v1: '1/1/2026' },
    ]
    expect(checkInput(book, sh, 0, 0, 'green').ok).toBe(true)
    expect(checkInput(book, sh, 0, 0, 'Blue').ok).toBe(false)
    expect(checkInput(book, sh, 1, 0, '7').ok).toBe(true)
    expect(checkInput(book, sh, 1, 0, '11').ok).toBe(false)
    expect(checkInput(book, sh, 1, 0, '2.5').ok).toBe(false)
    expect(checkInput(book, sh, 2, 0, 'abc').ok).toBe(true)
    expect(checkInput(book, sh, 2, 0, 'abcdef').ok).toBe(false)
    expect(checkInput(book, sh, 3, 0, '3/1/2026').ok).toBe(true)
    expect(checkInput(book, sh, 3, 0, '3/1/2025').ok).toBe(false)
    expect(checkInput(book, sh, 5, 5, 'anything').ok).toBe(true)
  })
})

describe('pivot tables', () => {
  it('summarises by rows and columns with totals', () => {
    load([['region', 'product', 'sales'], ['N', 'a', '10'], ['N', 'b', '20'], ['S', 'a', '5'], ['S', 'a', '7'], ['N', 'a', '1']])
    const src = { r1: 0, c1: 0, r2: 5, c2: 2 }
    const one = buildPivot(book, id, { source: src, rows: [0], cols: [], values: [{ col: 2, agg: 'sum' }], totals: true, filterEmpty: true })
    expect(one.grid).toEqual([['region', 'SUM of sales'], ['N', 31], ['S', 12], ['Grand total', 43]])
    const two = buildPivot(book, id, { source: src, rows: [0], cols: [1], values: [{ col: 2, agg: 'sum' }], totals: true, filterEmpty: true })
    expect(two.grid[0]).toEqual(['region', 'a', 'b', 'Grand total'])
    expect(two.grid[1]).toEqual(['N', 11, 20, 31])
    expect(two.grid[2]).toEqual(['S', 12, null, 12])
    const counts = buildPivot(book, id, { source: src, rows: [1], cols: [], values: [{ col: 2, agg: 'count' }, { col: 2, agg: 'average' }], totals: false, filterEmpty: true })
    expect(counts.grid[1]).toEqual(['a', 4, 5.75])
  })
})

describe('large sheets', () => {
  it('handles tens of thousands of cells and formulas quickly', () => {
    const t0 = Date.now()
    book.load(() => { for (let r = 0; r < 20000; r++) { book.setInput(id, r, 0, String(r)); book.setInput(id, r, 1, `=A${r + 1}*2`) } book.setInput(id, 0, 3, '=SUM(B1:B20000)') })
    expect(v('D1')).toBe(2 * (19999 * 20000) / 2)
    const t1 = Date.now()
    book.setInput(id, 0, 0, '1000000')
    expect(v('D1')).toBe(2 * (19999 * 20000) / 2 + 2 * 1000000)
    expect(Date.now() - t1).toBeLessThan(1500)
    expect(Date.now() - t0).toBeLessThan(8000)
    expect(isErr(v('B2'))).toBe(false)
  })
})
