import { MAX_COLS, MAX_ROWS } from './types'

export function colName(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
export function colIndex(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
export const cellName = (r: number, c: number) => colName(c) + (r + 1)

export interface A1 { row: number; col: number; absRow: boolean; absCol: boolean }

/** Parses "A1", "$B$2". Returns null if it is not a cell address inside the sheet limits. */
export function parseA1(s: string): A1 | null {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(s)
  if (!m) return null
  const col = colIndex(m[2]), row = parseInt(m[4], 10) - 1
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null
  return { row, col, absRow: m[3] === '$', absCol: m[1] === '$' }
}

export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

export interface RangeText { sheet?: string; r1: number; c1: number; r2: number; c2: number }

/** Parses "A1", "A1:B2", "Sheet1!A1:B2", "'My sheet'!A:A", "3:5". */
export function parseRange(s: string): RangeText | null {
  let sheet: string | undefined
  const bang = s.lastIndexOf('!')
  if (bang > 0) {
    sheet = s.slice(0, bang)
    if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'")
    s = s.slice(bang + 1)
  }
  const parts = s.split(':')
  if (parts.length > 2) return null
  const cellA = parseA1(parts[0])
  if (cellA && (parts.length === 1 || parseA1(parts[1]))) {
    const b = parts.length === 2 ? parseA1(parts[1])! : cellA
    return { sheet, r1: Math.min(cellA.row, b.row), c1: Math.min(cellA.col, b.col), r2: Math.max(cellA.row, b.row), c2: Math.max(cellA.col, b.col) }
  }
  const colsM = parts.length === 2 ? [/^\$?([A-Za-z]{1,3})$/.exec(parts[0]), /^\$?([A-Za-z]{1,3})$/.exec(parts[1])] : null
  if (colsM && colsM[0] && colsM[1]) {
    const a = colIndex(colsM[0][1]), b = colIndex(colsM[1][1])
    return { sheet, r1: 0, c1: Math.min(a, b), r2: MAX_ROWS - 1, c2: Math.max(a, b) }
  }
  const rowsM = parts.length === 2 ? [/^\$?(\d{1,7})$/.exec(parts[0]), /^\$?(\d{1,7})$/.exec(parts[1])] : null
  if (rowsM && rowsM[0] && rowsM[1]) {
    const a = parseInt(rowsM[0][1], 10) - 1, b = parseInt(rowsM[1][1], 10) - 1
    return { sheet, r1: Math.min(a, b), c1: 0, r2: Math.max(a, b), c2: MAX_COLS - 1 }
  }
  return null
}

export function rangeText(r: { r1: number; c1: number; r2: number; c2: number }, sheet?: string): string {
  const pre = sheet ? quoteSheet(sheet) + '!' : ''
  if (r.c1 === 0 && r.c2 === MAX_COLS - 1 && !(r.r1 === 0 && r.r2 === MAX_ROWS - 1)) return `${pre}${r.r1 + 1}:${r.r2 + 1}`
  if (r.r1 === 0 && r.r2 === MAX_ROWS - 1) return `${pre}${colName(r.c1)}:${colName(r.c2)}`
  return r.r1 === r.r2 && r.c1 === r.c2 ? pre + cellName(r.r1, r.c1) : `${pre}${cellName(r.r1, r.c1)}:${cellName(r.r2, r.c2)}`
}
