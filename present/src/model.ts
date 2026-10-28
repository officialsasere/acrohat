/** The deck: plain, immutable-by-convention data. Every edit builds a new object, so undo is just swapping references.
 *  Slide space is 960 × 540 points (13.33 × 7.5 in); one point = 12700 EMU in a .pptx. */

export type ThemeColor = 'bg' | 'text' | 'bg2' | 'text2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'link'
/** '#rrggbb', 'transparent', or '@name' for a colour of the deck's theme (so a new theme recolours the deck). */
export type Color = string

export interface Theme {
  id: string
  name: string
  colors: Record<ThemeColor, string>
  headFont: string
  bodyFont: string
}

export interface Stop { p: number; c: Color }
export type Fill =
  | { t: 'solid'; c: Color; a?: number }
  | { t: 'grad'; angle: number; stops: Stop[]; radial?: boolean }
  | { t: 'image'; media: string; mode?: 'cover' | 'tile' | 'stretch' }

export type Dash = 'solid' | 'dash' | 'dot' | 'dashDot'
export type ArrowEnd = 'none' | 'triangle' | 'open' | 'oval' | 'diamond' | 'stealth'
export interface Line { c: Color; w: number; dash?: Dash; head?: ArrowEnd; tail?: ArrowEnd; a?: number }
export interface Shadow { c: Color; blur: number; dx: number; dy: number; a: number }

export interface Run {
  t: string
  b?: boolean; i?: boolean; u?: boolean; s?: boolean
  c?: Color; sz?: number; f?: string; hl?: Color
  link?: string
  /** 1 superscript, -1 subscript */
  base?: 1 | -1
}
export type BulletKind = 'none' | 'disc' | 'circle' | 'square' | 'dash' | 'arrow' | 'check' | 'num' | 'alpha' | 'Alpha' | 'roman' | 'Roman'
export interface Para {
  runs: Run[]
  align?: 'left' | 'center' | 'right' | 'justify'
  level?: number
  bullet?: BulletKind
  /** Line height as a multiple, and space before/after in points. */
  lh?: number
  before?: number
  after?: number
}
export interface Text {
  paras: Para[]
  v?: 'top' | 'middle' | 'bottom'
  /** Insets l, t, r, b in points. */
  inset?: [number, number, number, number]
  wrap?: boolean
  fit?: 'none' | 'shrink'
  cols?: number
}

export type PlaceholderRole = 'title' | 'subtitle' | 'body' | 'body2' | 'footer' | 'date' | 'num' | 'picture' | 'object'
export interface Ph { role: PlaceholderRole; idx?: number }

export interface Link { url?: string; slide?: string }

export interface Base {
  id: string
  x: number; y: number; w: number; h: number
  rot?: number
  flipH?: boolean; flipV?: boolean
  name?: string
  alt?: string
  locked?: boolean
  link?: Link
  ph?: Ph
}
/** The look text has when a run or paragraph does not say otherwise (what a placeholder on a layout sets). */
export interface TextStyle { sz?: number; c?: Color; b?: boolean; i?: boolean; f?: string; align?: Para['align']; bullet?: BulletKind; lh?: number; before?: number; after?: number }
export interface ShapeEl extends Base {
  type: 'shape'
  /** Preset geometry name (the same names a .pptx uses), see geom.ts. */
  geom: string
  adj?: number[]
  /** A freeform outline (path in its own w × h space), used for shapes imported from files. */
  cust?: { d: string; w: number; h: number }
  fill?: Fill
  line?: Line
  shadow?: Shadow
  opacity?: number
  text?: Text
  st?: TextStyle
}
export interface LineEl extends Base {
  type: 'line'
  kind: 'straight' | 'elbow' | 'curve'
  line: Line
  shadow?: Shadow
}
export interface ImageEl extends Base {
  type: 'image'
  media: string
  crop?: { l: number; t: number; r: number; b: number }
  geom?: string
  line?: Line
  shadow?: Shadow
  opacity?: number
}
export interface TableCell { text: Text; fill?: Fill; span?: { c: number; r: number }; covered?: boolean; v?: 'top' | 'middle' | 'bottom' }
export interface TableEl extends Base {
  type: 'table'
  cols: number[]
  rows: { h: number; cells: TableCell[] }[]
  style: { header: boolean; banded: boolean; firstCol: boolean; color: Color; borders: boolean }
}
export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar'
export interface ChartSeries { name: string; vals: number[]; color?: Color; xs?: number[] }
export interface ChartEl extends Base {
  type: 'chart'
  kind: ChartKind
  grouping: 'clustered' | 'stacked' | 'percent'
  cats: string[]
  series: ChartSeries[]
  title?: string
  legend: 'none' | 'top' | 'right' | 'bottom'
  labels: boolean
  grid: boolean
  smooth?: boolean
  xTitle?: string
  yTitle?: string
}
export interface MediaEl extends Base {
  type: 'video' | 'audio'
  media: string
  poster?: string
  loop?: boolean
  autoplay?: boolean
}
export interface GroupEl extends Base {
  type: 'group'
  children: El[]
}
export type El = ShapeEl | LineEl | ImageEl | TableEl | ChartEl | MediaEl | GroupEl

export type Effect = 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'grow' | 'spin' | 'pulse' | 'bounce' | 'teeter' | 'color' | 'float' | 'split' | 'blinds'
export type Dir = 'left' | 'right' | 'up' | 'down'
export interface Anim {
  id: string
  target: string
  effect: Effect
  /** Entrance, emphasis or exit. */
  kind: 'in' | 'emph' | 'out'
  trigger: 'click' | 'with' | 'after'
  dur: number
  delay: number
  dir?: Dir
  /** For text boxes: reveal paragraph by paragraph. */
  byPara?: boolean
}

export type TransitionKind = 'none' | 'fade' | 'push' | 'wipe' | 'cover' | 'uncover' | 'zoom' | 'flip' | 'cube' | 'dissolve' | 'split' | 'blinds' | 'morph'
export interface Transition { kind: TransitionKind; dur: number; dir?: Dir }

export interface Slide {
  id: string
  layout: string
  bg?: Fill
  els: El[]
  notes: string
  anims: Anim[]
  trans?: Transition
  hidden?: boolean
  /** Advance by itself after this many seconds. */
  auto?: number
  /** Section heading shown above this slide in the slide list. */
  section?: string
}

export interface Layout {
  id: string
  name: string
  bg?: Fill
  /** Placeholders (with `ph`) and decoration. */
  els: El[]
}

export interface Media { mime: string; data: string; name?: string }

export interface Deck {
  title: string
  w: number
  h: number
  theme: Theme
  layouts: Layout[]
  slides: Slide[]
  media: Record<string, Media>
  /** Slide master: shown behind every layout. */
  master: { bg?: Fill; els: El[] }
  /** Slide numbers, footer and date shown on slides. */
  footer: { num: boolean; text: string; date: boolean }
  /** Show-wide settings. */
  show: { loop: boolean; useTimings: boolean }
}

let counter = 0
export const uid = (p = 'e') => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export const isLine = (e: El): e is LineEl => e.type === 'line'
export const hasText = (e: El): e is ShapeEl => e.type === 'shape'

export const SIZES = {
  wide: { w: 960, h: 540, label: 'Widescreen 16:9' },
  standard: { w: 720, h: 540, label: 'Standard 4:3' },
  tall: { w: 540, h: 960, label: 'Portrait 9:16' },
  a4: { w: 842, h: 595, label: 'A4 landscape' },
  square: { w: 720, h: 720, label: 'Square' },
} as const

/** A colour reference or hex, as a CSS colour. */
export function css(c: Color | undefined, th: Theme, fallback = 'transparent'): string {
  if (!c) return fallback
  if (c[0] === '@') return th.colors[c.slice(1) as ThemeColor] ?? fallback
  return c
}

export function hexToRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h)
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
export const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const mix = (a: string, b: string, t: number) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t) }

export function fillCss(f: Fill | undefined, th: Theme, mediaUrl: (id: string) => string): string {
  if (!f) return 'transparent'
  if (f.t === 'solid') return css(f.c, th)
  if (f.t === 'grad') {
    const stops = f.stops.map((s) => `${css(s.c, th)} ${Math.round(s.p * 100)}%`).join(', ')
    return f.radial ? `radial-gradient(circle, ${stops})` : `linear-gradient(${f.angle + 90}deg, ${stops})`
  }
  const u = mediaUrl(f.media)
  return f.mode === 'tile' ? `url(${u}) 0 0 / auto repeat` : `url(${u}) center / ${f.mode === 'stretch' ? '100% 100%' : 'cover'} no-repeat`
}

export const emptyText = (): Text => ({ paras: [{ runs: [] }] })
export const textOf = (t: Text | undefined) => (t ? t.paras.map((p) => p.runs.map((r) => r.t).join('')).join('\n') : '')
export const plainText = (s: string, run: Omit<Run, 't'> = {}): Text => ({ paras: s.split('\n').map((l) => ({ runs: l ? [{ t: l, ...run }] : [] })) })

/** Walk every element, groups included. */
export function walk(els: El[], fn: (e: El, parent: GroupEl | null) => void, parent: GroupEl | null = null) {
  for (const e of els) { fn(e, parent); if (e.type === 'group') walk(e.children, fn, e) }
}
export function findEl(els: El[], id: string): El | undefined {
  let r: El | undefined
  walk(els, (e) => { if (e.id === id) r = e })
  return r
}
/** Map over elements (children too); returning the same object keeps identity. */
export function mapEls(els: El[], fn: (e: El) => El | null): El[] {
  let changed = false
  const out: El[] = []
  for (const e of els) {
    let n: El | null = e
    if (e.type === 'group') {
      const kids = mapEls(e.children, fn)
      if (kids !== e.children) n = { ...e, children: kids }
    }
    n = n && fn(n)
    if (n !== e) changed = true
    if (n) out.push(n)
  }
  return changed ? out : els
}
export const bounds = (els: El[]) => {
  if (!els.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const e of els) { const b = rotBounds(e); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h) }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
/** Axis-aligned box of a rotated element. */
export function rotBounds(e: Base) {
  const r = ((e.rot ?? 0) * Math.PI) / 180
  if (!r) return { x: e.x, y: e.y, w: e.w, h: e.h }
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const w = e.w * c + e.h * s, h = e.w * s + e.h * c
  return { x: e.x + e.w / 2 - w / 2, y: e.y + e.h / 2 - h / 2, w, h }
}

export function cloneEl<T extends El>(e: T, fresh = true): T {
  const c = structuredClone(e) as T
  if (fresh) renewIds(c)
  return c
}
export function renewIds(e: El) { e.id = uid(); if (e.type === 'group') e.children.forEach(renewIds) }

export function slideTitle(s: Slide): string {
  const shapes = s.els.filter((e): e is ShapeEl => e.type === 'shape')
  const t = shapes.find((e) => e.ph?.role === 'title' && textOf(e.text).trim()) ?? shapes.find((e) => textOf(e.text).trim())
  return textOf(t?.text).trim().split('\n')[0] ?? ''
}
