import { layoutOf } from '../geometry'
import { rectOf, single, type Sel } from '../selection'
import { useStore } from '../store'
import { MAX_COLS, MAX_ROWS, key, type Rect } from '../engine/types'

/** The grid component registers itself so actions can scroll it. */
export interface GridApi {
  scrollTo(r: number, c: number): void
  focus(): void
  viewport(): { r1: number; r2: number; c1: number; c2: number }
}
let api: GridApi | null = null
export const registerGrid = (a: GridApi | null) => { api = a }
export const gridApi = () => api

const st = () => useStore.getState()
const sheetNow = () => st().book.activeSheet

export function setSel(s: Sel, scroll = true) {
  st().select(s)
  if (scroll) api?.scrollTo(s.r, s.c)
}
export function selectCell(r: number, c: number) { setSel(single(clampR(r), clampC(c))) }
const clampR = (r: number) => Math.max(0, Math.min(MAX_ROWS - 1, r))
const clampC = (c: number) => Math.max(0, Math.min(MAX_COLS - 1, c))

export function selectRange(r1: number, c1: number, r2: number, c2: number, keepActive = false) {
  const s = st().sel
  const g = rectOf(r1, c1, r2, c2)
  setSel({ ranges: [g], r: keepActive ? s.r : r1, c: keepActive ? s.c : c1, ar: r1, ac: c1 }, false)
}
export const selectAll = () => { const sh = sheetNow(); setSel({ ranges: [{ r1: 0, c1: 0, r2: sh.rows - 1, c2: sh.cols - 1 }], r: 0, c: 0, ar: 0, ac: 0 }, false) }
export function selectColumns(c1: number, c2: number) { const sh = sheetNow(); setSel({ ranges: [{ r1: 0, c1: Math.min(c1, c2), r2: sh.rows - 1, c2: Math.max(c1, c2) }], r: st().sel.r, c: c1, ar: 0, ac: c1 }, false) }
export function selectRows(r1: number, r2: number) { const sh = sheetNow(); setSel({ ranges: [{ r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: sh.cols - 1 }], r: r1, c: st().sel.c, ar: r1, ac: 0 }, false) }

const empty = (r: number, c: number) => { const v = st().book.value(sheetNow().id, r, c); return v === null || v === '' }

/** Ctrl+Arrow: jump to the edge of a block of data, or to the next block. */
export function edge(r: number, c: number, dr: number, dc: number): [number, number] {
  const sh = sheetNow()
  const maxR = Math.max(sh.rows, st().book.usedRange(sh.id).rows) - 1, maxC = Math.max(sh.cols, st().book.usedRange(sh.id).cols) - 1
  const inb = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr <= maxR && cc <= maxC
  let rr = r + dr, cc = c + dc
  if (!inb(rr, cc)) return [r, c]
  if (!empty(r, c) && !empty(rr, cc)) {
    while (inb(rr + dr, cc + dc) && !empty(rr + dr, cc + dc)) { rr += dr; cc += dc }
    return [rr, cc]
  }
  while (inb(rr, cc) && empty(rr, cc)) { rr += dr; cc += dc }
  if (!inb(rr, cc)) { rr = Math.max(0, Math.min(maxR, rr - dr)); cc = Math.max(0, Math.min(maxC, cc - dc)) }
  return [rr, cc]
}

/** Moves the cursor, skipping hidden rows and columns and stepping over merged cells. */
export function move(dr: number, dc: number, o: { extend?: boolean; jump?: boolean } = {}) {
  const book = st().book, sh = book.activeSheet, s = st().sel
  const L = layoutOf(book, sh)
  // With a range selected and "extend", the moving corner is the one opposite the anchor.
  const g = s.ranges[s.ranges.length - 1]
  let r = o.extend ? (s.ar === g.r1 ? g.r2 : g.r1) : s.r
  let c = o.extend ? (s.ac === g.c1 ? g.c2 : g.c1) : s.c
  if (!o.extend) {
    const m = sh.merges.length ? L.merges.at(r, c) : undefined
    if (m) { if (dr > 0) r = m.r2; if (dc > 0) c = m.c2; if (dr < 0) r = m.r1; if (dc < 0) c = m.c1 }
  }
  if (o.jump) [r, c] = edge(r, c, dr, dc)
  else {
    r = clampR(r + dr); c = clampC(c + dc)
    while (r > 0 && r < sh.rows && L.rows.size(r) === 0) r += dr || 1
    while (c > 0 && c < sh.cols && L.cols.size(c) === 0) c += dc || 1
    r = clampR(r); c = clampC(c)
  }
  if (o.extend) {
    const ng = rectOf(s.ar, s.ac, r, c)
    const ranges = [...s.ranges.slice(0, -1), ng]
    setSel({ ...s, ranges }, false)
    api?.scrollTo(r, c)
  } else {
    setSel(single(r, c))
  }
}

export function pageMove(dir: 1 | -1, extend = false) {
  const v = api?.viewport()
  const n = v ? Math.max(1, v.r2 - v.r1 - 1) : 20
  move(dir * n, 0, { extend })
}

/** The block of data around a cell: what Ctrl+A selects first. */
export function currentRegion(r: number, c: number): Rect {
  const book = st().book, sh = book.activeSheet
  const has = (rr: number, cc: number) => { if (rr < 0 || cc < 0) return false; const v = book.value(sh.id, rr, cc); return v !== null && v !== '' }
  if (!has(r, c)) {
    let found = false
    for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) if (has(r + dr, c + dc)) { r += dr; c += dc; found = true; break }
    if (!found) return { r1: r, c1: c, r2: r, c2: c }
  }
  let r1 = r, r2 = r, c1 = c, c2 = c, grew = true
  while (grew) {
    grew = false
    const any = (rows: [number, number], cols: [number, number]) => { for (let i = rows[0]; i <= rows[1]; i++) for (let j = cols[0]; j <= cols[1]; j++) if (has(i, j)) return true; return false }
    if (r1 > 0 && any([r1 - 1, r1 - 1], [c1 - 1, c2 + 1])) { r1--; grew = true }
    if (any([r2 + 1, r2 + 1], [c1 - 1, c2 + 1]) && r2 < sh.rows) { r2++; grew = true }
    if (c1 > 0 && any([r1 - 1, r2 + 1], [c1 - 1, c1 - 1])) { c1--; grew = true }
    if (any([r1 - 1, r2 + 1], [c2 + 1, c2 + 1]) && c2 < sh.cols) { c2++; grew = true }
  }
  return { r1: Math.max(0, r1), c1: Math.max(0, c1), r2, c2 }
}

export function selectRegion() {
  const s = st().sel
  const g = s.ranges[s.ranges.length - 1]
  const single1 = g.r1 === g.r2 && g.c1 === g.c2
  const reg = currentRegion(s.r, s.c)
  if (single1 && (reg.r1 !== reg.r2 || reg.c1 !== reg.c2)) setSel({ ranges: [reg], r: s.r, c: s.c, ar: reg.r1, ac: reg.c1 }, false)
  else selectAll()
}

/** Cells that actually hold something, for operations that would otherwise cover a million rows. */
export function dataRect(g: Rect): Rect {
  const book = st().book, sh = book.activeSheet
  const u = book.usedRange(sh.id)
  return { r1: g.r1, c1: g.c1, r2: Math.min(g.r2, Math.max(g.r1, u.rows - 1)), c2: Math.min(g.c2, Math.max(g.c1, u.cols - 1)) }
}
export { key }
