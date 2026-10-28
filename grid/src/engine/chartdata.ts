import type { Book } from './book'
import { parseRange } from './address'
import { toText } from './coerce'
import type { Chart } from './model'
import { formatValue } from './numfmt'
import { isErr, type Rect } from './types'

export interface ChartData {
  categories: string[]
  series: { name: string; values: (number | null)[]; xs?: number[] }[]
}

export function chartRange(book: Book, c: Chart): { sheet: number; rect: Rect } | null {
  const p = parseRange(c.range)
  if (!p) return null
  const sh = p.sheet ? book.sheetByName(p.sheet) : book.activeSheet
  if (!sh) return null
  const u = book.usedRange(sh.id)
  return { sheet: sh.id, rect: { r1: p.r1, c1: p.c1, r2: Math.min(p.r2, Math.max(p.r1, u.rows - 1)), c2: Math.min(p.c2, Math.max(p.c1, u.cols - 1)) } }
}

/** Reads the cells a chart points at and arranges them into categories and series. */
export function readChart(book: Book, c: Chart): ChartData {
  const src = chartRange(book, c)
  if (!src) return { categories: [], series: [] }
  const { sheet, rect } = src
  const rows: unknown[][] = []
  for (let r = rect.r1; r <= rect.r2; r++) { const row: unknown[] = []; for (let k = rect.c1; k <= rect.c2; k++) row.push(book.value(sheet, r, k)); rows.push(row) }
  let grid = rows
  if (c.byRows) grid = grid[0].map((_, j) => grid.map((row) => row[j]))
  const headerRow = c.headerRow && grid.length > 1, headerCol = c.headerCol && grid[0]?.length > 1
  const body = grid.slice(headerRow ? 1 : 0)
  const names = headerRow ? grid[0].slice(headerCol ? 1 : 0).map((x) => toText(x as never)) : []
  const num = (x: unknown) => (typeof x === 'number' ? x : x === null || x === '' || isErr(x as never) ? null : typeof x === 'boolean' ? +x : isNaN(Number(x)) ? null : Number(x))
  const fmt = book.styleOf(sheet, rect.r1 + (headerRow ? 1 : 0), rect.c1).fmt ?? 'General'
  const categories = headerCol ? body.map((row, i) => (typeof row[0] === 'number' && fmt !== 'General' ? formatValue(row[0], book.styleOf(sheet, rect.r1 + i + (headerRow ? 1 : 0), rect.c1).fmt ?? 'General').text : toText(row[0] as never))) : body.map((_, i) => String(i + 1))
  const first = headerCol ? 1 : 0
  const count = (body[0]?.length ?? 0) - first
  const series = Array.from({ length: Math.max(0, count) }, (_, j) => ({
    name: names[j] || `Series ${j + 1}`,
    values: body.map((row) => num(row[j + first])),
    xs: c.kind === 'scatter' && headerCol ? body.map((row) => num(row[0]) ?? 0) : undefined,
  }))
  return { categories, series }
}

/** A guess at a good chart for the cells: whether the first row and column are labels. */
export function guessChart(book: Book, sheet: number, g: Rect): Pick<Chart, 'headerRow' | 'headerCol' | 'byRows'> {
  const v = (r: number, c: number) => book.value(sheet, r, c)
  let headerRow = false, headerCol = false
  if (g.r2 > g.r1) headerRow = [...Array(g.c2 - g.c1 + 1).keys()].every((j) => { const x = v(g.r1, g.c1 + j); return x === null || typeof x === 'string' }) && typeof v(g.r1 + 1, g.c2) === 'number'
  if (g.c2 > g.c1) headerCol = [...Array(g.r2 - g.r1 + 1).keys()].every((i) => { const x = v(g.r1 + i, g.c1); return x === null || typeof x === 'string' || (i === 0 && headerRow) })
  return { headerRow, headerCol, byRows: false }
}
