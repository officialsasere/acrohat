import { rotBounds, type El, type ShapeEl } from '../model'
import { defaultAdj } from '../geom'

export interface Pt { x: number; y: number }
export const rad = (d: number) => (d * Math.PI) / 180
export const rotate = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) })
export type Box = { x: number; y: number; w: number; h: number; rot?: number }
export const center = (e: Box): Pt => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 })

/** Resize handles: direction on each axis (-1 left/top, 1 right/bottom). */
export const HANDLES: { id: string; hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string }[] = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' }, { id: 'n', hx: 0, hy: -1, cursor: 'ns-resize' }, { id: 'ne', hx: 1, hy: -1, cursor: 'nesw-resize' },
  { id: 'e', hx: 1, hy: 0, cursor: 'ew-resize' }, { id: 'se', hx: 1, hy: 1, cursor: 'nwse-resize' }, { id: 's', hx: 0, hy: 1, cursor: 'ns-resize' },
  { id: 'sw', hx: -1, hy: 1, cursor: 'nesw-resize' }, { id: 'w', hx: -1, hy: 0, cursor: 'ew-resize' },
]

/** New box when a handle is dragged to world point P. The opposite side (or the centre with `fromCenter`) stays put. */
export function resizeBox(e: Box, hx: number, hy: number, P: Pt, o: { keepAspect?: boolean; fromCenter?: boolean; minSize?: number } = {}): { x: number; y: number; w: number; h: number } {
  const min = o.minSize ?? 4
  const r = rad(e.rot ?? 0)
  const C = center(e)
  const anchorLocal: Pt = o.fromCenter ? { x: 0, y: 0 } : { x: (-hx * e.w) / 2, y: (-hy * e.h) / 2 }
  const A = o.fromCenter ? C : (() => { const a = rotate(anchorLocal, r); return { x: C.x + a.x, y: C.y + a.y } })()
  const v = rotate({ x: P.x - A.x, y: P.y - A.y }, -r)
  const k = o.fromCenter ? 2 : 1
  let w = hx ? Math.max(min, hx * v.x * k) : e.w
  let h = hy ? Math.max(min, hy * v.y * k) : e.h
  if (o.keepAspect && e.w > 0 && e.h > 0) {
    const ratio = e.w / e.h
    if (hx && hy) { if (w / e.w > h / e.h) h = w / ratio; else w = h * ratio }
    else if (hx) h = w / ratio
    else w = h * ratio
  }
  if (o.fromCenter) return { x: C.x - w / 2, y: C.y - h / 2, w, h }
  const a2 = rotate({ x: (-hx * w) / 2, y: (-hy * h) / 2 }, r)
  const cx = A.x - a2.x, cy = A.y - a2.y
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export interface SnapResult { dx: number; dy: number; guides: { x1: number; y1: number; x2: number; y2: number }[] }
/** Nudge a moving box so its edges and centre meet other elements' (or the slide's). */
export function snapBox(box: { x: number; y: number; w: number; h: number }, others: El[], slide: { w: number; h: number }, thresh: number): SnapResult {
  const xs = [0, slide.w / 2, slide.w], ys = [0, slide.h / 2, slide.h]
  for (const o of others) { const b = rotBounds(o); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h) }
  const mx = [box.x, box.x + box.w / 2, box.x + box.w], my = [box.y, box.y + box.h / 2, box.y + box.h]
  let bestX: number | null = null, bestY: number | null = null
  for (const m of mx) for (const t of xs) { const d = t - m; if (Math.abs(d) <= thresh && (bestX === null || Math.abs(d) < Math.abs(bestX))) bestX = d }
  for (const m of my) for (const t of ys) { const d = t - m; if (Math.abs(d) <= thresh && (bestY === null || Math.abs(d) < Math.abs(bestY))) bestY = d }
  const dx = bestX ?? 0, dy = bestY ?? 0
  const guides: SnapResult['guides'] = []
  if (bestX !== null) for (const m of mx) for (const t of xs) if (Math.abs(t - (m + dx)) < 0.01) guides.push({ x1: t, y1: 0, x2: t, y2: slide.h })
  if (bestY !== null) for (const m of my) for (const t of ys) if (Math.abs(t - (m + dy)) < 0.01) guides.push({ x1: 0, y1: t, x2: slide.w, y2: t })
  return { dx, dy, guides }
}

/** Yellow "adjust" handle for shapes that have one: where it sits, and how dragging it changes the adjust value. */
export function adjHandle(e: ShapeEl): { x: number; y: number; set: (p: Pt) => number[] } | null {
  const def = defaultAdj(e.geom)
  if (!def) return null
  const a = def.map((d, i) => e.adj?.[i] ?? d)
  const ss = Math.min(e.w, e.h)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const put = (i: number, v: number) => a.map((x, k) => (k === i ? Math.round(v) : x))
  switch (e.geom) {
    case 'roundRect': case 'round1Rect': case 'round2SameRect': case 'snip1Rect': case 'snip2SameRect': case 'plaque': case 'foldedCorner':
      return { x: (ss * a[0]) / 100000, y: 0, set: (p) => put(0, clamp((p.x / ss) * 100000, 0, 50000)) }
    case 'triangle': return { x: (e.w * a[0]) / 100000, y: 0, set: (p) => put(0, clamp((p.x / e.w) * 100000, 0, 100000)) }
    case 'parallelogram': case 'trapezoid': case 'hexagon': case 'octagon': case 'plus': case 'frame': case 'donut': case 'bevel': case 'cube': case 'can': case 'mathPlus': case 'mathMinus': case 'mathMultiply':
      return { x: (ss * a[0]) / 100000, y: e.geom === 'can' ? (e.h * a[0]) / 200000 : 0, set: (p) => put(0, clamp(((e.geom === 'can' ? p.y * 2 : p.x) / (e.geom === 'can' ? e.h : ss)) * 100000, 0, 100000)) }
    case 'chevron': case 'homePlate': return { x: e.w - (ss * a[0]) / 100000, y: 0, set: (p) => put(0, clamp(((e.w - p.x) / ss) * 100000, 0, 100000)) }
    case 'rightArrow': case 'leftArrow': case 'leftRightArrow': case 'notchedRightArrow':
      return { x: e.geom === 'leftArrow' ? (ss * a[1]) / 100000 : e.w - (ss * a[1]) / 100000, y: (e.h * (100000 - a[0])) / 200000, set: (p) => { const nx = e.geom === 'leftArrow' ? p.x : e.w - p.x; return a.map((x, k) => (k === 1 ? Math.round(clamp((nx / ss) * 100000, 0, 100000)) : k === 0 ? Math.round(clamp(100000 - (p.y / e.h) * 200000, 0, 100000)) : x)) } }
    case 'upArrow': case 'downArrow': case 'upDownArrow':
      return { x: (e.w * (100000 - a[0])) / 200000, y: e.geom === 'upArrow' ? (ss * a[1]) / 100000 : e.h - (ss * a[1]) / 100000, set: (p) => { const ny = e.geom === 'upArrow' ? p.y : e.h - p.y; return a.map((x, k) => (k === 1 ? Math.round(clamp((ny / ss) * 100000, 0, 100000)) : k === 0 ? Math.round(clamp(100000 - (p.x / e.w) * 200000, 0, 100000)) : x)) } }
    case 'wedgeRectCallout': case 'wedgeRoundRectCallout': case 'wedgeEllipseCallout': case 'cloudCallout':
      return { x: e.w / 2 + (e.w * a[0]) / 100000, y: e.h / 2 + (e.h * a[1]) / 100000, set: (p) => a.map((x, k) => (k === 0 ? Math.round(((p.x - e.w / 2) / e.w) * 100000) : k === 1 ? Math.round(((p.y - e.h / 2) / e.h) * 100000) : x)) }
    default:
      if (/^star\d+$/.test(e.geom)) return { x: e.w / 2, y: (e.h / 2) * (1 - a[0] / 50000), set: (p) => put(0, clamp((1 - p.y / (e.h / 2)) * 50000, 2000, 50000)) }
      return null
  }
}
