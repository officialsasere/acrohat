import { shiftFormula } from '../engine/refactor'
import { compareValues } from '../engine/coerce'
import { MONTHS, DAYS } from '../engine/dates'
import type { Cell, Filter, FilterCol } from '../engine/model'
import { isErr, key, MAX_COLS, type Rect, type Scalar } from '../engine/types'
import { parseInput } from '../engine/input'
import { useStore } from '../store'
import { canWrite } from './edit'
import { currentRegion, dataRect, setSel } from './nav'
import { rectOf } from '../selection'

const st = () => useStore.getState()
const mark = () => useStore.setState((s) => ({ file: { ...s.file, dirty: true } }))

// ---------------------------------------------------------------- fill
interface Series { next(k: number): Cell }
/** Works out how to continue a run of cells (a column or a row of the source). */
function seriesOf(cells: (Cell | undefined)[], values: Scalar[], fmtDate: boolean, back: boolean): Series {
  const n = cells.length
  const copy = (k: number): Cell => { const src = cells[((k % n) + n) % n]; return { v: src?.v ?? null, f: src?.f, s: src?.s ?? 0 } }
  const nums = values.every((v, i) => typeof v === 'number' && !cells[i]?.f)
  const sign = back ? -1 : 1
  if (nums && n >= 2) {
    // Linear trend through the selected numbers.
    const xs = values.map((_, i) => i), ys = values as number[]
    const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n
    const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0)
    const icpt = my - slope * mx
    return { next: (k) => ({ v: Math.round((icpt + slope * (back ? -1 - k : n + k)) * 1e10) / 1e10, s: cells[0]?.s ?? 0 }) }
  }
  if (nums && n === 1) {
    const inc = fmtDate ? 1 : 0
    return { next: (k) => ({ v: (values[0] as number) + inc * sign * (k + 1), s: cells[0]?.s ?? 0 }) }
  }
  if (values.every((v) => typeof v === 'string') && values.length) {
    const strs = values as string[]
    // month and day names, in full or abbreviated
    const lists = [MONTHS, DAYS, MONTHS.map((m) => m.slice(0, 3)), DAYS.map((d) => d.slice(0, 3))]
    for (const list of lists) {
      const lower = list.map((x) => x.toLowerCase())
      const idx = strs.map((x) => lower.indexOf(x.toLowerCase()))
      if (idx.every((i) => i >= 0)) {
        const step = n >= 2 ? idx[1] - idx[0] : 1
        const upper = strs[0] === strs[0].toUpperCase() && strs[0].length > 1, cap = /^[A-Z]/.test(strs[0])
        const name = (i: number) => { const t = list[((i % list.length) + list.length) % list.length]; return upper ? t.toUpperCase() : cap ? t : t.toLowerCase() }
        return { next: (k) => ({ v: name(back ? idx[0] + step * (-1 - k) : idx[n - 1] + step * (k + 1)), s: cells[0]?.s ?? 0 }) }
      }
    }
    // text with a number at the end: Item 1, Item 2...
    const m = strs.map((s) => /^(.*?)(\d+)$/.exec(s))
    if (m.every(Boolean) && m.every((x) => x![1] === m[0]![1])) {
      const nn = m.map((x) => parseInt(x![2], 10)), step = n >= 2 ? nn[1] - nn[0] : 1, width = m[0]![2].length
      const last = back ? nn[0] : nn[n - 1]
      return { next: (k) => ({ v: m[0]![1] + String(Math.max(0, last + step * sign * (k + 1))).padStart(width, '0'), s: cells[0]?.s ?? 0 }) }
    }
  }
  return { next: copy }
}

/** Fills the cells of `target` (next to `src`) the way dragging the fill handle does. */
export function fill(src: Rect, target: Rect) {
  const s = st(), book = s.book, sh = book.activeSheet
  if (!canWrite([target])) return
  const vertical = target.c1 === src.c1 && target.c2 === src.c2
  const horizontal = target.r1 === src.r1 && target.r2 === src.r2
  if (!vertical && !horizontal) return
  book.transaction('Fill', () => {
    const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1
    for (let li = 0; li < lines; li++) {
      const cells: (Cell | undefined)[] = [], values: Scalar[] = []
      const n = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1
      for (let i = 0; i < n; i++) {
        const r = vertical ? src.r1 + i : src.r1 + li, c = vertical ? src.c1 + li : src.c1 + i
        cells.push(book.getCell(sh.id, r, c)); values.push(book.value(sh.id, r, c))
      }
      const back = vertical ? target.r2 < src.r1 : target.c2 < src.c1
      const fmt = book.styles.get(cells[0]?.s ?? 0).fmt ?? ''
      const series = seriesOf(cells, values, /[dmy]/i.test(fmt.replace(/\[.*?\]|"[^"]*"/g, '')) && !!fmt, back)
      const count = vertical ? target.r2 - target.r1 + 1 : target.c2 - target.c1 + 1
      for (let k = 0; k < count; k++) {
        // The cell nearest the source is filled first, whichever way the fill goes.
        const r = vertical ? (back ? src.r1 - (k + 1) : src.r2 + (k + 1)) : src.r1 + li
        const c = vertical ? src.c1 + li : back ? src.c1 - (k + 1) : src.c2 + (k + 1)
        const cellK = series.next(k)
        const rel = vertical ? r - src.r1 : c - src.c1
        const srcCell = cells[((rel % n) + n) % n]
        if (srcCell?.f) {
          const sr = vertical ? src.r1 + (((rel % n) + n) % n) : src.r1 + li, sc = vertical ? src.c1 + li : src.c1 + (((rel % n) + n) % n)
          book.setCellRaw(sh.id, r, c, { v: null, f: shiftFormula(srcCell.f, r - sr, c - sc), s: srcCell.s })
        } else book.setCellRaw(sh.id, r, c, cellK.v === null && !cellK.f && !cellK.s ? undefined : { ...cellK })
      }
    }
  })
  mark()
}

export function fillDown() {
  const g = st().sel.ranges[st().sel.ranges.length - 1]
  if (g.r1 === g.r2) { if (g.r1 === 0) return; fillCopy({ ...g, r1: g.r1 - 1, r2: g.r1 - 1 }, g); return }
  fillCopy({ ...g, r2: g.r1 }, { ...g, r1: g.r1 + 1 })
}
export function fillRight() {
  const g = st().sel.ranges[st().sel.ranges.length - 1]
  if (g.c1 === g.c2) { if (g.c1 === 0) return; fillCopy({ ...g, c1: g.c1 - 1, c2: g.c1 - 1 }, g); return }
  fillCopy({ ...g, c2: g.c1 }, { ...g, c1: g.c1 + 1 })
}
/** Copies the source cells over the target (formulas shift), repeating as needed: Ctrl+D and Ctrl+R. */
function fillCopy(src: Rect, target: Rect) {
  const book = st().book, sh = book.activeSheet
  if (!canWrite([target])) return
  const block = book.readBlock(sh.id, src)
  book.transaction('Fill', () => {
    for (let r = target.r1; r <= target.r2; r++) for (let c = target.c1; c <= target.c2; c++) {
      const sr = src.r1 + ((r - target.r1) % (src.r2 - src.r1 + 1)), sc = src.c1 + ((c - target.c1) % (src.c2 - src.c1 + 1))
      const cell = block[sr - src.r1][sc - src.c1]
      if (cell?.f) book.setCellRaw(sh.id, r, c, { ...cell, f: shiftFormula(cell.f, r - sr, c - sc), v: null })
      else book.setCellRaw(sh.id, r, c, cell ? { ...cell } : undefined)
    }
  })
  mark()
}

// ---------------------------------------------------------------- sorting
export interface SortKey { col: number; asc: boolean }
function compareForSort(a: Scalar, b: Scalar): number {
  const empty = (x: Scalar) => x === null || x === ''
  if (empty(a) && empty(b)) return 0
  if (empty(a)) return 2
  if (empty(b)) return -2
  const ea = isErr(a), eb = isErr(b)
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1
  return compareValues(a, b)
}

export function sortRange(range: Rect, keys: SortKey[], header: boolean) {
  const s = st(), book = s.book, sh = book.activeSheet
  if (!canWrite([range])) return
  const g = dataRect(range)
  const r0 = header ? g.r1 + 1 : g.r1
  if (r0 >= g.r2 && r0 > g.r1) return
  if (sh.merges.some((m) => !(m.r2 < g.r1 || m.r1 > g.r2 || m.c2 < g.c1 || m.c1 > g.c2))) return void s.toast('error', 'Sorting does not work with merged cells in the range.')
  const rows: { r: number; cells: (Cell | undefined)[]; vals: Scalar[] }[] = []
  for (let r = r0; r <= g.r2; r++) {
    const cells: (Cell | undefined)[] = [], vals: Scalar[] = []
    for (let c = g.c1; c <= g.c2; c++) { cells.push(book.getCell(sh.id, r, c)); vals.push(book.value(sh.id, r, c)) }
    rows.push({ r, cells, vals })
  }
  const order = rows.map((x, i) => ({ x, i })).sort((p, q) => {
    for (const k of keys) {
      const j = k.col - g.c1
      if (j < 0 || j >= p.x.vals.length) continue
      let d = compareForSort(p.x.vals[j], q.x.vals[j])
      if (Math.abs(d) === 2) d = d / 2 // blanks are last whichever way it sorts
      else if (!k.asc) d = -d
      if (d) return d
    }
    return p.i - q.i
  }).map((o) => o.x)
  book.transaction('Sort', () => {
    order.forEach((row, i) => {
      const r = r0 + i
      row.cells.forEach((cell, j) => {
        const c = g.c1 + j
        book.setCellRaw(sh.id, r, c, cell ? { ...cell, f: cell.f ? shiftFormula(cell.f, r - row.r, 0) : undefined } : undefined)
      })
    })
  })
  mark()
}

export function sortSelection(asc: boolean) {
  const s = st()
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const reg = g.r1 === g.r2 && g.c1 === g.c2 ? currentRegion(s.sel.r, s.sel.c) : g
  // Treat the first row as a header when it looks like one: text where the rows below are numbers.
  const book = s.book, sh = book.activeSheet
  const first = book.value(sh.id, reg.r1, s.sel.c), second = book.value(sh.id, Math.min(reg.r1 + 1, reg.r2), s.sel.c)
  const header = typeof first === 'string' && typeof second !== 'string'
  sortRange(reg, [{ col: s.sel.c, asc }], header)
}

// ---------------------------------------------------------------- filter
export function toggleFilter() {
  const s = st(), book = s.book, sh = book.activeSheet
  if (sh.filter) { book.transaction('Remove filter', () => book.prop(sh, 'filter', undefined)); mark(); return }
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const range = g.r1 === g.r2 && g.c1 === g.c2 ? currentRegion(s.sel.r, s.sel.c) : dataRect(g)
  book.transaction('Add filter', () => book.prop(sh, 'filter', { range, cols: {} }))
  mark()
}
export function setFilterCol(col: number, spec: FilterCol | undefined) {
  const book = st().book, sh = book.activeSheet
  if (!sh.filter) return
  const cols = { ...sh.filter.cols }
  if (spec && (spec.hide?.length || spec.cond)) cols[col] = spec; else delete cols[col]
  book.transaction('Filter', () => book.prop(sh, 'filter', { ...sh.filter!, cols } as Filter))
  mark()
}
/** Values in a column of the filter range, for the checklist. */
export function filterValues(col: number): { text: string; count: number }[] {
  const book = st().book, sh = book.activeSheet
  if (!sh.filter) return []
  const m = new Map<string, number>()
  for (let r = sh.filter.range.r1 + 1; r <= sh.filter.range.r2; r++) {
    const t = book.display(sh.id, r, col).text
    m.set(t, (m.get(t) ?? 0) + 1)
  }
  return [...m.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true }))
}

// ---------------------------------------------------------------- find and replace
export interface FindOpts { matchCase: boolean; whole: boolean; regex: boolean; formulas: boolean; allSheets: boolean; inSelection?: boolean }
export interface FindHit { sheet: number; r: number; c: number }

export function findAll(q: string, o: FindOpts): FindHit[] {
  const s = st(), book = s.book
  if (!q) return []
  let re: RegExp | null = null
  if (o.regex) { try { re = new RegExp(q, o.matchCase ? '' : 'i') } catch { return [] } }
  const needle = o.matchCase ? q : q.toLowerCase()
  const out: FindHit[] = []
  const sheets = o.allSheets ? book.wb.sheets : [book.activeSheet]
  const sel = s.sel.ranges[s.sel.ranges.length - 1]
  const limit = sel.r1 !== sel.r2 || sel.c1 !== sel.c2
  for (const sh of sheets) {
    const cells = [...sh.cells.entries()].map(([k, cell]) => [Math.floor(k / MAX_COLS), k % MAX_COLS, cell] as const)
    // spill results are searchable too
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    for (const [r, c, cell] of cells) {
      if (o.inSelection && limit && sh.id === book.activeSheet.id && !(r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2)) continue
      const text = o.formulas && cell.f ? cell.f : book.display(sh.id, r, c).text
      if (!text) continue
      const hay = o.matchCase ? text : text.toLowerCase()
      const ok = re ? re.test(text) && (!o.whole || (re.exec(text)?.[0] === text)) : o.whole ? hay === needle : hay.includes(needle)
      if (ok) out.push({ sheet: sh.id, r, c })
    }
  }
  return out
}
export function replaceAt(h: FindHit, q: string, rep: string, o: FindOpts): boolean {
  const book = st().book
  const cell = book.getCell(h.sheet, h.r, h.c)
  if (!cell) return false
  const sh = book.sheet(h.sheet)
  if (sh.protected) return false
  const text = o.formulas && cell.f ? cell.f : book.display(h.sheet, h.r, h.c).text
  let re: RegExp
  try { re = o.regex ? new RegExp(q, o.matchCase ? 'g' : 'gi') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.matchCase ? 'g' : 'gi') } catch { return false }
  const next = o.whole ? rep : text.replace(re, rep)
  if (next === text) return false
  book.setInput(h.sheet, h.r, h.c, next)
  return true
}
export function replaceAll(q: string, rep: string, o: FindOpts): number {
  const book = st().book
  const hits = findAll(q, o)
  let n = 0
  book.transaction('Replace all', () => { for (const h of hits) if (replaceAt(h, q, rep, o)) n++ })
  if (n) mark()
  return n
}

// ---------------------------------------------------------------- cleaning
export function removeDuplicates(range: Rect, cols: number[], header: boolean) {
  const s = st(), book = s.book, sh = book.activeSheet
  if (!canWrite([range])) return 0
  const g = dataRect(range)
  const r0 = header ? g.r1 + 1 : g.r1
  const seen = new Set<string>()
  const keep: { cells: (Cell | undefined)[]; r: number }[] = []
  let removed = 0
  for (let r = r0; r <= g.r2; r++) {
    const k = cols.map((c) => { const v = book.value(sh.id, r, c); return typeof v === 'string' ? v.toLowerCase() : String(v) }).join('\u0001')
    const cells = []
    for (let c = g.c1; c <= g.c2; c++) cells.push(book.getCell(sh.id, r, c))
    if (seen.has(k)) { removed++; continue }
    seen.add(k)
    keep.push({ cells, r })
  }
  if (!removed) return 0
  book.transaction('Remove duplicates', () => {
    for (let r = r0; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) book.setCellRaw(sh.id, r, c, undefined)
    keep.forEach((row, i) => row.cells.forEach((cell, j) => { if (cell) book.setCellRaw(sh.id, r0 + i, g.c1 + j, cell.f ? { ...cell, f: shiftFormula(cell.f, r0 + i - row.r, 0) } : cell) }))
  })
  mark()
  return removed
}

export function transformText(f: (t: string) => string) {
  const s = st(), book = s.book, sh = book.activeSheet
  if (!canWrite(s.sel.ranges)) return
  book.transaction('Clean text', () => {
    for (const g0 of s.sel.ranges) {
      const g = dataRect(g0)
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const cell = book.getCell(sh.id, r, c)
        if (cell && !cell.f && typeof cell.v === 'string') { const n = f(cell.v); if (n !== cell.v) book.patchCell(sh.id, r, c, { v: n }) }
      }
    }
  })
  mark()
}
export const trimSpaces = () => transformText((t) => t.replace(/\s+/g, ' ').trim())

export function textToColumns(delim: string | RegExp) {
  const s = st(), book = s.book, sh = book.activeSheet
  const g = dataRect(s.sel.ranges[s.sel.ranges.length - 1])
  if (g.c1 !== g.c2) return void s.toast('error', 'Select a single column of text first.')
  if (!canWrite([{ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c1 + 10 }])) return
  book.transaction('Split text', () => {
    for (let r = g.r1; r <= g.r2; r++) {
      const v = book.value(sh.id, r, g.c1)
      if (typeof v !== 'string') continue
      v.split(delim).forEach((part, j) => { if (g.c1 + j < MAX_COLS) { const p = parseInput(part.trim()); book.setInput(sh.id, r, g.c1 + j, p.formula ? "'" + part : part.trim()) } })
    }
  })
  mark()
}
export { key, rectOf, setSel }
