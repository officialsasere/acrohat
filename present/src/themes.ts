import { uid, type Deck, type El, type Fill, type Layout, type PlaceholderRole, type ShapeEl, type Slide, type TextStyle, type Theme, mix, hexToRgb, luminance } from './model'

export interface ThemeDef extends Theme {
  /** How the layouts are decorated. */
  style: 'plain' | 'band' | 'side' | 'frame' | 'dark' | 'bold' | 'wave'
  bgFill?: Fill
}
const C = (bg: string, text: string, bg2: string, text2: string, a: string[], link = a[0]): Theme['colors'] => ({ bg, text, bg2, text2, accent1: a[0], accent2: a[1], accent3: a[2], accent4: a[3], accent5: a[4], accent6: a[5], link })

export const THEMES: ThemeDef[] = [
  { id: 'milk', name: 'Milk', style: 'band', headFont: 'Cambria', bodyFont: 'Calibri', colors: C('#fbf6ee', '#2b1d14', '#efe3d0', '#5b4130', ['#8a5a36', '#c58f5c', '#6f8f72', '#d9a441', '#5b7c99', '#b5533c']) },
  { id: 'paper', name: 'Plain', style: 'plain', headFont: 'Calibri', bodyFont: 'Calibri', colors: C('#ffffff', '#222222', '#f1f1f1', '#44546a', ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47']) },
  { id: 'midnight', name: 'Midnight', style: 'dark', headFont: 'Calibri', bodyFont: 'Calibri', colors: C('#14213d', '#f4f1ea', '#1f3260', '#c8d3ee', ['#fca311', '#7aa2f7', '#6ed3a8', '#f07178', '#c792ea', '#ffd166']) },
  { id: 'forest', name: 'Forest', style: 'side', headFont: 'Georgia', bodyFont: 'Calibri', colors: C('#f4f7f1', '#1d2b22', '#dfe9d8', '#3d5a47', ['#2f6b4f', '#8fb339', '#d98e04', '#4a8fa8', '#a8553a', '#7c6a9c']) },
  { id: 'ocean', name: 'Ocean', style: 'wave', headFont: 'Trebuchet MS', bodyFont: 'Calibri', colors: C('#f3f8fb', '#102a3a', '#d8e9f2', '#1e5470', ['#0b7a9e', '#16b3a7', '#f2a33a', '#e0584a', '#6b7fd7', '#7fb069']) },
  { id: 'rose', name: 'Rose', style: 'frame', headFont: 'Garamond', bodyFont: 'Calibri', colors: C('#fff7f6', '#3a1f24', '#f7dede', '#7a3b46', ['#b8445c', '#e08e79', '#7d9d8c', '#d4a45a', '#8a6fa3', '#4f7a94']) },
  { id: 'slate', name: 'Slate', style: 'bold', headFont: 'Arial', bodyFont: 'Arial', colors: C('#eef0f3', '#1c2229', '#d9dde3', '#46515e', ['#2d3e50', '#e4572e', '#17bebb', '#ffc914', '#76b041', '#7b6fb0']) },
  { id: 'graphite', name: 'Graphite', style: 'dark', headFont: 'Arial', bodyFont: 'Arial', colors: C('#1b1b1f', '#f2f2f2', '#2a2a30', '#b9b9c3', ['#6ee7b7', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185']) },
  { id: 'sunrise', name: 'Sunrise', style: 'side', headFont: 'Trebuchet MS', bodyFont: 'Calibri', colors: C('#fffaf0', '#33200f', '#ffe6bf', '#7a4a14', ['#e8590c', '#f59f00', '#c92a2a', '#5f3dc4', '#1098ad', '#37b24d']) },
  { id: 'mono', name: 'Ink', style: 'frame', headFont: 'Times New Roman', bodyFont: 'Arial', colors: C('#ffffff', '#111111', '#ececec', '#555555', ['#111111', '#555555', '#888888', '#bbbbbb', '#333333', '#777777']) },
]

export const getThemeDef = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0]

const W = 960, H = 540

function ph(role: PlaceholderRole, x: number, y: number, w: number, h: number, st: TextStyle, extra: Partial<ShapeEl> = {}): ShapeEl {
  return { id: uid(), type: 'shape', geom: 'rect', x, y, w, h, ph: { role }, st, text: { paras: [{ runs: [] }], v: 'top', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' }, ...extra }
}
function deco(geom: string, x: number, y: number, w: number, h: number, fill: Fill | undefined, extra: Partial<ShapeEl> = {}): ShapeEl {
  return { id: uid(), type: 'shape', geom, x, y, w, h, fill, locked: true, ...extra }
}
const solid = (c: string): Fill => ({ t: 'solid', c })

const TITLE: TextStyle = { sz: 40, f: '+head', c: '@text', b: true, align: 'left' }
const BODY: TextStyle = { sz: 24, f: '+body', c: '@text', bullet: 'disc', align: 'left', before: 8 }

/** The layouts every deck has, decorated to suit the theme's style. */
export function buildLayouts(t: ThemeDef): Layout[] {
  const dark = t.style === 'dark'
  const accent: Fill = solid('@accent1')
  const mk = (id: string, name: string, els: El[], bg?: Fill): Layout => ({ id, name, els, bg })
  const dec = (kind: 'title' | 'content' | 'section'): El[] => {
    switch (t.style) {
      case 'band': return kind === 'content' ? [deco('rect', 0, 0, W, 10, accent), deco('rect', 0, H - 10, W, 10, solid('@bg2'))] : [deco('rect', 0, 0, 24, H, accent), deco('rect', 24, 0, 8, H, solid('@accent2'))]
      case 'side': return kind === 'content' ? [deco('rect', 0, 0, 14, H, accent)] : [deco('rect', 0, 0, 340, H, accent), deco('ellipse', 240, 340, 220, 220, solid('@accent2'), { opacity: 0.35 })]
      case 'frame': return [deco('rect', 24, 24, W - 48, H - 48, undefined, { line: { c: '@accent1', w: kind === 'content' ? 1.25 : 2.5 } })]
      case 'bold': return kind === 'content' ? [deco('rect', 0, 0, W, 96, accent)] : [deco('rect', 0, 300, W, 240, accent)]
      case 'wave': return kind === 'content' ? [deco('wave', 0, H - 56, W, 70, solid('@accent1'), { opacity: 0.85 })] : [deco('wave', 0, H - 190, W, 200, solid('@accent1'), { opacity: 0.85 }), deco('wave', 0, H - 150, W, 170, solid('@accent2'), { opacity: 0.6 })]
      case 'dark': return kind === 'content' ? [deco('rect', 48, 112, 64, 5, accent)] : [deco('rect', 80, 296, 120, 5, accent)]
      default: return kind === 'content' ? [deco('rect', 48, 112, W - 96, 2, solid('@bg2'))] : []
    }
  }
  const titleTop = t.style === 'bold' ? { x: 48, y: 14, w: W - 96, h: 72, st: { ...TITLE, sz: 36, c: '#ffffff' } } : { x: 48, y: 26, w: W - 96, h: 78, st: { ...TITLE, sz: 36 } }
  const body = { x: 48, y: 132, w: W - 96, h: H - 132 - 48 }
  const sideTitle = t.style === 'side'
  const L: Layout[] = [
    mk('title', 'Title slide', [
      ...dec('title'),
      ph('title', sideTitle ? 380 : t.style === 'band' ? 80 : 72, t.style === 'bold' ? 90 : 140, sideTitle ? 540 : W - (t.style === 'band' ? 150 : 144), 150, { ...TITLE, sz: 54, v: undefined } as TextStyle, { text: { paras: [{ runs: [] }], v: 'bottom', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }),
      ph('subtitle', sideTitle ? 380 : t.style === 'band' ? 80 : 72, t.style === 'bold' ? 320 : 305, sideTitle ? 540 : W - (t.style === 'band' ? 150 : 144), 110, { sz: 26, f: '+body', c: t.style === 'bold' ? '#ffffff' : '@text2', align: 'left' }),
    ]),
    mk('titleBody', 'Title and content', [...dec('content'), ph('title', titleTop.x, titleTop.y, titleTop.w, titleTop.h, titleTop.st, { text: { paras: [{ runs: [] }], v: 'middle', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }), ph('body', body.x, body.y, body.w, body.h, BODY)]),
    mk('section', 'Section header', [
      ...dec('section'),
      ph('title', sideTitle ? 380 : 72, 170, sideTitle ? 540 : W - 144, 120, { ...TITLE, sz: 48 }, { text: { paras: [{ runs: [] }], v: 'bottom', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }),
      ph('body', sideTitle ? 380 : 72, 300, sideTitle ? 540 : W - 144, 80, { sz: 24, f: '+body', c: t.style === 'bold' ? '#ffffff' : '@text2', align: 'left' }),
    ]),
    mk('twoContent', 'Two content', [
      ...dec('content'), ph('title', titleTop.x, titleTop.y, titleTop.w, titleTop.h, titleTop.st, { text: { paras: [{ runs: [] }], v: 'middle', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }),
      ph('body', body.x, body.y, (body.w - 24) / 2, body.h, BODY), { ...ph('body2', body.x + (body.w + 24) / 2, body.y, (body.w - 24) / 2, body.h, BODY), ph: { role: 'body2', idx: 1 } },
    ]),
    mk('comparison', 'Comparison', [
      ...dec('content'), ph('title', titleTop.x, titleTop.y, titleTop.w, titleTop.h, titleTop.st, { text: { paras: [{ runs: [] }], v: 'middle', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }),
      ph('body', body.x, body.y, (body.w - 24) / 2, 50, { sz: 24, b: true, f: '+head', c: '@accent1', align: 'left' }),
      ph('body2', body.x + (body.w + 24) / 2, body.y, (body.w - 24) / 2, 50, { sz: 24, b: true, f: '+head', c: '@accent1', align: 'left' }, { ph: { role: 'body2', idx: 1 } }),
      ph('object', body.x, body.y + 54, (body.w - 24) / 2, body.h - 54, BODY, { ph: { role: 'object', idx: 2 } }),
      ph('object', body.x + (body.w + 24) / 2, body.y + 54, (body.w - 24) / 2, body.h - 54, BODY, { ph: { role: 'object', idx: 3 } }),
    ]),
    mk('titleOnly', 'Title only', [...dec('content'), ph('title', titleTop.x, titleTop.y, titleTop.w, titleTop.h, titleTop.st, { text: { paras: [{ runs: [] }], v: 'middle', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } })]),
    mk('pictureCaption', 'Picture with caption', [
      ...dec('content'),
      ph('picture', 48, 132, 520, 360, { sz: 18, c: '@text2', align: 'center' }, { fill: solid('@bg2'), text: { paras: [{ runs: [] }], v: 'middle', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }),
      ph('title', 600, 132, 312, 110, { ...TITLE, sz: 32 }, { text: { paras: [{ runs: [] }], v: 'bottom', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'shrink' } }),
      ph('body', 600, 252, 312, 240, { ...BODY, sz: 20, bullet: 'none' }),
    ]),
    mk('blank', 'Blank', dec('content').filter((_, i) => t.style === 'frame' || i < 0)),
  ]
  void dark
  return L
}

export function makeDeck(themeId = 'milk', title = 'Untitled presentation'): Deck {
  const t = getThemeDef(themeId)
  const { style: _s, bgFill: _b, ...theme } = t
  void _s; void _b
  return { title, w: W, h: H, theme, layouts: buildLayouts(t), slides: [], media: {}, master: { els: [] }, footer: { num: false, text: '', date: false }, show: { loop: false, useTimings: true } }
}

/** A slide from a layout: its placeholders, empty, ready to type into. */
export function slideFromLayout(deck: Deck, layoutId: string): Slide {
  const lay = deck.layouts.find((l) => l.id === layoutId) ?? deck.layouts[1] ?? deck.layouts[0]
  const els = lay.els.filter((e) => e.type === 'shape' && e.ph).map((e) => ({ ...structuredClone(e), id: uid() }) as El)
  return { id: uid(), layout: lay.id, els, notes: '', anims: [] }
}

/** Swap the theme. Colours and fonts are references, so only layouts need rebuilding; slide content stays. */
export function applyTheme(deck: Deck, themeId: string): Deck {
  const t = getThemeDef(themeId)
  const { style: _s, bgFill: _b, ...theme } = t
  void _s; void _b
  const layouts = buildLayouts(t)
  const slides = deck.slides.map((s) => relayout(s, layouts.find((l) => l.id === s.layout) ?? layouts[1], deck.layouts.find((l) => l.id === s.layout)))
  return { ...deck, theme, layouts, slides }
}

/** Move a slide's placeholders onto a layout's, keeping their text; anything with no home keeps its place. */
export function relayout(s: Slide, to: Layout, from?: Layout): Slide {
  const key = (e: El) => (e.ph ? `${e.ph.role}:${e.ph.idx ?? 0}` : '')
  const pool = new Map(to.els.filter((e) => e.ph).map((e) => [key(e), e as ShapeEl]))
  const old = new Map((from?.els ?? []).filter((e) => e.ph).map((e) => [key(e), e as ShapeEl]))
  const used = new Set<string>()
  const els: El[] = s.els.flatMap((e): El[] => {
    if (e.type !== 'shape' || !e.ph) return [e]
    const k = key(e)
    const target = pool.get(k)
    if (!target || used.has(k)) return (e.text?.paras.some((p) => p.runs.length) || e.ph.role === 'picture') ? [e] : []
    used.add(k)
    const was = old.get(k)
    const moved = was && (Math.abs(was.x - e.x) > 1 || Math.abs(was.y - e.y) > 1 || Math.abs(was.w - e.w) > 1 || Math.abs(was.h - e.h) > 1)
    return [{ ...e, ...(moved ? {} : { x: target.x, y: target.y, w: target.w, h: target.h }), st: target.st, text: e.text ? { ...e.text, v: target.text?.v ?? e.text.v } : e.text, fill: target.fill ?? e.fill }]
  })
  // Placeholders the new layout has but the slide lacks.
  for (const [k, e] of pool) if (!used.has(k) && !els.some((x) => x.ph && key(x) === k)) els.push({ ...structuredClone(e), id: uid() } as El)
  return { ...s, layout: to.id, els }
}

export const isDarkTheme = (t: Theme) => luminance(t.colors.bg) < 0.25
export const tint = (c: string, t: number) => (hexToRgb(c) ? mix(c, '#ffffff', t) : c)

/** After a layout's placeholders were edited, slides that still look like the old layout take on the new look (position, size and text style), so a layout is edited once and every slide follows. Anything a person changed on a slide is left alone. */
export function propagateLayout(before: Deck, after: Deck, layoutId: string): Deck {
  const o = before.layouts.find((l) => l.id === layoutId), n = after.layouts.find((l) => l.id === layoutId)
  if (!o || !n || o === n) return after
  const key = (e: El) => (e.ph ? `${e.ph.role}:${e.ph.idx ?? 0}` : '')
  const oldPh = new Map(o.els.filter((e): e is ShapeEl => e.type === 'shape' && !!e.ph).map((e) => [key(e), e]))
  const newPh = new Map(n.els.filter((e): e is ShapeEl => e.type === 'shape' && !!e.ph).map((e) => [key(e), e]))
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  let changed = false
  const slides = after.slides.map((s) => {
    if (s.layout !== layoutId) return s
    let touched = false
    const els = s.els.map((e) => {
      if (e.type !== 'shape' || !e.ph) return e
      const k = key(e), was = oldPh.get(k), now = newPh.get(k)
      if (!was || !now || was === now) return e
      let next: ShapeEl = e
      if (!same(was.st, now.st) && same(e.st, was.st)) next = { ...next, st: now.st }
      if ((was.x !== now.x || was.y !== now.y || was.w !== now.w || was.h !== now.h) && e.x === was.x && e.y === was.y && e.w === was.w && e.h === was.h) next = { ...next, x: now.x, y: now.y, w: now.w, h: now.h }
      if (!same(was.fill, now.fill) && same(e.fill, was.fill)) next = { ...next, fill: now.fill }
      if (was.text?.v !== now.text?.v && e.text?.v === was.text?.v) next = { ...next, text: { ...next.text!, v: now.text?.v } }
      if (next !== e) touched = true
      return next
    })
    if (!touched) return s
    changed = true
    return { ...s, els }
  })
  return changed ? { ...after, slides } : after
}
