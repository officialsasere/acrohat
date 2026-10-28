import type { Rect } from './engine/types'

/** What is selected: one or more rectangles, and the cell that receives typing. */
export interface Sel {
  ranges: Rect[]
  /** The active cell. */
  r: number
  c: number
  /** The fixed corner of the newest rectangle while it is being extended. */
  ar: number
  ac: number
}
export const single = (r: number, c: number): Sel => ({ ranges: [{ r1: r, c1: c, r2: r, c2: c }], r, c, ar: r, ac: c })
export const rectOf = (r1: number, c1: number, r2: number, c2: number): Rect => ({ r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) })
export const lastRange = (s: Sel): Rect => s.ranges[s.ranges.length - 1]
export const contains = (g: Rect, r: number, c: number) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2
export const inSel = (s: Sel, r: number, c: number) => s.ranges.some((g) => contains(g, r, c))
export const union = (a: Rect, b: Rect): Rect => ({ r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) })
export const intersects = (a: Rect, b: Rect) => !(a.r2 < b.r1 || a.r1 > b.r2 || a.c2 < b.c1 || a.c1 > b.c2)
export const area = (g: Rect) => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)
