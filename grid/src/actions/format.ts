import { formatValue } from '../engine/numfmt'
import type { Border, BorderStyle, CellStyle } from '../engine/model'
import { key, type Rect } from '../engine/types'
import { useStore } from '../store'
import { canWrite } from './edit'
import { dataRect } from './nav'
import { selectRange } from './nav'

const st = () => useStore.getState()
const mark = () => useStore.setState((s) => ({ file: { ...s.file, dirty: true } }))

export function activeStyle(): CellStyle {
  const s = st()
  return s.book.styleOf(s.book.activeSheet.id, s.sel.r, s.sel.c)
}

export function applyStyle(patch: CellStyle, label = 'Format') {
  const s = st()
  if (!canWrite(s.sel.ranges)) return
  s.book.setStyle(s.book.activeSheet.id, s.sel.ranges.map((g) => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > 200_000 ? { ...g, r2: Math.min(g.r2, 5000), c2: Math.min(g.c2, 200) } : g), patch, label)
  mark()
}

export function toggle(k: 'bold' | 'italic' | 'underline' | 'strike') {
  applyStyle({ [k]: !activeStyle()[k] } as CellStyle, k)
}
export const setColor = (c: string | undefined) => applyStyle({ color: c })
export const setBg = (c: string | undefined) => applyStyle({ bg: c })
export const setFont = (f: string) => applyStyle({ font: f })
export const setSize = (n: number) => applyStyle({ size: n })
export const setH = (h: CellStyle['h'] | undefined) => applyStyle({ h })
export const setV = (v: CellStyle['v']) => applyStyle({ v })
export const setWrap = (w: boolean | 'clip' | 'overflow') => applyStyle({ wrap: w })
export const setFormat = (fmt: string) => applyStyle({ fmt: fmt === 'General' ? undefined : fmt })
export const setRotate = (deg: number) => applyStyle({ rotate: deg || undefined })
export const setIndent = (delta: number) => applyStyle({ indent: Math.max(0, (activeStyle().indent ?? 0) + delta) || undefined })
export function stepSize(delta: number) { const cur = activeStyle().size ?? 11; applyStyle({ size: Math.max(6, Math.min(96, cur + delta)) }) }

/** Adds or removes a decimal place from the number format. */
export function decimals(delta: number) {
  const s = st()
  const fmt = activeStyle().fmt ?? 'General'
  const v = s.book.value(s.book.activeSheet.id, s.sel.r, s.sel.c)
  let base = fmt
  if (fmt === 'General') {
    const shown = typeof v === 'number' ? formatValue(v, 'General').text : ''
    const d = /\.(\d+)/.exec(shown)?.[1].length ?? 0
    base = d ? '0.' + '0'.repeat(d) : '0'
  }
  const m = /^([^;]*?)(\.(0+))?([^0;]*)(;.*)?$/.exec(base)
  if (!m) return
  const cur = m[3]?.length ?? 0
  const next = Math.max(0, Math.min(10, cur + delta))
  if (next === cur) return
  const head = base.replace(/\.0+(?=[^0]*(;|$))/, '')
  const out = next ? head.replace(/0(?=[^0]*(;|$))/, '0.' + '0'.repeat(next)) : head
  setFormat(out)
}
export const percent = () => setFormat(activeStyle().fmt === '0%' ? 'General' : '0%')
export const currency = () => setFormat('$#,##0.00')
export const thousands = () => setFormat('#,##0')

const SIDES = ['bt', 'br', 'bb', 'bl'] as const
type Side = (typeof SIDES)[number]

/** Sets or removes a border on a cell edge, and on the matching edge of the neighbouring cell so the two agree. */
function setEdge(r: number, c: number, side: Side, b: Border | undefined, book = st().book) {
  const sh = book.activeSheet
  const apply = (rr: number, cc: number, sd: Side) => {
    if (rr < 0 || cc < 0) return
    const cell = book.getCell(sh.id, rr, cc)
    const style = { ...book.styles.get(cell?.s ?? 0) }
    if (b) style[sd] = b; else delete style[sd]
    book.patchCell(sh.id, rr, cc, { s: book.styles.intern(style) })
  }
  apply(r, c, side)
  if (side === 'bt') apply(r - 1, c, 'bb')
  if (side === 'bb') apply(r + 1, c, 'bt')
  if (side === 'bl') apply(r, c - 1, 'br')
  if (side === 'br') apply(r, c + 1, 'bl')
}

export type BorderKind = 'all' | 'outer' | 'inner' | 'horizontal' | 'vertical' | 'top' | 'bottom' | 'left' | 'right' | 'none'
export function borders(kind: BorderKind, style: BorderStyle = 'thin', color = '#000000') {
  const s = st()
  if (!canWrite(s.sel.ranges)) return
  const b: Border | undefined = kind === 'none' ? undefined : { style, color }
  s.book.transaction('Borders', () => {
    for (const g0 of s.sel.ranges) {
      const g = dataRectCapped(g0)
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const top = r === g.r1, bottom = r === g.r2, left = c === g.c1, right = c === g.c2
        const set = (side: Side, on: boolean) => { if (on) setEdge(r, c, side, b) }
        if (kind === 'none') { for (const sd of SIDES) setEdge(r, c, sd, undefined); continue }
        if (kind === 'all') for (const sd of SIDES) set(sd, true)
        if (kind === 'outer' || kind === 'top') set('bt', top)
        if (kind === 'outer' || kind === 'bottom') set('bb', bottom)
        if (kind === 'outer' || kind === 'left') set('bl', left)
        if (kind === 'outer' || kind === 'right') set('br', right)
        if (kind === 'inner' || kind === 'horizontal') { set('bt', !top); set('bb', !bottom) }
        if (kind === 'inner' || kind === 'vertical') { set('bl', !left); set('br', !right) }
      }
    }
  })
  mark()
}
const dataRectCapped = (g: Rect): Rect => ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > 100_000 ? { ...dataRect(g), r2: Math.min(g.r2, g.r1 + 3000) } : g)

export function merge(kind: 'all' | 'horizontal' | 'vertical' | 'unmerge') {
  const s = st(), book = s.book, sh = book.activeSheet
  if (!canWrite(s.sel.ranges)) return
  book.transaction('Merge', () => {
    const merges = [...sh.merges]
    const out: Rect[] = []
    const targets: Rect[] = []
    for (const g of s.sel.ranges) {
      if (kind === 'unmerge') { for (const m of merges) if (!(m.r2 < g.r1 || m.r1 > g.r2 || m.c2 < g.c1 || m.c1 > g.c2)) targets.push(m); continue }
      if (kind === 'all') targets.push(g)
      else if (kind === 'horizontal') for (let r = g.r1; r <= g.r2; r++) targets.push({ r1: r, c1: g.c1, r2: r, c2: g.c2 })
      else for (let c = g.c1; c <= g.c2; c++) targets.push({ r1: g.r1, c1: c, r2: g.r2, c2: c })
    }
    const overlaps = (a: Rect, b: Rect) => !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2)
    if (kind === 'unmerge') {
      book.prop(sh, 'merges', merges.filter((m) => !targets.some((t) => t === m)))
      return
    }
    const keep = merges.filter((m) => !targets.some((t) => overlaps(t, m)))
    for (const t of targets) {
      if (t.r1 === t.r2 && t.c1 === t.c2) continue
      out.push(t)
      // Only the top-left value survives, as in other spreadsheets.
      for (let r = t.r1; r <= t.r2; r++) for (let c = t.c1; c <= t.c2; c++) if (r !== t.r1 || c !== t.c1) { const cell = book.getCell(sh.id, r, c); if (cell && (cell.v !== null || cell.f)) book.patchCell(sh.id, r, c, { v: null, f: undefined }) }
    }
    book.prop(sh, 'merges', [...keep, ...out])
  })
  mark()
}

export function formatPainter(on: boolean) {
  const s = st()
  if (!on) return useStore.setState({ painter: null })
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  useStore.setState({ painter: { block: s.book.readBlock(s.book.activeSheet.id, g) } })
}
export function applyPainter() {
  const s = st()
  if (!s.painter) return
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const src = s.painter.block
  const book = s.book, sh = book.activeSheet
  if (!canWrite([g])) return
  book.transaction('Paint format', () => {
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
      const cell = src[(r - g.r1) % src.length]?.[(c - g.c1) % src[0].length]
      book.patchCell(sh.id, r, c, { s: cell?.s ?? 0 })
    }
  })
  useStore.setState({ painter: null })
  mark()
}

export function clearFormats() { const s = st(); if (canWrite(s.sel.ranges)) { s.book.clear(s.book.activeSheet.id, s.sel.ranges.map(dataRect), 'formats'); mark() } }
export { key, selectRange }
