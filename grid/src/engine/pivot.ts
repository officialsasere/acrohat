import type { Book } from './book'
import { toText } from './coerce'
import { compareValues } from './coerce'
import { isErr, type Rect, type Scalar } from './types'

export type Agg = 'sum' | 'count' | 'counta' | 'average' | 'min' | 'max' | 'product' | 'stdev' | 'median'
export interface PivotSpec {
  /** Source range including the header row. */
  source: Rect
  rows: number[]
  cols: number[]
  values: { col: number; agg: Agg; label?: string }[]
  totals: boolean
  filterEmpty: boolean
}

const AGG_LABEL: Record<Agg, string> = { sum: 'SUM', count: 'COUNT', counta: 'COUNTA', average: 'AVERAGE', min: 'MIN', max: 'MAX', product: 'PRODUCT', stdev: 'STDEV', median: 'MEDIAN' }

function aggregate(vals: Scalar[], agg: Agg): Scalar {
  const nums = vals.filter((v): v is number => typeof v === 'number')
  switch (agg) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'count': return nums.length
    case 'counta': return vals.filter((v) => v !== null && v !== '').length
    case 'average': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    case 'min': return nums.length ? Math.min(...nums) : null
    case 'max': return nums.length ? Math.max(...nums) : null
    case 'product': return nums.length ? nums.reduce((a, b) => a * b, 1) : null
    case 'median': { const s = [...nums].sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }
    case 'stdev': { if (nums.length < 2) return null; const m = nums.reduce((a, b) => a + b, 0) / nums.length; return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1)) }
  }
}

/** Builds a pivot table as a grid of values with a header. */
export function buildPivot(book: Book, sheet: number, spec: PivotSpec): { grid: Scalar[][]; headerRows: number; headerCols: number } {
  const { source: s } = spec
  const names = Array.from({ length: s.c2 - s.c1 + 1 }, (_, j) => toText(book.value(sheet, s.r1, s.c1 + j)) || `Column ${j + 1}`)
  const records: Scalar[][] = []
  for (let r = s.r1 + 1; r <= s.r2; r++) {
    const row = Array.from({ length: s.c2 - s.c1 + 1 }, (_, j) => book.value(sheet, r, s.c1 + j))
    if (spec.filterEmpty && row.every((v) => v === null || v === '')) continue
    records.push(row)
  }
  const key = (row: Scalar[], cols: number[]) => cols.map((c) => { const v = row[c - s.c1]; return v === null || v === '' ? '(blank)' : isErr(v) ? v.code : String(v) })
  const uniq = (cols: number[]) => {
    const m = new Map<string, Scalar[]>()
    for (const row of records) { const k = key(row, cols); m.set(k.join('\u0001'), cols.map((c) => row[c - s.c1])) }
    return [...m.entries()].sort((a, b) => { for (let i = 0; i < cols.length; i++) { const d = compareValues(a[1][i], b[1][i]); if (d) return d } return 0 }).map(([k, v]) => ({ k, v }))
  }
  const rowKeys = uniq(spec.rows), colKeys = uniq(spec.cols)
  const cell = (rk: string | null, ck: string | null, vi: number) => {
    const vals = records.filter((row) => (rk === null || key(row, spec.rows).join('\u0001') === rk) && (ck === null || key(row, spec.cols).join('\u0001') === ck)).map((row) => row[spec.values[vi].col - s.c1])
    return vals.length ? aggregate(vals, spec.values[vi].agg) : null
  }
  const nv = Math.max(1, spec.values.length)
  const hdrCols = Math.max(1, spec.rows.length)
  const hdrRows = (spec.cols.length ? 1 : 0) + (spec.cols.length && spec.values.length > 1 ? 1 : 0) + (!spec.cols.length ? 1 : 0)
  const grid: Scalar[][] = []
  const colLabel = (i: number) => (spec.cols.length ? colKeys[i].v.map((x) => toText(x) || '(blank)').join(' / ') : '')
  const vlabel = (vi: number) => spec.values[vi].label ?? `${AGG_LABEL[spec.values[vi].agg]} of ${names[spec.values[vi].col - s.c1]}`
  const columns: { ck: string | null; label: string; vi: number }[] = []
  if (spec.cols.length) { colKeys.forEach((c, i) => spec.values.forEach((_, vi) => columns.push({ ck: c.k, label: colLabel(i), vi }))); if (spec.totals) spec.values.forEach((_, vi) => columns.push({ ck: null, label: 'Grand total', vi })) }
  else spec.values.forEach((_, vi) => columns.push({ ck: null, label: vlabel(vi), vi }))
  // header
  if (spec.cols.length) {
    grid.push([...spec.rows.map((c, i) => (i === 0 ? names[c - s.c1] : names[c - s.c1])), ...columns.map((c) => c.label)])
    if (spec.values.length > 1) grid.push([...spec.rows.map(() => ''), ...columns.map((c) => vlabel(c.vi))])
  } else grid.push([...spec.rows.map((c) => names[c - s.c1]), ...columns.map((c) => c.label)])
  if (!spec.rows.length) grid.forEach((r) => r.unshift(''))
  const rowsOut = spec.rows.length ? rowKeys : [{ k: '', v: [''] as Scalar[] }]
  for (const rk of rowsOut) grid.push([...(spec.rows.length ? rk.v.map((x) => (x === null || x === '' ? '(blank)' : x)) : ['Total']), ...columns.map((c) => cell(spec.rows.length ? rk.k : null, c.ck, c.vi))])
  if (spec.totals && spec.rows.length) grid.push(['Grand total', ...Array(Math.max(0, spec.rows.length - 1)).fill(''), ...columns.map((c) => cell(null, c.ck, c.vi))])
  void nv
  return { grid, headerRows: grid.length - rowsOut.length - (spec.totals && spec.rows.length ? 1 : 0), headerCols: hdrCols }
  void hdrRows
}
