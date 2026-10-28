import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Book } from '../engine/book'
import { FN_DOCS } from '../engine/docs'
import { toNumber } from '../engine/coerce'
import { listOptions, validationAt } from '../engine/validation'
import { key as ckey } from '../engine/types'
import { autofitCols, autofitRows, setColWidth, setRowHeight } from '../actions/structure'
import { advance, canPoint, canWrite, cancelEdit, clearSelection, commitEdit, pointAt, refsInText, setEditText, startEdit, toggleCheckbox } from '../actions/edit'
import { applyPainter } from '../actions/format'
import { fill } from '../actions/data'
import { copy } from '../actions/clipboard'
import { move, pageMove, registerGrid, selectAll, selectColumns, selectRegion, selectRows, setSel } from '../actions/nav'
import { useBook } from '../hooks'
import { HDR_H, HDR_W, DARK, LIGHT, fontOf, paint, type Hit } from '../render'
import { layoutOf } from '../geometry'
import { rectOf, single, type Sel } from '../selection'
import { useStore } from '../store'
import { openContextMenu } from '../menus'
import { runGlobalShortcut } from '../shortcuts'
import { FilterMenu } from './FilterMenu'
import { ObjectLayer } from './Objects'

type Drag =
  | { kind: 'cells'; ar: number; ac: number; additive: boolean; base: Sel }
  | { kind: 'cols' | 'rows'; anchor: number; additive: boolean; base: Sel }
  | { kind: 'resize'; axis: 'col' | 'row'; index: number; start: number; orig: number; group: number[]; before: (number | undefined)[]; last: number }
  | { kind: 'fill'; src: { r1: number; c1: number; r2: number; c2: number } }
  | { kind: 'point'; r: number; c: number }
  | { kind: 'pending'; x: number; y: number; t: number; hit: { r: number; c: number } }

export function Grid() {
  const book = useBook()
  const sel = useStore((s) => s.sel)
  const zoom = useStore((s) => s.zoom)
  const edit = useStore((s) => s.edit)
  const clip = useStore((s) => s.clip)
  const headings = useStore((s) => s.headings)
  const theme = useStore((s) => s.theme)
  const painter = useStore((s) => s.painter)
  const selectMode = useStore((s) => s.selectMode)
  const sheet = book.activeSheet

  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const hits = useRef<Hit[]>([])
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [fillPreview, setFillPreview] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null)
  const [popup, setPopup] = useState<{ kind: 'list' | 'filter'; r: number; c: number } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [cursor, setCursor] = useState('cell')
  const dark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)
  const pal = dark ? DARK : LIGHT
  const hw = headings ? HDR_W : 0, hh = headings ? HDR_H : 0
  const L = layoutOf(book, sheet)
  const fc = Math.min(sheet.frozenCols, sheet.cols), fr = Math.min(sheet.frozenRows, sheet.rows)
  const fw = L.cols.pos(fc) * zoom, fhh = L.rows.pos(fr) * zoom
  const contentW = hw + L.cols.total * zoom + 120, contentH = hh + L.rows.total * zoom + 80

  // ----------------------------------------------------------------- geometry
  /** Screen position of a cell inside the grid viewport. */
  const cellBox = useCallback((r: number, c: number) => {
    const m = sheet.merges.length ? L.merges.at(r, c) : undefined
    const g = m ?? { r1: r, c1: c, r2: r, c2: c }
    const x0 = L.cols.pos(g.c1) * zoom, y0 = L.rows.pos(g.r1) * zoom
    return { x: hw + x0 - (g.c1 >= fc ? scroll.x : 0), y: hh + y0 - (g.r1 >= fr ? scroll.y : 0), w: L.cols.pos(g.c2 + 1) * zoom - x0, h: L.rows.pos(g.r2 + 1) * zoom - y0 }
  }, [L, zoom, hw, hh, fc, fr, scroll, sheet.merges.length])

  const locate = useCallback((px: number, py: number) => {
    const onHeadX = px < hw, onHeadY = py < hh
    const wx = px - hw < fw ? px - hw : px - hw + scroll.x
    const wy = py - hh < fhh ? py - hh : py - hh + scroll.y
    const c = L.cols.indexAt(Math.max(0, wx) / zoom), r = L.rows.indexAt(Math.max(0, wy) / zoom)
    return { r: Math.min(r, sheet.rows - 1), c: Math.min(c, sheet.cols - 1), onHeadX, onHeadY, wx, wy }
  }, [L, zoom, hw, hh, fw, fhh, scroll, sheet.rows, sheet.cols])

  // -------------------------------------------------------------------- paint
  const refs = useMemo(() => (edit && edit.text.startsWith('=') ? refsInText(edit.text, edit.sheet, (n) => book.sheetId(n)) : undefined), [edit, book])
  const paintNow = useCallback(() => {
    const cv = canvas.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = size.w, h = size.h
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const out = paint({ ctx, w, h, book, sheet, zoom, scrollX: scroll.x, scrollY: scroll.y, sel, copy: clip && clip.sheet === sheet.id ? clip.rect : null, refs, headings, pal, editing: edit && edit.sheet === sheet.id ? { r: edit.r, c: edit.c } : null, showFill: !edit && !selectMode })
    hits.current = out.hits
    if (fillPreview) {
      ctx.save(); ctx.beginPath(); ctx.rect(hw, hh, w - hw, h - hh); ctx.clip()
      const a = cellBox(fillPreview.r1, fillPreview.c1), b = cellBox(fillPreview.r2, fillPreview.c2)
      ctx.strokeStyle = pal.accent; ctx.setLineDash([5, 3]); ctx.lineWidth = 2
      ctx.strokeRect(a.x + 1, a.y + 1, b.x + b.w - a.x - 2, b.y + b.h - a.y - 2)
      ctx.restore()
    }
  }, [size, book, sheet, zoom, scroll, sel, clip, refs, headings, pal, edit, selectMode, fillPreview, cellBox, hw, hh])
  const raf = useRef(0)
  useLayoutEffect(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(paintNow)
  })
  useEffect(() => {
    if (!clip) return
    const id = setInterval(() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(paintNow) }, 120)
    return () => clearInterval(id)
  }, [clip, paintNow])

  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  useEffect(() => { document.fonts?.ready.then(() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(paintNow) }) }, [paintNow])

  const onScroll = () => { const el = scroller.current!; setScroll({ x: el.scrollLeft, y: el.scrollTop }) }

  // ------------------------------------------------------------- the api other code uses
  useEffect(() => {
    registerGrid({
      scrollTo: (r, c) => {
        const el = scroller.current
        if (!el) return
        const b = { x: L.cols.pos(c) * zoom, y: L.rows.pos(r) * zoom, w: L.cols.size(c) * zoom, h: L.rows.size(r) * zoom }
        const viewW = el.clientWidth - hw, viewH = el.clientHeight - hh
        if (c >= fc) {
          if (b.x < el.scrollLeft + fw) el.scrollLeft = Math.max(0, b.x - fw)
          else if (b.x + b.w > el.scrollLeft + viewW) el.scrollLeft = b.x + b.w - viewW
        }
        if (r >= fr) {
          if (b.y < el.scrollTop + fhh) el.scrollTop = Math.max(0, b.y - fhh)
          else if (b.y + b.h > el.scrollTop + viewH) el.scrollTop = b.y + b.h - viewH
        }
      },
      focus: () => scroller.current?.focus({ preventScroll: true }),
      viewport: () => ({ r1: L.rows.indexAt(scroll.y / zoom), r2: L.rows.indexAt((scroll.y + size.h) / zoom), c1: L.cols.indexAt(scroll.x / zoom), c2: L.cols.indexAt((scroll.x + size.w) / zoom) }),
    })
    return () => registerGrid(null)
  }, [L, zoom, hw, hh, fc, fr, fw, fhh, scroll, size])

  // keep the sheet big enough for what is on it, and grow when someone scrolls to the end
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && sheet.rows < 1_048_576) book.prop(sheet, 'rows', Math.min(1_048_576, sheet.rows + 500))
    if (el.scrollLeft + el.clientWidth > el.scrollWidth - 200 && sheet.cols < 16_384) book.prop(sheet, 'cols', Math.min(16_384, sheet.cols + 26))
  }, [scroll, sheet, book])

  // --------------------------------------------------------------------- mouse
  const local = (e: { clientX: number; clientY: number }) => { const b = scroller.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  const hitAt = (x: number, y: number) => hits.current.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)
  const edgeAt = (x: number, y: number): { axis: 'col' | 'row'; index: number } | null => {
    if (!headings) return null
    if (y < hh && x > hw) {
      const wx = x - hw < fw ? x - hw : x - hw + scroll.x
      const c = L.cols.indexAt(wx / zoom)
      for (const i of [c - 1, c]) { if (i < 0) continue; const right = L.cols.pos(i + 1) * zoom; if (Math.abs(wx - right) <= 4) return { axis: 'col', index: i } }
    }
    if (x < hw && y > hh) {
      const wy = y - hh < fhh ? y - hh : y - hh + scroll.y
      const r = L.rows.indexAt(wy / zoom)
      for (const i of [r - 1, r]) { if (i < 0) continue; const bottom = L.rows.pos(i + 1) * zoom; if (Math.abs(wy - bottom) <= 4) return { axis: 'row', index: i } }
    }
    return null
  }

  const updateDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const { x, y } = local(e)
    const loc = locate(x, y)
    // scroll while dragging near the edge
    const el = scroller.current!
    if (d.kind !== 'resize') {
      if (x > size.w - 24) el.scrollLeft += 30; else if (x < hw + 24 && el.scrollLeft > 0 && x > 0) el.scrollLeft -= 30
      if (y > size.h - 24) el.scrollTop += 30; else if (y < hh + 24 && el.scrollTop > 0 && y > 0) el.scrollTop -= 30
    }
    const s = useStore.getState().sel
    if (d.kind === 'cells') {
      const g = rectOf(d.ar, d.ac, loc.r, loc.c)
      const ranges = d.additive ? [...d.base.ranges, g] : [g]
      useStore.getState().select({ ranges, r: d.additive ? s.r : d.base.r, c: d.additive ? s.c : d.base.c, ar: d.ar, ac: d.ac })
      if (!d.additive) useStore.getState().select({ ranges, r: d.ar, c: d.ac, ar: d.ar, ac: d.ac })
    } else if (d.kind === 'cols') {
      const g = { r1: 0, c1: Math.min(d.anchor, loc.c), r2: sheet.rows - 1, c2: Math.max(d.anchor, loc.c) }
      useStore.getState().select({ ranges: d.additive ? [...d.base.ranges, g] : [g], r: s.r, c: Math.min(d.anchor, loc.c), ar: 0, ac: d.anchor })
    } else if (d.kind === 'rows') {
      const g = { r1: Math.min(d.anchor, loc.r), c1: 0, r2: Math.max(d.anchor, loc.r), c2: sheet.cols - 1 }
      useStore.getState().select({ ranges: d.additive ? [...d.base.ranges, g] : [g], r: Math.min(d.anchor, loc.r), c: s.c, ar: d.anchor, ac: 0 })
    } else if (d.kind === 'resize') {
      const delta = (d.axis === 'col' ? x - d.start : y - d.start) / zoom
      const next = Math.max(8, d.orig + delta)
      d.last = next
      for (const i of d.group) book.rawSize(sheet.id, d.axis, i, next)
    } else if (d.kind === 'fill') {
      const g = d.src
      // Extend in whichever direction the pointer is furthest from the source.
      const dr = loc.r > g.r2 ? loc.r - g.r2 : loc.r < g.r1 ? loc.r - g.r1 : 0, dc = loc.c > g.c2 ? loc.c - g.c2 : loc.c < g.c1 ? loc.c - g.c1 : 0
      if (!dr && !dc) return setFillPreview(null)
      if (Math.abs(dr) * 1.0 >= Math.abs(dc)) setFillPreview(dr > 0 ? { ...g, r1: g.r2 + 1, r2: loc.r } : { ...g, r1: loc.r, r2: g.r1 - 1 })
      else setFillPreview(dc > 0 ? { ...g, c1: g.c2 + 1, c2: loc.c } : { ...g, c1: loc.c, c2: g.c1 - 1 })
    } else if (d.kind === 'point') {
      const g = rectOf(d.r, d.c, loc.r, loc.c)
      pointAt(g, edit && edit.sheet !== sheet.id ? sheet.name : undefined)
    } else if (d.kind === 'pending' && e.pointerType === 'touch' && !selectMode) {
      // a touch that moved is a scroll, not a tap
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) drag.current = null
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return
    scroller.current?.focus({ preventScroll: true })
    const { x, y } = local(e)
    setPopup(null)
    const touch = e.pointerType === 'touch'
    // typing a formula: clicking a cell points at it
    const ed = useStore.getState().edit
    if (ed && ed.text.startsWith('=') && x > hw && y > hh) {
      const loc = locate(x, y)
      if (pointAt({ r1: loc.r, c1: loc.c, r2: loc.r, c2: loc.c }, ed.sheet !== sheet.id ? sheet.name : undefined)) {
        drag.current = { kind: 'point', r: loc.r, c: loc.c }
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        e.preventDefault()
        return
      }
    }
    if (ed) { if (!commitEdit('none')) return }
    const h = hitAt(x, y)
    if (h?.kind === 'fill') { const g = useStore.getState().sel.ranges.at(-1)!; drag.current = { kind: 'fill', src: { ...g } }; ;(e.currentTarget as Element).setPointerCapture(e.pointerId); return }
    if (h?.kind === 'filter') { setPopup({ kind: 'filter', r: h.r, c: h.c }); return }
    if (h?.kind === 'dropdown') { setPopup({ kind: 'list', r: h.r, c: h.c }); return }
    if (h?.kind === 'checkbox') { setSel(single(h.r, h.c), false); toggleCheckbox(h.r, h.c); return }
    const edge = edgeAt(x, y)
    if (edge) {
      const s = useStore.getState().sel
      const full = edge.axis === 'col' ? s.ranges.some((g) => g.r1 === 0 && g.r2 >= sheet.rows - 1 && edge.index >= g.c1 && edge.index <= g.c2) : s.ranges.some((g) => g.c1 === 0 && g.c2 >= sheet.cols - 1 && edge.index >= g.r1 && edge.index <= g.r2)
      const group = full ? (edge.axis === 'col' ? s.ranges.flatMap((g) => Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => g.c1 + i)) : s.ranges.flatMap((g) => Array.from({ length: g.r2 - g.r1 + 1 }, (_, i) => g.r1 + i))) : [edge.index]
      const orig = edge.axis === 'col' ? L.cols.size(edge.index) : L.rows.size(edge.index)
      drag.current = { kind: 'resize', axis: edge.axis, index: edge.index, start: edge.axis === 'col' ? x : y, orig, group, last: orig, before: group.map((i) => (edge.axis === 'col' ? sheet.colW : sheet.rowH).get(i)) }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    const loc = locate(x, y)
    const s = useStore.getState().sel
    const additive = e.ctrlKey || e.metaKey
    if (loc.onHeadX && loc.onHeadY) { selectAll(); return }
    if (loc.onHeadY) {
      const base = additive ? s : single(0, loc.c)
      if (e.shiftKey) selectColumns(s.ac, loc.c)
      else { setSel({ ranges: additive ? [...s.ranges, { r1: 0, c1: loc.c, r2: sheet.rows - 1, c2: loc.c }] : [{ r1: 0, c1: loc.c, r2: sheet.rows - 1, c2: loc.c }], r: additive ? s.r : 0, c: loc.c, ar: 0, ac: loc.c }, false) }
      drag.current = { kind: 'cols', anchor: loc.c, additive, base }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    if (loc.onHeadX) {
      const base = additive ? s : single(loc.r, 0)
      if (e.shiftKey) selectRows(s.ar, loc.r)
      else setSel({ ranges: additive ? [...s.ranges, { r1: loc.r, c1: 0, r2: loc.r, c2: sheet.cols - 1 }] : [{ r1: loc.r, c1: 0, r2: loc.r, c2: sheet.cols - 1 }], r: loc.r, c: additive ? s.c : 0, ar: loc.r, ac: 0 }, false)
      drag.current = { kind: 'rows', anchor: loc.r, additive, base }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      return
    }
    // links open with Ctrl or Cmd
    const cell = book.getCell(sheet.id, loc.r, loc.c)
    if (cell?.link && (e.ctrlKey || e.metaKey)) { window.open(cell.link, '_blank', 'noopener'); return }
    useStore.setState({ object: null })
    if (touch && !selectMode) { drag.current = { kind: 'pending', x: e.clientX, y: e.clientY, t: Date.now(), hit: { r: loc.r, c: loc.c } }; return }
    if (e.shiftKey) {
      const g = rectOf(s.ar, s.ac, loc.r, loc.c)
      useStore.getState().select({ ...s, ranges: [...s.ranges.slice(0, -1), g] })
      drag.current = { kind: 'cells', ar: s.ar, ac: s.ac, additive: false, base: s }
    } else if (additive) {
      useStore.getState().select({ ranges: [...s.ranges, rectOf(loc.r, loc.c, loc.r, loc.c)], r: loc.r, c: loc.c, ar: loc.r, ac: loc.c })
      drag.current = { kind: 'cells', ar: loc.r, ac: loc.c, additive: true, base: useStore.getState().sel }
    } else {
      const m = sheet.merges.length ? L.merges.at(loc.r, loc.c) : undefined
      if (m) { setSel({ ranges: [m], r: m.r1, c: m.c1, ar: m.r1, ac: m.c1 }, false) }
      else setSel(single(loc.r, loc.c), false)
      drag.current = { kind: 'cells', ar: loc.r, ac: loc.c, additive: false, base: useStore.getState().sel }
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (useStore.getState().painter) applyPainter()
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    if (drag.current) { updateDrag(e); return }
    // hover cursor and note tooltips
    if (e.pointerType === 'mouse') {
      const edge = edgeAt(x, y)
      const h = hitAt(x, y)
      setCursor(edge ? (edge.axis === 'col' ? 'col-resize' : 'row-resize') : h?.kind === 'fill' ? 'crosshair' : h ? 'pointer' : x < hw || y < hh ? 'default' : 'cell')
      if (x > hw && y > hh) {
        const loc = locate(x, y)
        const note = book.getCell(sheet.id, loc.r, loc.c)?.note
        setTip(note ? { x: x + 12, y: y + 12, text: note } : null)
      } else setTip(null)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'resize') {
      // Put things back, then record the new size once so it is a single undo step.
      d.group.forEach((i, k) => book.rawSize(sheet.id, d.axis, i, d.before[k]))
      if (Math.abs(d.last - d.orig) > 0.5) for (const i of d.group) (d.axis === 'col' ? setColWidth : setRowHeight)(i, i, d.last)
    }
    if (d.kind === 'fill') {
      const fp = fillPreview
      setFillPreview(null)
      if (fp) {
        fill(d.src, fp)
        setSel({ ranges: [{ r1: Math.min(d.src.r1, fp.r1), c1: Math.min(d.src.c1, fp.c1), r2: Math.max(d.src.r2, fp.r2), c2: Math.max(d.src.c2, fp.c2) }], r: d.src.r1, c: d.src.c1, ar: d.src.r1, ac: d.src.c1 }, false)
      }
    }
    if (d.kind === 'pending') {
      // a tap on a touch screen: select, and a second tap edits
      const s = useStore.getState().sel
      const again = s.r === d.hit.r && s.c === d.hit.c && Date.now() - lastTap.current.t < 450 && lastTap.current.r === d.hit.r && lastTap.current.c === d.hit.c
      if (again) startEdit({ mode: 'edit' })
      else {
        setSel(single(d.hit.r, d.hit.c), false)
        if (useStore.getState().painter) applyPainter()
      }
      lastTap.current = { t: Date.now(), r: d.hit.r, c: d.hit.c }
    }
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }
  const lastTap = useRef({ t: 0, r: -1, c: -1 })

  const longPress = useRef(0)
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      clearTimeout(longPress.current)
      const px = e.clientX, py = e.clientY
      longPress.current = window.setTimeout(() => { if (drag.current?.kind === 'pending') { drag.current = null; openContextMenu(px, py, 'cells') } }, 550)
    }
  }
  const clearLong = () => clearTimeout(longPress.current)

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = local(e)
    const edge = edgeAt(x, y)
    if (edge) {
      const s = useStore.getState().sel
      if (edge.axis === 'col') { const cols = s.ranges.some((g) => edge.index >= g.c1 && edge.index <= g.c2 && g.r1 === 0) ? s.ranges.flatMap((g) => Array.from({ length: g.c2 - g.c1 + 1 }, (_, i) => g.c1 + i)) : [edge.index]; for (const c of cols) autofitCols(c, c) }
      else autofitRows(edge.index, edge.index)
      return
    }
    const h = hitAt(x, y)
    if (h?.kind === 'fill') {
      // double-click the fill handle: copy down as far as the neighbouring column has data
      const g = useStore.getState().sel.ranges.at(-1)!
      let r = g.r2
      const col = g.c1 > 0 ? g.c1 - 1 : g.c2 + 1
      while (book.value(sheet.id, r + 1, col) !== null) r++
      if (r > g.r2) fill(g, { ...g, r1: g.r2 + 1, r2: r })
      return
    }
    if (h) return
    if (x < hw || y < hh) return
    const loc = locate(x, y)
    if (!canWrite([{ r1: loc.r, c1: loc.c, r2: loc.r, c2: loc.c }])) return
    useStore.getState().select(single(loc.r, loc.c))
    startEdit({ mode: 'edit' })
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const { x, y } = local(e)
    const loc = locate(x, y)
    const s = useStore.getState().sel
    if (loc.onHeadY && loc.onHeadX) return openContextMenu(e.clientX, e.clientY, 'cells')
    if (loc.onHeadY) { if (!s.ranges.some((g) => g.r1 === 0 && g.c1 <= loc.c && g.c2 >= loc.c)) selectColumns(loc.c, loc.c); return openContextMenu(e.clientX, e.clientY, 'cols') }
    if (loc.onHeadX) { if (!s.ranges.some((g) => g.c1 === 0 && g.r1 <= loc.r && g.r2 >= loc.r)) selectRows(loc.r, loc.r); return openContextMenu(e.clientX, e.clientY, 'rows') }
    if (!s.ranges.some((g) => loc.r >= g.r1 && loc.r <= g.r2 && loc.c >= g.c1 && loc.c <= g.c2)) setSel(single(loc.r, loc.c), false)
    openContextMenu(e.clientX, e.clientY, 'cells')
  }

  // ------------------------------------------------------------------ keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return
    if (e.target !== scroller.current) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (runGlobalShortcut(e.nativeEvent)) { e.preventDefault(); return }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (arrows[k]) { e.preventDefault(); const [dr, dc] = arrows[k]; if (e.altKey && k === 'ArrowDown') { const v = validationAt(sheet, sel.r, sel.c); if (v) setPopup({ kind: 'list', r: sel.r, c: sel.c }); return } move(dr, dc, { extend: e.shiftKey, jump: mod }); return }
    switch (k) {
      case 'Tab': e.preventDefault(); advance(e.shiftKey ? 'left' : 'right'); return
      case 'Enter': e.preventDefault(); if (e.altKey) return; advance(e.shiftKey ? 'up' : 'down'); return
      case 'F2': e.preventDefault(); startEdit({ mode: 'edit' }); return
      case 'Delete': case 'Backspace': e.preventDefault(); clearSelection('contents'); return
      case 'Home': e.preventDefault(); if (mod) setSel(single(0, 0)); else move(0, -sel.c, { extend: e.shiftKey }); return
      case 'End': e.preventDefault(); if (mod) { const u = book.usedRange(sheet.id); setSel(single(Math.max(0, u.rows - 1), Math.max(0, u.cols - 1))) } return
      case 'PageDown': e.preventDefault(); pageMove(1, e.shiftKey); return
      case 'PageUp': e.preventDefault(); pageMove(-1, e.shiftKey); return
      case 'Escape': useStore.setState({ clip: null, painter: null }); return
      case ' ': if (mod) { e.preventDefault(); selectColumns(sel.c, sel.c) } else if (e.shiftKey) { e.preventDefault(); selectRows(sel.r, sel.r) } else { e.preventDefault(); startEdit({ text: ' ', mode: 'type' }) } return
    }
    if (mod) {
      switch (k.toLowerCase()) {
        case 'a': e.preventDefault(); selectRegion(); return
        case 'c': e.preventDefault(); void copy(false); return
        case 'x': e.preventDefault(); void copy(true); return
      }
      return
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit({ text: k, mode: 'type' }); return }
    if ((k === 'Process' || e.nativeEvent.isComposing) && !mod) startEdit({ text: '', mode: 'type' })
  }

  // paste arrives as an event so no permission is needed
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      if (useStore.getState().edit || useStore.getState().dialog) return
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return
      e.preventDefault()
      void import('../actions/clipboard').then((m) => m.paste(e))
    }
    window.addEventListener('paste', h)
    return () => window.removeEventListener('paste', h)
  }, [])

  // ----------------------------------------------------------------- editor box
  const eb = edit && edit.sheet === sheet.id ? cellBox(edit.r, edit.c) : null
  const st = edit ? book.styleOf(edit.sheet, edit.r, edit.c) : {}

  return (
    <div className="grid-wrap" data-testid="grid">
      <div
        ref={scroller}
        className={'grid-scroll' + (selectMode ? ' select-mode' : '')}
        tabIndex={0}
        role="grid"
        aria-label="Spreadsheet"
        aria-rowcount={sheet.rows}
        aria-colcount={sheet.cols}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{ cursor }}
      >
        <div className="grid-sticky">
          <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
          <div
            className="grid-hit"
            style={{ width: size.w, height: size.h }}
            onPointerDown={(e) => { onPointerDownCapture(e); onPointerDown(e) }}
            onPointerMove={(e) => { if (e.pointerType === 'touch' && drag.current?.kind === 'pending' && Math.hypot(e.clientX - (drag.current as { x: number }).x, e.clientY - (drag.current as { y: number }).y) > 10) clearLong(); onPointerMove(e) }}
            onPointerUp={(e) => { clearLong(); onPointerUp(e) }}
            onPointerCancel={() => { clearLong(); drag.current = null; setFillPreview(null) }}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
          />
          <ObjectLayer scroll={scroll} zoom={zoom} hw={hw} hh={hh} size={size} />
          {eb && edit && <CellEditor box={eb} style={st} zoom={zoom} viewW={size.w} />}
          {tip && !edit && <div className="note-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
          {popup?.kind === 'list' && <ListPopup book={book} r={popup.r} c={popup.c} box={cellBox(popup.r, popup.c)} onClose={() => { setPopup(null); scroller.current?.focus() }} />}
          {popup?.kind === 'filter' && <FilterMenu col={popup.c} box={cellBox(popup.r, popup.c)} onClose={() => { setPopup(null); scroller.current?.focus() }} />}
        </div>
        <div style={{ width: contentW, height: contentH }} aria-hidden />
      </div>
      {painter && <div className="painter-hint">Click or drag cells to paste the format. Esc to cancel.</div>}
    </div>
  )
}

// -------------------------------------------------------------------- cell editor
function CellEditor({ box, style, zoom, viewW }: { box: { x: number; y: number; w: number; h: number }; style: ReturnType<Book['styleOf']>; zoom: number; viewW: number }) {
  const edit = useStore((s) => s.edit)!
  const book = useStore((s) => s.book)
  const ta = useRef<HTMLTextAreaElement>(null)
  const [pick, setPick] = useState(-1)
  useEffect(() => {
    if (edit.origin === 'bar') return
    const t = ta.current
    if (t && document.activeElement !== t) { t.focus(); t.setSelectionRange(edit.caret, edit.caret) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit.origin])
  // keep the box and caret in sync when the text changes from outside (pointing at a cell)
  useEffect(() => {
    const t = ta.current
    if (t && edit.origin === 'cell' && t.value !== edit.text) { t.value = edit.text; t.setSelectionRange(edit.caret, edit.caret) }
  }, [edit.text, edit.caret, edit.origin])

  const lines = edit.text.split('\n').length
  const width = Math.max(box.w, Math.min(viewW - box.x - 8, Math.max(...edit.text.split('\n').map((l) => l.length)) * 8 * zoom + 24))
  const height = Math.max(box.h, lines * ((style.size ?? 11) * 1.6 * zoom))

  // function name suggestions while typing a formula
  const before = edit.text.slice(0, edit.caret)
  const ident = edit.text.startsWith('=') ? /(^|[=+\-*/^&(,<>;{%\s])([A-Za-z_][\w.]*)$/.exec(before) : null
  const names = useMemo(() => Book.functionNames(), [])
  const suggestions = ident && ident[2].length >= 1 ? names.filter((n) => n.startsWith(ident[2].toUpperCase())).slice(0, 8) : []
  const fnCtx = edit.text.startsWith('=') ? /([A-Z][A-Z0-9.]*)\([^()]*$/i.exec(before) : null
  const doc = fnCtx ? FN_DOCS[fnCtx[1].toUpperCase()] : undefined

  const accept = (name: string) => {
    const start = edit.caret - ident![2].length
    const text = edit.text.slice(0, start) + name + '(' + edit.text.slice(edit.caret)
    setEditText(text, start + name.length + 1)
    setPick(-1)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget
    const mod = e.ctrlKey || e.metaKey
    if (suggestions.length && (e.key === 'Tab' || (e.key === 'Enter' && pick >= 0))) { e.preventDefault(); accept(suggestions[Math.max(0, pick)]); return }
    if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && edit.mode === 'type') { e.preventDefault(); setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return }
    switch (e.key) {
      case 'Enter': if (e.altKey || (mod && false)) { e.preventDefault(); const p = t.selectionStart; setEditText(edit.text.slice(0, p) + '\n' + edit.text.slice(t.selectionEnd), p + 1); return } e.preventDefault(); commitEdit(e.shiftKey ? 'up' : 'down'); return
      case 'Tab': e.preventDefault(); commitEdit(e.shiftKey ? 'left' : 'right'); return
      case 'Escape': e.preventDefault(); cancelEdit(); return
      case 'F2': e.preventDefault(); useStore.setState({ edit: { ...edit, mode: edit.mode === 'edit' ? 'type' : 'edit' } }); return
      case 'F4': {
        e.preventDefault()
        const m = /\$?[A-Za-z]{1,3}\$?\d+/.exec(edit.text.slice(Math.max(0, edit.caret - 12), edit.caret + 12)); void m
        toggleAbsolute(edit, t)
        return
      }
    }
    if (e.key.startsWith('Arrow') && !e.shiftKey && !mod && !e.altKey) {
      const dir = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]!
      const pointing = edit.text.startsWith('=') && (edit.point || canPoint(edit.text, t.selectionStart)) && edit.mode === 'type'
      if (pointing) {
        e.preventDefault()
        const refs = edit.point
        const cur = refs ? refsInText(edit.text.slice(refs.from, refs.to).replace(/^/, '='), edit.sheet, () => undefined)[0]?.rect : undefined
        const sel = useStore.getState().sel
        const base = cur ?? { r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c }
        void base
        const r = (cur?.r1 ?? sel.r) + dir[0], c = (cur?.c1 ?? sel.c) + dir[1]
        pointAt({ r1: Math.max(0, r), c1: Math.max(0, c), r2: Math.max(0, r), c2: Math.max(0, c) })
        return
      }
      if (edit.mode === 'type') { e.preventDefault(); if (commitEdit('none')) move(dir[0], dir[1]) }
    }
  }
  return (
    <>
      <textarea
        ref={ta}
        className="cell-editor"
        aria-label="Cell editor"
        defaultValue={edit.text}
        spellCheck={false}
        style={{ left: box.x, top: box.y, width, height, font: fontOf(style, zoom), color: style.color ?? '#1f1a14', background: style.bg ?? '#fff', textAlign: style.h === 'center' ? 'center' : style.h === 'right' ? 'right' : 'left' }}
        onChange={(e) => setEditText(e.target.value, e.target.selectionStart)}
        onSelect={(e) => { const t = e.currentTarget; if (t.value === edit.text && t.selectionStart !== edit.caret && !edit.point) useStore.setState({ edit: { ...edit, caret: t.selectionStart } }) }}
        onKeyDown={onKeyDown}
        onBlur={() => { /* the formula bar or a click on the grid decides what happens */ }}
      />
      {suggestions.length > 0 && (
        <ul className="suggest" style={{ left: box.x, top: box.y + height + 2 }} role="listbox">
          {suggestions.map((n, i) => (
            <li key={n} role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); accept(n) }}>
              <b>{n}</b><span>{FN_DOCS[n]?.[1] ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
      {doc && !suggestions.length && <div className="fn-hint" style={{ left: box.x, top: box.y + height + 2 }}><code>{doc[0]}</code><span>{doc[1]}</span></div>}
      {book && null}
    </>
  )
}

/** F4: cycle the reference at the caret through $A$1, A$1, $A1, A1. */
function toggleAbsolute(edit: { text: string; caret: number }, t: HTMLTextAreaElement) {
  const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(edit.text))) {
    if (edit.caret >= m.index && edit.caret <= m.index + m[0].length) {
      const state = (m[1] ? 2 : 0) + (m[3] ? 1 : 0) // col abs, row abs
      const next = [[1, 1], [0, 1], [1, 0], [0, 0]][(([3, 1, 2, 0].indexOf(state)) + 1) % 4]
      const rep = `${next[0] ? '$' : ''}${m[2]}${next[1] ? '$' : ''}${m[4]}`
      setEditText(edit.text.slice(0, m.index) + rep + edit.text.slice(m.index + m[0].length), m.index + rep.length)
      return
    }
  }
  void t
}

function ListPopup({ book, r, c, box, onClose }: { book: Book; r: number; c: number; box: { x: number; y: number; w: number; h: number }; onClose: () => void }) {
  const sheet = book.activeSheet
  const v = validationAt(sheet, r, c)
  const opts = v ? listOptions(book, sheet, v) : []
  const cur = String(book.value(sheet.id, r, c) ?? '')
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <>
      <div className="popup-shield" onPointerDown={onClose} />
      <ul className="list-popup" style={{ left: box.x, top: box.y + box.h, minWidth: box.w }} role="listbox">
        {opts.map((o) => (
          <li key={o} role="option" aria-selected={o === cur} className={o === cur ? 'on' : ''} onClick={() => { if (canWrite([{ r1: r, c1: c, r2: r, c2: c }])) { book.setInput(sheet.id, r, c, o); useStore.setState((s) => ({ file: { ...s.file, dirty: true } })) } onClose() }}>{o}</li>
        ))}
      </ul>
    </>
  )
}
export { ckey, fontOf, toNumber }
