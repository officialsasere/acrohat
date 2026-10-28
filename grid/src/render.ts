import { colName } from './engine/address'
import type { Book } from './engine/book'
import { CfEvaluator, type CfResult } from './engine/cf'
import { SPARK } from './engine/functions/google'
import type { Border, Cell, CellStyle, Sheet } from './engine/model'
import { formatValue, type Formatted } from './engine/numfmt'
import { key, type Rect, type Scalar } from './engine/types'
import { listOptions, validationAt } from './engine/validation'
import { layoutOf, type Layout } from './geometry'
import { inSel, type Sel } from './selection'
import { fontStack } from '../../shared/fonts'

export const HDR_W = 48
export const HDR_H = 24

export interface Palette { bg: string; grid: string; header: string; headerText: string; headerSel: string; headerSelText: string; text: string; accent: string; selFill: string }
export const LIGHT: Palette = { bg: '#ffffff', grid: '#e4dccd', header: '#f3ebdd', headerText: '#6b5a48', headerSel: '#e4cfae', headerSelText: '#3a2416', text: '#1f1a14', accent: '#8a5a36', selFill: 'rgba(138, 90, 54, 0.13)' }
export const DARK: Palette = { bg: '#ffffff', grid: '#d8cfbf', header: '#2a221b', headerText: '#bba992', headerSel: '#5a3f27', headerSelText: '#fff1dc', text: '#1f1a14', accent: '#d4a373', selFill: 'rgba(212, 163, 115, 0.2)' }

export interface Hit { kind: 'filter' | 'dropdown' | 'checkbox' | 'fill' | 'link'; x: number; y: number; w: number; h: number; r: number; c: number }

export interface EditRef { rect: Rect; color: string; sheet: number }
export interface PaintParams {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  book: Book
  sheet: Sheet
  zoom: number
  scrollX: number
  scrollY: number
  sel: Sel
  copy?: Rect | null
  refs?: EditRef[]
  headings: boolean
  pal: Palette
  /** The cell being typed into: its own text is drawn by the editor, not here. */
  editing?: { r: number; c: number } | null
  showFill: boolean
}

const widthCache = new Map<string, number>()
function textWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const k = font + '|' + text
  let w = widthCache.get(k)
  if (w === undefined) {
    ctx.font = font
    w = ctx.measureText(text).width
    if (widthCache.size > 20000) widthCache.clear()
    widthCache.set(k, w)
  }
  return w
}

const displayCache = new WeakMap<Book, { v: number; map: Map<number, Formatted> }>()
export function displayOf(book: Book, sheet: number, r: number, c: number): Formatted {
  let e = displayCache.get(book)
  if (!e || e.v !== book.version) { e = { v: book.version, map: new Map() }; displayCache.set(book, e) }
  const k = sheet * 4e10 + key(r, c)
  let f = e.map.get(k)
  if (!f) { f = book.display(sheet, r, c); e.map.set(k, f) }
  return f
}
const cfCache = new WeakMap<Sheet, CfEvaluator>()
export function cfOf(book: Book, sheet: Sheet): CfEvaluator {
  let e = cfCache.get(sheet)
  if (!e) { e = new CfEvaluator(book, sheet); cfCache.set(sheet, e) }
  return e
}

export const fontOf = (st: CellStyle, zoom: number) =>
  `${st.italic ? 'italic ' : ''}${st.bold ? '700 ' : '400 '}${((st.size ?? 11) * 96 / 72) * zoom}px ${fontStack(st.font ?? 'Calibri')}`

/** Splits text into lines that fit `maxW`, breaking at spaces (and inside very long words). */
export function wrapLines(ctx: CanvasRenderingContext2D, font: string, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (textWidth(ctx, font, para) <= maxW) { out.push(para); continue }
    let line = ''
    for (const word of para.split(/(?<= )/)) {
      const t = line + word
      if (line && textWidth(ctx, font, t.trimEnd()) > maxW) { out.push(line.trimEnd()); line = word } else line = t
      while (textWidth(ctx, font, line) > maxW && line.length > 1) {
        let n = line.length - 1
        while (n > 1 && textWidth(ctx, font, line.slice(0, n)) > maxW) n--
        out.push(line.slice(0, n)); line = line.slice(n)
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

const DASH: Record<string, number[]> = { dashed: [5, 3], dotted: [1.5, 2] }
const BW: Record<string, number> = { thin: 1, medium: 2, thick: 3, dashed: 1, dotted: 1, double: 3 }
function line(ctx: CanvasRenderingContext2D, b: Border, x1: number, y1: number, x2: number, y2: number, zoom: number) {
  ctx.save()
  ctx.strokeStyle = b.color || '#000'
  ctx.lineWidth = Math.max(1, (BW[b.style] ?? 1) * Math.min(zoom, 1.5))
  ctx.setLineDash(DASH[b.style] ?? [])
  const o = ctx.lineWidth % 2 ? 0.5 : 0
  ctx.beginPath(); ctx.moveTo(x1 + (y1 === y2 ? 0 : o), y1 + (y1 === y2 ? o : 0)); ctx.lineTo(x2 + (y1 === y2 ? 0 : o), y2 + (y1 === y2 ? o : 0)); ctx.stroke()
  ctx.restore()
}

function drawSpark(ctx: CanvasRenderingContext2D, spec: { data: (number | null)[]; charttype?: string; color?: string; negcolor?: string; linewidth?: string }, x: number, y: number, w: number, h: number) {
  const nums = spec.data.filter((v): v is number => v !== null)
  if (!nums.length) return
  const lo = Math.min(...nums, spec.charttype === 'column' || spec.charttype === 'winloss' ? 0 : Infinity), hi = Math.max(...nums, spec.charttype === 'column' ? 0 : -Infinity)
  const span = hi - lo || 1
  const pad = 3
  const iw = w - pad * 2, ih = h - pad * 2
  ctx.save()
  ctx.strokeStyle = spec.color ?? '#8a5a36'; ctx.fillStyle = spec.color ?? '#8a5a36'
  ctx.lineWidth = Number(spec.linewidth) || 1.5
  const n = spec.data.length
  if (spec.charttype === 'column' || spec.charttype === 'winloss') {
    const bw = iw / n
    const zero = y + pad + ih - ((0 - lo) / span) * ih
    spec.data.forEach((v, i) => {
      if (v === null) return
      ctx.fillStyle = v < 0 ? spec.negcolor ?? '#c0504d' : spec.color ?? '#8a5a36'
      if (spec.charttype === 'winloss') ctx.fillRect(x + pad + i * bw + 1, v < 0 ? zero : zero - ih / 3, Math.max(1, bw - 2), ih / 3)
      else { const top = y + pad + ih - ((v - lo) / span) * ih; ctx.fillRect(x + pad + i * bw + 1, Math.min(top, zero), Math.max(1, bw - 2), Math.abs(zero - top) || 1) }
    })
  } else {
    ctx.beginPath()
    let started = false
    spec.data.forEach((v, i) => {
      if (v === null) { started = false; return }
      const px = x + pad + (n === 1 ? iw / 2 : (i / (n - 1)) * iw), py = y + pad + ih - ((v - lo) / span) * ih
      if (!started) { ctx.moveTo(px, py); started = true } else ctx.lineTo(px, py)
    })
    ctx.stroke()
  }
  ctx.restore()
}

export function paint(p: PaintParams): { hits: Hit[] } {
  const { ctx, w, h, book, sheet, zoom, scrollX, scrollY, sel, pal } = p
  const L = layoutOf(book, sheet)
  const cf = cfOf(book, sheet)
  const hits: Hit[] = []
  const hw = p.headings ? HDR_W : 0, hh = p.headings ? HDR_H : 0
  const fc = Math.min(sheet.frozenCols, sheet.cols), fr = Math.min(sheet.frozenRows, sheet.rows)
  const fw = L.cols.pos(fc) * zoom, fhh = L.rows.pos(fr) * zoom

  ctx.fillStyle = pal.bg
  ctx.fillRect(0, 0, w, h)

  const idxX = (px: number) => L.cols.indexAt(px / zoom)
  const idxY = (py: number) => L.rows.indexAt(py / zoom)
  const cx = (c: number) => L.cols.pos(c) * zoom
  const cy = (r: number) => L.rows.pos(r) * zoom

  const drawnMerges = new Set<Rect>()
  const pane = (r1: number, r2: number, c1: number, c2: number, mapX: (wx: number) => number, mapY: (wy: number) => number, clip: { x: number; y: number; w: number; h: number }) => {
    if (clip.w <= 0 || clip.h <= 0 || r1 > r2 || c1 > c2) return
    ctx.save()
    ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip()
    // gridlines
    if (sheet.gridlines) {
      ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.beginPath()
      for (let c = c1; c <= c2 + 1; c++) { const x = Math.round(mapX(cx(c))) + 0.5; ctx.moveTo(x, clip.y); ctx.lineTo(x, clip.y + clip.h) }
      for (let r = r1; r <= r2 + 1; r++) { const y = Math.round(mapY(cy(r))) + 0.5; ctx.moveTo(clip.x, y); ctx.lineTo(clip.x + clip.w, y) }
      ctx.stroke()
    }
    const cells: { r: number; c: number; x: number; y: number; w: number; h: number; cell: Cell | undefined; merge?: Rect }[] = []
    const seenMerge = new Set<Rect>()
    for (let r = r1; r <= r2; r++) {
      const rh = L.rows.size(r) * zoom
      if (rh === 0) continue
      for (let c = c1; c <= c2; c++) {
        const cw = L.cols.size(c) * zoom
        if (cw === 0) continue
        const m = sheet.merges.length ? L.merges.at(r, c) : undefined
        if (m && (m.r1 !== r || m.c1 !== c)) {
          // Covered by a merge whose top-left is off screen: draw it once from its own origin.
          if (!seenMerge.has(m) && (m.r1 < r1 || m.c1 < c1)) {
            seenMerge.add(m)
            cells.push({ r: m.r1, c: m.c1, x: mapX(cx(m.c1)), y: mapY(cy(m.r1)), w: (cx(m.c2 + 1) - cx(m.c1)), h: (cy(m.r2 + 1) - cy(m.r1)), cell: sheet.cells.get(key(m.r1, m.c1)), merge: m })
          }
          continue
        }
        const cell = sheet.cells.get(key(r, c))
        const res = cf.has() ? cf.styleFor(r, c) : null
        if (!cell && !m && !res && !(p.refs)) { continue }
        const x = mapX(cx(c)), y = mapY(cy(r))
        if (m) { seenMerge.add(m); cells.push({ r, c, x, y, w: cx(m.c2 + 1) - cx(m.c1), h: cy(m.r2 + 1) - cy(m.r1), cell, merge: m }) }
        else cells.push({ r, c, x, y, w: cw, h: rh, cell })
      }
    }
    // Backgrounds first, so text that overflows is drawn on top of its neighbours.
    for (const k of cells) {
      const st = book.styles.get(k.cell?.s ?? 0)
      const res = cf.has() ? cf.styleFor(k.r, k.c) : null
      const bg = res?.bg ?? res?.style?.bg ?? st.bg
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(Math.floor(k.x), Math.floor(k.y), Math.ceil(k.w) + 1, Math.ceil(k.h) + 1) }
      if (res?.bar) {
        const b = res.bar
        const bx = k.x + 2, bw = k.w - 4
        const zero = (b.zero ?? 0) * bw
        ctx.fillStyle = b.color
        if (b.gradient) { const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, b.color); g.addColorStop(1, b.color + '55'); ctx.fillStyle = g }
        const len = b.frac * bw
        ctx.fillRect(b.negative ? bx + zero - len : bx + zero, k.y + 3, Math.max(1, len), k.h - 6)
      }
    }
    for (const k of cells) drawCell(k)
    // Merged areas hide the gridlines inside them.
    ctx.restore()
    function drawCell(k: (typeof cells)[number]) {
      const st = book.styles.get(k.cell?.s ?? 0)
      const res: CfResult | null = cf.has() ? cf.styleFor(k.r, k.c) : null
      const eff: CellStyle = res?.style ? { ...st, ...res.style, bg: undefined } : st
      const x = k.x, y = k.y, cw = k.w, ch = k.h
      // borders
      if (st.bt) line(ctx, st.bt, x, y, x + cw, y, zoom)
      if (st.bb) line(ctx, st.bb, x, y + ch, x + cw, y + ch, zoom)
      if (st.bl) line(ctx, st.bl, x, y, x, y + ch, zoom)
      if (st.br) line(ctx, st.br, x + cw, y, x + cw, y + ch, zoom)
      if (p.editing && p.editing.r === k.r && p.editing.c === k.c) return
      const f = displayOf(book, sheet.id, k.r, k.c)
      const v = book.value(sheet.id, k.r, k.c)
      const val = validationAt(sheet, k.r, k.c)
      const isCheck = val?.type === 'checkbox'
      if (k.cell?.link || k.cell?.note) {
        if (k.cell.note) { ctx.fillStyle = '#d33'; ctx.beginPath(); ctx.moveTo(x + cw - 1, y + 1); ctx.lineTo(x + cw - 7, y + 1); ctx.lineTo(x + cw - 1, y + 7); ctx.fill() }
      }
      if (isCheck) {
        const checked = String(v).toUpperCase() === String(val!.checked ?? 'TRUE').toUpperCase() || v === true
        const s = Math.min(16 * zoom, ch - 4), bx = x + (cw - s) / 2, by = y + (ch - s) / 2
        ctx.strokeStyle = '#6b5a48'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, s, s)
        if (checked) { ctx.fillStyle = pal.accent; ctx.fillRect(bx, by, s, s); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx + s * 0.2, by + s * 0.55); ctx.lineTo(bx + s * 0.42, by + s * 0.75); ctx.lineTo(bx + s * 0.8, by + s * 0.25); ctx.stroke() }
        hits.push({ kind: 'checkbox', x: bx, y: by, w: s, h: s, r: k.r, c: k.c })
        return
      }
      let text = f.text
      if (!text) return
      if (text.startsWith(SPARK)) {
        try { drawSpark(ctx, JSON.parse(text.slice(SPARK.length)), x, y, cw, ch) } catch { /* bad options */ }
        return
      }
      const font = fontOf(eff, zoom)
      const color = res?.style?.color ?? eff.color ?? f.color ?? (k.cell?.link ? '#0563c1' : pal.text)
      const isNum = typeof v === 'number' && !f.isText
      const align = eff.h ?? (isNum || (typeof v === 'number') ? 'right' : typeof v === 'boolean' || (typeof v === 'object' && v !== null) ? 'center' : 'left')
      const pad = 3 * zoom + (eff.indent ? eff.indent * 9 * zoom : 0)
      ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'
      const size = ((eff.size ?? 11) * 96) / 72 * zoom
      const wrap = eff.wrap === true
      let tw = textWidth(ctx, font, text)
      if (typeof v === 'number' && !f.isText && tw > cw - pad * 2 && !/^[A-Za-z]/.test(text)) { text = '#'.repeat(Math.max(1, Math.floor((cw - pad * 2) / textWidth(ctx, font, '#')))); tw = textWidth(ctx, font, text) }
      ctx.save()
      // text may spill into empty neighbours; clipping is widened accordingly
      let left = x, right = x + cw
      if (!wrap && typeof v === 'string' && tw > cw - pad * 2 && eff.wrap !== 'clip' && !k.merge) {
        const spill = (dir: 1 | -1) => {
          let cc = dir > 0 ? k.c + 1 : k.c - 1, total = 0
          const need = tw - (cw - pad * 2)
          while (cc >= 0 && cc < sheet.cols && total < need) {
            const nv = book.value(sheet.id, k.r, cc)
            if (nv !== null && nv !== '') break
            if (sheet.merges.length && L.merges.at(k.r, cc)) break
            total += L.cols.size(cc) * zoom
            cc += dir
          }
          return total
        }
        if (align === 'left' || align === 'justify') right += Math.min(spill(1), tw)
        else if (align === 'right') left -= Math.min(spill(-1), tw)
        else { const s = Math.min(spill(1), tw / 2), t = Math.min(spill(-1), tw / 2); left -= t; right += s }
      }
      ctx.beginPath(); ctx.rect(left, y, right - left, ch); ctx.clip()
      const drawLine = (s: string, ly: number) => {
        const w2 = textWidth(ctx, font, s)
        let tx = align === 'right' ? x + cw - pad - w2 : align === 'center' ? x + (cw - w2) / 2 : x + pad
        if (eff.rotate) { /* handled by the caller */ }
        ctx.fillText(s, tx, ly)
        if (eff.underline || k.cell?.link) { ctx.fillRect(tx, ly + 1.5 * zoom, w2, Math.max(1, zoom)) }
        if (eff.strike) ctx.fillRect(tx, ly - size * 0.3, w2, Math.max(1, zoom))
        tx += 0
      }
      if (eff.rotate) {
        ctx.translate(x + cw / 2, y + ch / 2); ctx.rotate((-eff.rotate * Math.PI) / 180)
        const w2 = textWidth(ctx, font, text); ctx.textAlign = 'left'; ctx.fillText(text, -w2 / 2, size * 0.35)
      } else if (wrap) {
        const lines = wrapLines(ctx, font, text, cw - pad * 2)
        const lh = size * 1.25, total = lines.length * lh
        let ly = (eff.v ?? 'bottom') === 'top' ? y + 2 * zoom + size : eff.v === 'middle' ? y + (ch - total) / 2 + size : y + ch - total - 2 * zoom + size
        for (const s of lines) { drawLine(s, ly - lh * 0.15); ly += lh }
      } else {
        const ly = (eff.v ?? 'bottom') === 'top' ? y + 2 * zoom + size * 0.9 : eff.v === 'middle' ? y + ch / 2 + size * 0.33 : y + ch - 4 * zoom
        drawLine(text, ly)
      }
      ctx.restore()
    }
  }

  // The four panes: frozen corner, frozen rows, frozen columns, and the scrolling part.
  const viewW = w - hw, viewH = h - hh
  const cFirst = Math.min(Math.max(idxX(fw + scrollX), fc), sheet.cols - 1), cLast = Math.min(idxX(fw + scrollX + (viewW - fw)) + 1, sheet.cols - 1)
  const rFirst = Math.min(Math.max(idxY(fhh + scrollY), fr), sheet.rows - 1), rLast = Math.min(idxY(fhh + scrollY + (viewH - fhh)) + 1, sheet.rows - 1)
  const mx = (wx: number) => hw + wx - scrollX, my = (wy: number) => hh + wy - scrollY
  const fx = (wx: number) => hw + wx, fy = (wy: number) => hh + wy
  pane(rFirst, rLast, cFirst, cLast, mx, my, { x: hw + fw, y: hh + fhh, w: viewW - fw, h: viewH - fhh })
  if (fr) pane(0, fr - 1, cFirst, cLast, mx, fy, { x: hw + fw, y: hh, w: viewW - fw, h: fhh })
  if (fc) pane(rFirst, rLast, 0, fc - 1, fx, my, { x: hw, y: hh + fhh, w: fw, h: viewH - fhh })
  if (fr && fc) pane(0, fr - 1, 0, fc - 1, fx, fy, { x: hw, y: hh, w: fw, h: fhh })
  void drawnMerges

  // everything that sits on top of cells
  const screen = (r: number, c: number) => {
    const m = sheet.merges.length ? L.merges.at(r, c) : undefined
    const rr = m ?? { r1: r, c1: c, r2: r, c2: c }
    const x0 = cx(rr.c1), y0 = cy(rr.r1)
    return { x: x0 + hw - (rr.c1 >= fc ? scrollX : 0), y: y0 + hh - (rr.r1 >= fr ? scrollY : 0), w: cx(rr.c2 + 1) - x0, h: cy(rr.r2 + 1) - y0 }
  }
  const overlay = (fn: () => void) => { ctx.save(); ctx.beginPath(); ctx.rect(hw, hh, viewW, viewH); ctx.clip(); fn(); ctx.restore() }
  const rectBox = (g: Rect) => {
    const a = screen(g.r1, g.c1), b = screen(g.r2, g.c2)
    // Frozen panes: clamp the box to the visible region of its pane is unnecessary; the clip handles it.
    return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y }
  }

  // filter buttons and the active cell's drop-down arrow
  if (sheet.filter) {
    const f = sheet.filter
    overlay(() => {
      for (let c = f.range.c1; c <= f.range.c2; c++) {
        const b = screen(f.range.r1, c)
        const s = Math.min(16 * Math.min(zoom, 1.3), b.h - 4)
        const x = b.x + b.w - s - 2, y = b.y + b.h - s - 2
        if (x + s < hw || y + s < hh || x > w || y > h) continue
        const active = !!(f.cols[c]?.hide?.length || f.cols[c]?.cond)
        ctx.fillStyle = active ? pal.accent : '#fff'; ctx.strokeStyle = '#a89a86'; ctx.lineWidth = 1
        ctx.fillRect(x, y, s, s); ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
        ctx.fillStyle = active ? '#fff' : '#6b5a48'; ctx.beginPath(); ctx.moveTo(x + s * 0.28, y + s * 0.4); ctx.lineTo(x + s * 0.72, y + s * 0.4); ctx.lineTo(x + s / 2, y + s * 0.7); ctx.fill()
        hits.push({ kind: 'filter', x, y, w: s, h: s, r: f.range.r1, c })
      }
    })
  }
  const val = validationAt(sheet, sel.r, sel.c)
  if (val && val.dropdown !== false && (val.type === 'list' || val.type === 'listRange') && listOptions(book, sheet, val).length) {
    overlay(() => {
      const b = screen(sel.r, sel.c), s = Math.min(18, b.h - 2)
      const x = b.x + b.w - s - 1, y = b.y + (b.h - s) / 2
      ctx.fillStyle = '#fffaf2'; ctx.strokeStyle = '#a89a86'; ctx.fillRect(x, y, s, s); ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
      ctx.fillStyle = '#6b5a48'; ctx.beginPath(); ctx.moveTo(x + s * 0.3, y + s * 0.4); ctx.lineTo(x + s * 0.7, y + s * 0.4); ctx.lineTo(x + s / 2, y + s * 0.68); ctx.fill()
      hits.push({ kind: 'dropdown', x, y, w: s, h: s, r: sel.r, c: sel.c })
    })
  }

  // references being typed into a formula
  overlay(() => {
    for (const ref of p.refs ?? []) {
      if (ref.sheet !== sheet.id) continue
      const b = rectBox(ref.rect)
      ctx.strokeStyle = ref.color; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2)
      ctx.fillStyle = ref.color + '22'; ctx.fillRect(b.x, b.y, b.w, b.h)
    }
    // selection
    for (let i = 0; i < sel.ranges.length; i++) {
      const g = sel.ranges[i], b = rectBox(g)
      ctx.fillStyle = pal.selFill
      ctx.fillRect(b.x, b.y, b.w, b.h)
    }
    // the active cell is not tinted
    const a = screen(sel.r, sel.c)
    const cellBg = book.styles.get(book.getCell(sheet.id, sel.r, sel.c)?.s ?? 0).bg ?? pal.bg
    if (sel.ranges.length > 1 || sel.ranges[0].r1 !== sel.ranges[0].r2 || sel.ranges[0].c1 !== sel.ranges[0].c2) {
      ctx.fillStyle = cellBg; ctx.fillRect(a.x + 1, a.y + 1, a.w - 1, a.h - 1)
      if (!(p.editing && p.editing.r === sel.r && p.editing.c === sel.c)) {
        // redraw the active cell's content over the cleared tint
        ctx.save(); ctx.beginPath(); ctx.rect(a.x + 1, a.y + 1, a.w - 1, a.h - 1); ctx.clip()
        const f = displayOf(book, sheet.id, sel.r, sel.c)
        if (f.text && !f.text.startsWith(SPARK)) {
          const st = book.styles.get(book.getCell(sheet.id, sel.r, sel.c)?.s ?? 0), v = book.value(sheet.id, sel.r, sel.c)
          const font = fontOf(st, zoom); ctx.font = font; ctx.fillStyle = st.color ?? f.color ?? pal.text
          const size = ((st.size ?? 11) * 96 / 72) * zoom
          const num = typeof v === 'number'
          const al = st.h ?? (num ? 'right' : typeof v === 'boolean' ? 'center' : 'left')
          const tw = textWidth(ctx, font, f.text)
          const tx = al === 'right' ? a.x + a.w - 3 * zoom - tw : al === 'center' ? a.x + (a.w - tw) / 2 : a.x + 3 * zoom
          if (st.wrap !== true) ctx.fillText(f.text, tx, (st.v ?? 'bottom') === 'top' ? a.y + 2 * zoom + size * 0.9 : st.v === 'middle' ? a.y + a.h / 2 + size * 0.33 : a.y + a.h - 4 * zoom)
        }
        ctx.restore()
      }
    }
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2
    for (const g of sel.ranges) { const b = rectBox(g); ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1) }
    if (!p.editing) { ctx.lineWidth = 2.5; ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1) }
    // fill handle
    if (p.showFill) {
      const g = sel.ranges[sel.ranges.length - 1], b = rectBox(g)
      const s = 7
      ctx.fillStyle = pal.accent; ctx.fillRect(b.x + b.w - s / 2 - 1, b.y + b.h - s / 2 - 1, s, s)
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(b.x + b.w - s / 2 - 0.5, b.y + b.h - s / 2 - 0.5, s, s)
      hits.push({ kind: 'fill', x: b.x + b.w - 8, y: b.y + b.h - 8, w: 16, h: 16, r: g.r2, c: g.c2 })
    }
    if (p.copy) {
      const b = rectBox(p.copy)
      ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -(Date.now() / 60) % 10; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2); ctx.setLineDash([])
    }
  })

  // freeze lines
  ctx.strokeStyle = '#b3a38c'; ctx.lineWidth = 2
  if (fc) { ctx.beginPath(); ctx.moveTo(hw + fw, hh); ctx.lineTo(hw + fw, h); ctx.stroke() }
  if (fr) { ctx.beginPath(); ctx.moveTo(hw, hh + fhh); ctx.lineTo(w, hh + fhh); ctx.stroke() }

  // headings
  if (p.headings) {
    ctx.save()
    ctx.fillStyle = pal.header; ctx.fillRect(0, 0, w, hh); ctx.fillRect(0, 0, hw, h)
    ctx.font = `600 ${Math.max(10, 11 * Math.min(zoom, 1.2))}px system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const colSel = (c: number) => sel.ranges.some((g) => c >= g.c1 && c <= g.c2)
    const rowSel = (r: number) => sel.ranges.some((g) => r >= g.r1 && r <= g.r2)
    ctx.save(); ctx.beginPath(); ctx.rect(hw, 0, viewW, hh); ctx.clip()
    for (const [from, to, mapper] of [[cFirst, cLast, mx], ...(fc ? ([[0, fc - 1, fx]] as const) : [])] as const) {
      for (let c = from; c <= to; c++) {
        const wdt = L.cols.size(c) * zoom
        if (!wdt) continue
        const x = mapper(cx(c))
        const s = colSel(c)
        ctx.fillStyle = s ? pal.headerSel : pal.header; ctx.fillRect(x, 0, wdt, hh)
        ctx.strokeStyle = pal.grid; ctx.strokeRect(x + 0.5, 0.5, wdt, hh - 1)
        ctx.fillStyle = s ? pal.headerSelText : pal.headerText
        ctx.fillText(colName(c), x + wdt / 2, hh / 2 + 1)
      }
    }
    ctx.restore()
    ctx.save(); ctx.beginPath(); ctx.rect(0, hh, hw, viewH); ctx.clip()
    for (const [from, to, mapper] of [[rFirst, rLast, my], ...(fr ? ([[0, fr - 1, fy]] as const) : [])] as const) {
      for (let r = from; r <= to; r++) {
        const hgt = L.rows.size(r) * zoom
        if (!hgt) continue
        const y = mapper(cy(r))
        const s = rowSel(r)
        ctx.fillStyle = s ? pal.headerSel : pal.header; ctx.fillRect(0, y, hw, hgt)
        ctx.strokeStyle = pal.grid; ctx.strokeRect(0.5, y + 0.5, hw - 1, hgt)
        ctx.fillStyle = s ? pal.headerSelText : pal.headerText
        ctx.fillText(String(r + 1), hw / 2, y + hgt / 2 + 1)
      }
    }
    ctx.restore()
    ctx.fillStyle = pal.header; ctx.fillRect(0, 0, hw, hh)
    ctx.strokeStyle = pal.grid; ctx.strokeRect(0.5, 0.5, hw - 1, hh - 1)
    ctx.fillStyle = '#c9b89d'; ctx.beginPath(); ctx.moveTo(hw - 4, hh - 4); ctx.lineTo(hw - 4, hh - 14); ctx.lineTo(hw - 14, hh - 4); ctx.fill()
    ctx.restore()
  }
  return { hits }
}

export { inSel, formatValue }
export type { Scalar, Layout }
