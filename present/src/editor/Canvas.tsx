import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { bounds, cloneEl, findEl, mapEls, rotBounds, type Base, type El, type LineEl, type ShapeEl, type TableEl } from '../model'
import { resolveBg, SlideView, type ViewOpts } from '../render/Slide'
import { curSlide, targetEls, useStore } from '../store'
import { addEl, addEls, deleteSel, editEls, fitEl, selected, translateEl } from '../actions'
import { newLine, newShape, newTextBox } from '../insert'
import { HANDLES, adjHandle, center, rad, resizeBox, rotate, snapBox, type Pt } from './geometry'
import { setElText, startEdit, stopEdit } from './textEdit'
import { TextEditor } from './TextEditor'
import { openContextMenu } from '../menus'

const S = () => useStore.getState()

type Drag =
  | { k: 'move'; start: Pt; orig: Map<string, El>; moved: boolean; dup: boolean; wasSole: boolean; hitId: string; at: { x: number; y: number } }
  | { k: 'resize'; h: (typeof HANDLES)[number]; orig: El[]; box: { x: number; y: number; w: number; h: number } }
  | { k: 'rotate'; orig: El }
  | { k: 'adj'; orig: ShapeEl; i: number }
  | { k: 'end'; orig: LineEl; which: 0 | 1 }
  | { k: 'marquee'; start: Pt; add: boolean; base: string[] }
  | { k: 'draw'; start: Pt; tool: ReturnType<typeof S>['tool'] }
  | { k: 'cells'; id: string; r0: number; c0: number }
  | { k: 'grip'; id: string; axis: 'col' | 'row'; i: number; orig: TableEl; start: Pt }

const isTextual = (e: El) => e.type === 'shape' || e.type === 'table'

function localPoint(e: Base | { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }, P: Pt): Pt {
  const C = center(e)
  const v = rotate({ x: P.x - C.x, y: P.y - C.y }, -rad(e.rot ?? 0))
  let x = v.x + e.w / 2, y = v.y + e.h / 2
  if (e.flipH) x = e.w - x
  if (e.flipV) y = e.h - y
  return { x, y }
}
function cellAt(t: TableEl, P: Pt): { r: number; c: number } {
  const p = localPoint(t, P)
  let c = 0, x = 0
  for (; c < t.cols.length - 1; c++) { x += t.cols[c]; if (p.x < x) break }
  let r = 0, y = 0
  for (; r < t.rows.length - 1; r++) { y += t.rows[r].h; if (p.y < y) break }
  return { r, c }
}

export function Canvas() {
  const deck = useStore((s) => s.deck)
  const cur = useStore((s) => s.cur)
  const target = useStore((s) => s.target)
  const sel = useStore((s) => s.sel)
  const editing = useStore((s) => s.editing)
  const tool = useStore((s) => s.tool)
  const zoom = useStore((s) => s.zoom)
  const panels = useStore((s) => s.panels)
  const cellSel = useStore((s) => s.cellSel)
  const slide = useMemo(() => deck.slides.find((x) => x.id === cur) ?? deck.slides[0], [deck, cur])
  const stage = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 500 })
  const [guides, setGuides] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([])
  const [marq, setMarq] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [draw, setDraw] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const drag = useRef<Drag | null>(null)

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const pad = box.w < 700 ? 10 : 32
  const fit = Math.max(0.05, Math.min((box.w - pad * 2) / deck.w, (box.h - pad * 2) / deck.h))
  const scale = zoom === 'fit' ? fit : zoom

  // Ctrl + wheel (and trackpad pinch) zooms.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const z = S().zoom === 'fit' ? fit : (S().zoom as number)
      useStore.setState({ zoom: Math.max(0.1, Math.min(4, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [fit])

  const list = targetEls(deck, target, slide)
  const layout = deck.layouts.find((l) => l.id === slide.layout)
  const under = target.kind === 'slide' ? [deck.master.els, (layout?.els ?? []).filter((e) => !e.ph)] : target.kind === 'layout' ? [deck.master.els] : []
  const bg = target.kind === 'master' ? deck.master.bg ?? { t: 'solid' as const, c: '@bg' } : target.kind === 'layout' ? deck.layouts.find((l) => l.id === target.id)?.bg ?? deck.master.bg ?? { t: 'solid' as const, c: '@bg' } : resolveBg(deck, slide.layout, slide.bg)
  const editKey = editing ? `${editing.id}:${editing.cell?.r ?? ''}:${editing.cell?.c ?? ''}` : ''

  const liveText = useCallback((el: ShapeEl | TableEl, cell?: { r: number; c: number }) => {
    const ed = S().editing
    if (!ed || ed.id !== el.id) return null
    if (el.type === 'table') { if (!cell || ed.cell?.r !== cell.r || ed.cell?.c !== cell.c) return null }
    const text = el.type === 'table' ? el.rows[cell!.r].cells[cell!.c].text : el.text ?? { paras: [{ runs: [] }] }
    const st = el.type === 'table' ? { sz: 18 } : el.st
    const nextCell = (dir: 1 | -1) => {
      if (el.type !== 'table' || !cell) return false
      const cols = el.cols.length, rows = el.rows.length
      let i = cell.r * cols + cell.c + dir
      if (i >= rows * cols) { // Tab past the last cell adds a row, like a word processor.
        editEls('Add row', (l) => mapEls(l, (x) => (x.id === el.id && x.type === 'table' ? { ...x, h: x.h + 40, rows: [...x.rows, { h: 40, cells: Array.from({ length: cols }, () => ({ text: { paras: [{ runs: [] }] } })) }] } : x)))
        i = rows * cols
      }
      if (i < 0) return true
      useStore.setState({ editing: { id: el.id, cell: { r: Math.floor(i / cols), c: i % cols } } })
      return true
    }
    return <TextEditor key={editKey} text={text} st={st} role={el.type === 'shape' ? el.ph?.role : undefined} theme={S().deck.theme} at={S().editAt} onChange={(t) => setElText(el.id, el.type === 'table' ? cell : undefined, t)} onExit={stopEdit} onTab={el.type === 'table' ? nextCell : undefined} />
  }, [editKey])

  const o: ViewOpts = useMemo(() => ({ theme: deck.theme, media: deck.media, prompts: true, liveText, editingId: editing?.id ?? null }), [deck.theme, deck.media, liveText, editing?.id])

  const pt = (e: { clientX: number; clientY: number }): Pt => {
    const r = overlay.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }
  const byId = (id: string) => list.find((e) => e.id === id)

  // ---------------------------------------------------------------- pointer

  const onDown = (e: RPointerEvent) => {
    if (e.button === 2) return
    const st = S()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    stage.current?.focus({ preventScroll: true })
    const P = pt(e)
    if (st.editing) {
      // A click outside the box being edited ends editing; the click then acts normally.
      stopEdit()
    }
    const t = e.target as HTMLElement
    // Drawing a new object.
    if (st.tool.kind !== 'select') { drag.current = { k: 'draw', start: P, tool: st.tool }; setDraw({ x1: P.x, y1: P.y, x2: P.x, y2: P.y }); return }
    // Handles.
    const hid = t.closest('[data-handle]')?.getAttribute('data-handle')
    if (hid) {
      const els = selected()
      if (hid === 'rot') drag.current = { k: 'rotate', orig: els[0] }
      else if (hid.startsWith('adj')) drag.current = { k: 'adj', orig: els[0] as ShapeEl, i: 0 }
      else if (hid === 'end0' || hid === 'end1') drag.current = { k: 'end', orig: els[0] as LineEl, which: hid === 'end0' ? 0 : 1 }
      else { const h = HANDLES.find((x) => x.id === hid)!; drag.current = { k: 'resize', h, orig: els, box: els.length === 1 ? { x: els[0].x, y: els[0].y, w: els[0].w, h: els[0].h } : bounds(els) } }
      return
    }
    const grip = t.closest('[data-grip]')?.getAttribute('data-grip')
    if (grip) {
      const [axis, i] = grip.split(':') as ['col' | 'row', string]
      const tb = selected()[0] as TableEl
      drag.current = { k: 'grip', id: tb.id, axis, i: Number(i), orig: tb, start: P }
      return
    }
    const hit = t.closest('[data-hit]')?.getAttribute('data-hit')
    if (hit) {
      const el = byId(hit)!
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      const wasSole = st.sel.length === 1 && st.sel[0] === hit
      let ids = st.sel
      if (additive && !e.altKey) ids = ids.includes(hit) ? ids.filter((i) => i !== hit) : [...ids, hit]
      else if (!ids.includes(hit)) ids = [hit]
      useStore.setState({ sel: ids, cellSel: null })
      if (el.type === 'table' && wasSole) {
        const c = cellAt(el, P)
        useStore.setState({ cellSel: { id: el.id, r1: c.r, c1: c.c, r2: c.r, c2: c.c } })
        drag.current = { k: 'cells', id: el.id, r0: c.r, c0: c.c }
        return
      }
      const orig = new Map(ids.map((i) => [i, byId(i)!] as const).filter(([, v]) => v))
      drag.current = { k: 'move', start: P, orig, moved: false, dup: (e.ctrlKey || e.metaKey || e.altKey) && !e.shiftKey && ids.includes(hit), wasSole: wasSole && !additive, hitId: hit, at: { x: e.clientX, y: e.clientY } }
      return
    }
    // Empty space: marquee.
    const add = e.shiftKey
    drag.current = { k: 'marquee', start: P, add, base: add ? st.sel : [] }
    if (!add) useStore.setState({ sel: [], cellSel: null })
  }

  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const P = pt(e)
    const st = S()
    const snapOn = st.panels.snap && !e.altKey
    switch (d.k) {
      case 'move': {
        let dx = P.x - d.start.x, dy = P.y - d.start.y
        if (!d.moved) { if (Math.hypot(dx, dy) * scale < 3) return; d.moved = true
          if (d.dup) { const copies = [...d.orig.values()].map((x) => cloneEl(x)); addEls(copies); d.orig = new Map(copies.map((c) => [c.id, c])); useStore.setState({ lastKey: '' }) } }
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        const origEls = [...d.orig.values()]
        const bb = bounds(origEls)
        let gs: typeof guides = []
        if (snapOn && origEls.length) {
          const r = snapBox({ x: bb.x + dx, y: bb.y + dy, w: bb.w, h: bb.h }, list.filter((x) => !d.orig.has(x.id)), deck, 6 / scale)
          dx += r.dx; dy += r.dy; gs = r.guides
          if (st.panels.grid && !r.guides.length) { dx = Math.round((bb.x + dx) / 12) * 12 - bb.x; dy = Math.round((bb.y + dy) / 12) * 12 - bb.y }
        }
        setGuides(gs)
        editEls('Move', (l) => mapEls(l, (x) => (d.orig.has(x.id) && !d.orig.get(x.id)!.locked ? translateEl(d.orig.get(x.id)!, dx, dy) : x)), { key: 'drag' })
        break
      }
      case 'resize': {
        const { h } = d
        const corner = h.hx !== 0 && h.hy !== 0
        if (d.orig.length === 1) {
          const o0 = d.orig[0]
          const keep = o0.type === 'image' || o0.type === 'chart' ? corner && !e.shiftKey : e.shiftKey && corner
          const nb = resizeBox(o0, h.hx, h.hy, P, { keepAspect: keep, fromCenter: e.altKey })
          editEls('Resize', (l) => mapEls(l, (x) => (x.id === o0.id ? fitEl(o0, nb.x, nb.y, nb.w, nb.h) : x)), { key: 'drag' })
        } else {
          const b0 = d.box
          const nb = resizeBox({ ...b0, rot: 0 }, h.hx, h.hy, P, { keepAspect: e.shiftKey, fromCenter: e.altKey, minSize: 8 })
          const kx = nb.w / b0.w, ky = nb.h / b0.h
          const m = new Map(d.orig.map((x) => [x.id, x] as const))
          editEls('Resize', (l) => mapEls(l, (x) => { const o0 = m.get(x.id); return o0 ? fitEl(o0, nb.x + (o0.x - b0.x) * kx, nb.y + (o0.y - b0.y) * ky, o0.w * kx, o0.h * ky) : x }), { key: 'drag' })
        }
        break
      }
      case 'rotate': {
        const C = center(d.orig)
        let a = (Math.atan2(P.y - C.y, P.x - C.x) * 180) / Math.PI + 90
        if (e.shiftKey) a = Math.round(a / 15) * 15
        else for (const t of [0, 90, 180, 270, 360]) if (Math.abs(a - t) < 3) a = t
        a = ((a % 360) + 360) % 360
        editEls('Rotate', (l) => mapEls(l, (x) => (x.id === d.orig.id ? { ...x, rot: Math.round(a * 10) / 10 } : x)), { key: 'drag' })
        break
      }
      case 'adj': {
        const h = adjHandle(d.orig)
        if (!h) break
        const adj = h.set(localPoint(d.orig, P))
        editEls('Adjust', (l) => mapEls(l, (x) => (x.id === d.orig.id ? { ...x, adj } : x)), { key: 'drag' })
        break
      }
      case 'end': {
        const o0 = d.orig
        const a: Pt = { x: o0.flipH ? o0.x + o0.w : o0.x, y: o0.flipV ? o0.y + o0.h : o0.y }
        const b: Pt = { x: o0.flipH ? o0.x : o0.x + o0.w, y: o0.flipV ? o0.y : o0.y + o0.h }
        const fixed = d.which === 0 ? b : a
        let q = { ...P }
        if (e.shiftKey) { const dx = q.x - fixed.x, dy = q.y - fixed.y; const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); q = { x: fixed.x + Math.cos(ang) * len, y: fixed.y + Math.sin(ang) * len } }
        const na = d.which === 0 ? q : a, nb = d.which === 0 ? b : q
        editEls('Edit line', (l) => mapEls(l, (x) => (x.id === o0.id ? { ...x, x: Math.min(na.x, nb.x), y: Math.min(na.y, nb.y), w: Math.abs(nb.x - na.x), h: Math.abs(nb.y - na.y), flipH: nb.x < na.x || undefined, flipV: nb.y < na.y || undefined } : x)), { key: 'drag' })
        break
      }
      case 'marquee': {
        const r = { x: Math.min(d.start.x, P.x), y: Math.min(d.start.y, P.y), w: Math.abs(P.x - d.start.x), h: Math.abs(P.y - d.start.y) }
        setMarq(r)
        const ids = list.filter((x) => { const b = rotBounds(x); return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y }).map((x) => x.id)
        useStore.setState({ sel: [...new Set([...d.base, ...ids])] })
        break
      }
      case 'draw': {
        let q = P
        if (e.shiftKey && d.tool.kind === 'line') { const dx = q.x - d.start.x, dy = q.y - d.start.y; const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); q = { x: d.start.x + Math.cos(ang) * len, y: d.start.y + Math.sin(ang) * len } }
        if (e.shiftKey && d.tool.kind === 'shape') { const s2 = Math.max(Math.abs(q.x - d.start.x), Math.abs(q.y - d.start.y)); q = { x: d.start.x + Math.sign(q.x - d.start.x || 1) * s2, y: d.start.y + Math.sign(q.y - d.start.y || 1) * s2 } }
        setDraw({ x1: d.start.x, y1: d.start.y, x2: q.x, y2: q.y })
        break
      }
      case 'cells': {
        const t = byId(d.id) as TableEl | undefined
        if (!t) break
        const c = cellAt(t, P)
        useStore.setState({ cellSel: { id: d.id, r1: Math.min(d.r0, c.r), c1: Math.min(d.c0, c.c), r2: Math.max(d.r0, c.r), c2: Math.max(d.c0, c.c) } })
        break
      }
      case 'grip': {
        const o0 = d.orig
        const dd = rotate({ x: P.x - d.start.x, y: P.y - d.start.y }, -rad(o0.rot ?? 0))
        if (d.axis === 'col') {
          const delta = Math.max(-(o0.cols[d.i] - 20), Math.min(o0.cols[d.i + 1] - 20, dd.x))
          editEls('Resize column', (l) => mapEls(l, (x) => (x.id === o0.id ? { ...o0, cols: o0.cols.map((w, i) => (i === d.i ? w + delta : i === d.i + 1 ? w - delta : w)) } : x)), { key: 'drag' })
        } else {
          const delta = Math.max(-(o0.rows[d.i].h - 14), Math.min(o0.rows[d.i + 1].h - 14, dd.y))
          editEls('Resize row', (l) => mapEls(l, (x) => (x.id === o0.id ? { ...o0, rows: o0.rows.map((r, i) => (i === d.i ? { ...r, h: r.h + delta } : i === d.i + 1 ? { ...r, h: r.h - delta } : r)) } : x)), { key: 'drag' })
        }
        break
      }
    }
  }

  const onUp = (e: RPointerEvent) => {
    const d = drag.current
    drag.current = null
    setGuides([]); setMarq(null)
    useStore.setState({ lastKey: '' })
    if (!d) return
    if (d.k === 'draw') {
      const dr = draw
      setDraw(null)
      const P = pt(e)
      const x1 = d.start.x, y1 = d.start.y
      const x2 = dr?.x2 ?? P.x, y2 = dr?.y2 ?? P.y
      const small = Math.hypot(x2 - x1, y2 - y1) * scale < 8
      const t = d.tool
      if (t.kind === 'text') {
        const w = small ? 320 : Math.max(60, Math.abs(x2 - x1)), x = small ? x1 : Math.min(x1, x2)
        const el = newTextBox(x, small ? y1 - 14 : Math.min(y1, y2), w, small ? 44 : Math.max(36, Math.abs(y2 - y1)))
        addEl(el)
        startEdit(el.id)
      } else if (t.kind === 'shape') {
        const w = small ? 160 : Math.abs(x2 - x1), h = small ? 160 : Math.abs(y2 - y1)
        addEl(newShape(t.geom, small ? x1 - w / 2 : Math.min(x1, x2), small ? y1 - h / 2 : Math.min(y1, y2), Math.max(w, 6), Math.max(h, 6)))
      } else if (t.kind === 'line') {
        const a = small ? { x: x1 - 80, y: y1 } : { x: x1, y: y1 }, b = small ? { x: x1 + 80, y: y1 + (t.line === 'straight' ? 0 : 60) } : { x: x2, y: y2 }
        addEl(newLine(t.line, a.x, a.y, b.x, b.y, !!t.arrow))
      }
      return
    }
    if (d.k === 'move' && !d.moved && d.wasSole) {
      const el = byId(d.hitId)
      if (el && isTextual(el) && !el.locked) {
        useStore.setState({ editAt: d.at })
        startEdit(el.id, el.type === 'table' ? cellAt(el, pt(e)) : undefined)
      }
    }
  }

  const onDouble = (e: React.MouseEvent) => {
    const hit = (e.target as HTMLElement).closest('[data-hit]')?.getAttribute('data-hit')
    if (!hit) return
    const el = byId(hit)
    if (!el) return
    if (isTextual(el)) { useStore.setState({ editAt: { x: e.clientX, y: e.clientY } }); startEdit(el.id, el.type === 'table' ? cellAt(el, pt(e)) : undefined) }
    else if (el.type === 'chart') useStore.setState({ dialog: 'chartData' })
    else if (el.type === 'image') useStore.setState({ dialog: 'crop' })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (S().editing) return
    const mod = e.metaKey || e.ctrlKey
    const step = e.shiftKey ? 10 : 1
    const sels = selected()
    const nudgeBy = (dx: number, dy: number) => { e.preventDefault(); if (sels.length) { const ids = new Set(sels.map((x) => x.id)); editEls('Move', (l) => mapEls(l, (x) => (ids.has(x.id) && !x.locked ? translateEl(x, dx, dy) : x)), { key: 'nudge' }) } }
    if (e.key === 'ArrowLeft' && sels.length) nudgeBy(-step, 0)
    else if (e.key === 'ArrowRight' && sels.length) nudgeBy(step, 0)
    else if (e.key === 'ArrowUp' && sels.length) nudgeBy(0, -step)
    else if (e.key === 'ArrowDown' && sels.length) nudgeBy(0, step)
    else if ((e.key === 'Enter' || e.key === 'F2') && sels.length === 1 && isTextual(sels[0]) && !mod) { e.preventDefault(); useStore.setState({ editAt: null }); startEdit(sels[0].id, S().cellSel?.id === sels[0].id ? { r: S().cellSel!.r1, c: S().cellSel!.c1 } : undefined) }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sels.length) { e.preventDefault(); deleteSel() }
    else if (e.key === 'Escape') { useStore.setState({ sel: [], cellSel: null, tool: { kind: 'select' } }) }
    else if (e.key === 'Tab' && list.length) {
      e.preventDefault()
      const i = list.findIndex((x) => x.id === sels[0]?.id)
      const n = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]
      useStore.setState({ sel: [n.id] })
    }
  }

  // ---------------------------------------------------------------- drawing the overlay

  const hs = 9 / scale
  const single = sel.length === 1 ? byId(sel[0]) : undefined
  const selEls = sel.map(byId).filter((x): x is El => !!x)
  const frameBox = selEls.length === 1 ? { x: selEls[0].x, y: selEls[0].y, w: selEls[0].w, h: selEls[0].h, rot: selEls[0].rot ?? 0 } : selEls.length > 1 ? { ...bounds(selEls), rot: 0 } : null
  const hitStyle = (e: El): CSSProperties => ({ position: 'absolute', left: e.x, top: e.y, width: e.w, height: e.h, transform: e.rot ? `rotate(${e.rot}deg)` : undefined, touchAction: 'none', cursor: e.locked ? 'default' : 'move' })

  const frameLine = 1.5 / scale
  const showHandles = frameBox && !editing && !(single && single.locked)
  const adj = single && single.type === 'shape' && !editing ? adjHandle(single) : null
  const table = single?.type === 'table' && !editing ? single : null

  const overlayNodes = (
    <div ref={overlay} className="overlay" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}
      onContextMenu={(e) => { e.preventDefault(); const hit = (e.target as HTMLElement).closest('[data-hit]')?.getAttribute('data-hit'); if (hit && !S().sel.includes(hit)) useStore.setState({ sel: [hit] }); openContextMenu(e.clientX, e.clientY, hit ? 'element' : 'slide') }}
      style={{ cursor: tool.kind === 'select' ? undefined : 'crosshair', touchAction: tool.kind === 'select' ? 'pan-x pan-y' : 'none' }}>
      {panels.grid && <div className="grid-lines" style={{ backgroundSize: '12px 12px' }} />}
      {panels.guides && <><div className="guide" style={{ left: deck.w / 2, top: 0, width: 1 / scale, height: deck.h }} /><div className="guide" style={{ top: deck.h / 2, left: 0, height: 1 / scale, width: deck.w }} /></>}
      {list.map((el) => {
        if (editing?.id === el.id) return null
        if (el.type === 'line') return <svg key={el.id} data-hit={el.id} className="hit-svg" style={{ ...hitStyle(el), transform: [el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1},${el.flipV ? -1 : 1})` : ''].join(' ') || undefined, overflow: 'visible', pointerEvents: 'none' }} width={Math.max(el.w, 1)} height={Math.max(el.h, 1)}><path d={el.kind === 'elbow' ? `M0 0H${el.w / 2}V${el.h}H${el.w}` : el.kind === 'curve' ? `M0 0C${el.w / 2} 0 ${el.w / 2} ${el.h} ${el.w} ${el.h}` : `M0 0L${el.w} ${el.h}`} fill="none" stroke="transparent" strokeWidth={Math.max(el.line.w + 12, 14 / scale)} pointerEvents="stroke" data-hit={el.id} style={{ cursor: 'move' }} /></svg>
        const open = el.type === 'shape' && !el.fill && !el.text?.paras.some((p) => p.runs.length) && !el.ph
        if (open) return <svg key={el.id} className="hit-svg" style={{ ...hitStyle(el), overflow: 'visible', pointerEvents: 'none' }} width={el.w} height={el.h}><rect width={el.w} height={el.h} fill="none" stroke="transparent" strokeWidth={14 / scale} pointerEvents={el.line?.w ? 'stroke' : 'all'} data-hit={el.id} style={{ cursor: 'move' }} /></svg>
        return <div key={el.id} data-hit={el.id} style={hitStyle(el)} title={el.alt || undefined} />
      })}
      {selEls.map((x) => x.id !== editing?.id && x.type !== 'line' && (
        <div key={`f${x.id}`} className="sel-frame" style={{ left: x.x, top: x.y, width: x.w, height: x.h, transform: x.rot ? `rotate(${x.rot}deg)` : undefined, outlineWidth: frameLine, outlineStyle: x.locked ? 'dashed' : 'solid' }} />
      ))}
      {selEls.map((x) => x.id !== editing?.id && x.type === 'line' && (
        <svg key={`f${x.id}`} style={{ position: 'absolute', left: x.x, top: x.y, overflow: 'visible', pointerEvents: 'none' }} width={Math.max(x.w, 1)} height={Math.max(x.h, 1)}><rect width={x.w} height={x.h} fill="none" stroke="var(--accent)" strokeWidth={1 / scale} strokeDasharray={`${4 / scale} ${3 / scale}`} /></svg>
      ))}
      {editing && (() => { const x = byId(editing.id); return x && <div className="sel-frame editing" style={{ left: x.x, top: x.y, width: x.w, height: x.h, transform: x.rot ? `rotate(${x.rot}deg)` : undefined, outlineWidth: frameLine }} /> })()}
      {cellSel && !editing && (() => { const t = byId(cellSel.id) as TableEl | undefined; if (!t) return null
        const xs = [0]; t.cols.forEach((w) => xs.push(xs[xs.length - 1] + w)); const ys = [0]; t.rows.forEach((r) => ys.push(ys[ys.length - 1] + r.h))
        return <div className="cell-sel" style={{ left: t.x + xs[cellSel.c1], top: t.y + ys[cellSel.r1], width: xs[cellSel.c2 + 1] - xs[cellSel.c1], height: ys[cellSel.r2 + 1] - ys[cellSel.r1], transform: t.rot ? `rotate(${t.rot}deg)` : undefined, transformOrigin: `${t.w / 2 - xs[cellSel.c1]}px ${t.h / 2 - ys[cellSel.r1]}px`, borderWidth: 2 / scale }} /> })()}
      {table && (() => { const xs: number[] = []; let ax = 0; table.cols.forEach((w, i) => { ax += w; if (i < table.cols.length - 1) xs.push(ax) }); const ys: number[] = []; let ay = 0; table.rows.forEach((r, i) => { ay += r.h; if (i < table.rows.length - 1) ys.push(ay) })
        return <div style={{ position: 'absolute', left: table.x, top: table.y, width: table.w, height: table.h, transform: table.rot ? `rotate(${table.rot}deg)` : undefined, pointerEvents: 'none' }}>
          {xs.map((x, i) => <div key={`c${i}`} data-grip={`col:${i}`} className="grip col" style={{ left: x - 4 / scale, width: 8 / scale, top: 0, height: '100%' }} />)}
          {ys.map((y, i) => <div key={`r${i}`} data-grip={`row:${i}`} className="grip row" style={{ top: y - 4 / scale, height: 8 / scale, left: 0, width: '100%' }} />)}
        </div> })()}
      {showHandles && frameBox && (
        <div style={{ position: 'absolute', left: frameBox.x, top: frameBox.y, width: frameBox.w, height: frameBox.h, transform: frameBox.rot ? `rotate(${frameBox.rot}deg)` : undefined, pointerEvents: 'none' }}>
          {single?.type === 'line' ? (
            [0, 1].map((i) => { const x = i === 0 ? (single.flipH ? single.w : 0) : single.flipH ? 0 : single.w, y = i === 0 ? (single.flipV ? single.h : 0) : single.flipV ? 0 : single.h; return <div key={i} data-handle={`end${i}`} className="handle" style={{ left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, borderRadius: '50%', cursor: 'crosshair', touchAction: 'none' }} /> })
          ) : (
            <>
              {HANDLES.map((h) => {
                const small = frameBox.w * scale < 40 || frameBox.h * scale < 40
                if (small && (h.hx === 0 || h.hy === 0)) return null
                return <div key={h.id} data-handle={h.id} className="handle" style={{ left: ((h.hx + 1) / 2) * frameBox.w - hs / 2, top: ((h.hy + 1) / 2) * frameBox.h - hs / 2, width: hs, height: hs, cursor: h.cursor, touchAction: 'none' }} />
              })}
              {single && single.type !== 'table' && <><div className="rot-stem" style={{ left: frameBox.w / 2, top: -26 / scale, height: 26 / scale, width: frameLine }} /><div data-handle="rot" className="handle round" title="Rotate" style={{ left: frameBox.w / 2 - hs / 2, top: -26 / scale - hs / 2, width: hs, height: hs, cursor: 'grab', touchAction: 'none' }} /></>}
              {adj && <div data-handle="adj" className="handle adj" title="Adjust" style={{ left: adj.x - hs / 2, top: adj.y - hs / 2, width: hs, height: hs, touchAction: 'none' }} />}
            </>
          )}
        </div>
      )}
      {guides.map((g, i) => <div key={i} className="guide hot" style={{ left: g.x1, top: g.y1, width: g.x1 === g.x2 ? 1 / scale : g.x2 - g.x1, height: g.y1 === g.y2 ? 1 / scale : g.y2 - g.y1 }} />)}
      {marq && <div className="marquee" style={{ left: marq.x, top: marq.y, width: marq.w, height: marq.h, borderWidth: 1 / scale }} />}
      {draw && (tool.kind === 'line'
        ? <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}><line x1={draw.x1} y1={draw.y1} x2={draw.x2} y2={draw.y2} stroke="var(--accent)" strokeWidth={2 / scale} /></svg>
        : <div className="marquee draw" style={{ left: Math.min(draw.x1, draw.x2), top: Math.min(draw.y1, draw.y2), width: Math.abs(draw.x2 - draw.x1), height: Math.abs(draw.y2 - draw.y1), borderWidth: 1.5 / scale }} />)}
    </div>
  )

  return (
    <div className="stage" ref={stage} tabIndex={0} onKeyDown={onKey} data-testid="stage" style={{ padding: pad }}>
      <div className="slide-holder" style={{ width: deck.w * scale, height: deck.h * scale, margin: 'auto' }} data-scale={scale}>
        <SlideView deck={deck} o={o} els={list} bg={bg} under={under} index={target.kind === 'slide' ? deck.slides.indexOf(slide) : undefined} scale={scale} className={'editing-slide' + (target.kind !== 'slide' ? ' master-mode' : '')}>
          {overlayNodes}
        </SlideView>
      </div>
      {target.kind !== 'slide' && <div className="master-banner">{target.kind === 'master' ? 'Editing the slide master: shapes here appear on every slide' : `Editing layout “${deck.layouts.find((l) => l.id === target.id)?.name}”`}<button type="button" className="primary" onClick={() => useStore.setState({ target: { kind: 'slide' }, sel: [] })}>Close master view</button></div>}
    </div>
  )
}

export { findEl, curSlide }
