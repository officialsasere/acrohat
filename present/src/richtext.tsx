import { useLayoutEffect, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { Mark, Extension, mergeAttributes, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { css, type BulletKind, type Para, type PlaceholderRole, type Run, type Text, type TextStyle, type Theme } from './model'
import { fontStack } from '../../shared/fonts'

export const BULLETS: Record<string, string> = { disc: '•', circle: '◦', square: '▪', dash: '–', arrow: '➢', check: '✓' }
const NUM_KINDS = new Set<BulletKind>(['num', 'alpha', 'Alpha', 'roman', 'Roman'])
export const LEVEL_FACTOR = [1, 0.86, 0.72, 0.64, 0.64, 0.64, 0.64, 0.64, 0.64]
export const HANG = 27
export const LEVEL_STEP = 31.5
export const DEFAULT_SIZE = 18

const roman = (n: number) => { const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v } return s }
const alpha = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26) } return s }
export function numberMarker(kind: BulletKind, n: number): string {
  switch (kind) { case 'alpha': return alpha(n) + '.'; case 'Alpha': return alpha(n).toUpperCase() + '.'; case 'roman': return roman(n) + '.'; case 'Roman': return roman(n).toUpperCase() + '.'; default: return n + '.' }
}

export interface Marker { text: string; kind: BulletKind }
/** The bullet or number in front of each paragraph. */
export function markers(items: { bullet?: BulletKind; level?: number }[], st?: TextStyle): (Marker | null)[] {
  const counters: number[] = []
  return items.map((p) => {
    const kind = p.bullet ?? st?.bullet ?? 'none'
    const lvl = p.level ?? 0
    counters.length = Math.min(counters.length, lvl + 1)
    if (kind === 'none') { counters[lvl] = 0; return null }
    if (NUM_KINDS.has(kind)) { counters[lvl] = (counters[lvl] ?? 0) + 1; return { text: numberMarker(kind, counters[lvl]), kind } }
    counters[lvl] = 0
    return { text: BULLETS[kind] ?? '•', kind }
  })
}

export const headFont = (th: Theme) => th.headFont
export function fontFamily(f: string | undefined, th: Theme): string {
  const name = !f || f === '+body' ? th.bodyFont : f === '+head' ? th.headFont : f
  return fontStack(name)
}
export function baseSize(st: TextStyle | undefined, role: PlaceholderRole | undefined, level: number): number {
  const sz = st?.sz ?? DEFAULT_SIZE
  return role === 'body' || role === 'body2' || role === 'object' ? Math.round(sz * (LEVEL_FACTOR[level] ?? 0.64) * 10) / 10 : sz
}

export interface TextCtx { theme: Theme; st?: TextStyle; role?: PlaceholderRole; link?: (url: string) => void }

export function runCss(r: Run, c: TextCtx, level: number): CSSProperties {
  const st = c.st
  const size = r.sz ?? baseSize(st, c.role, level)
  const b = r.b ?? st?.b, i = r.i ?? st?.i
  const out: CSSProperties = {
    fontFamily: fontFamily(r.f ?? st?.f, c.theme),
    fontSize: `calc(var(--fit, 1) * ${size}px)`,
    color: css(r.c ?? st?.c ?? '@text', c.theme, 'inherit'),
  }
  if (b) out.fontWeight = 700
  if (i) out.fontStyle = 'italic'
  const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ')
  if (deco) out.textDecoration = deco
  if (r.hl) out.backgroundColor = css(r.hl, c.theme)
  if (r.base) { out.verticalAlign = r.base > 0 ? 'super' : 'sub'; out.fontSize = `calc(var(--fit, 1) * ${size * 0.65}px)` }
  if (r.link) { out.textDecoration = 'underline'; out.color = css('@link', c.theme) }
  return out
}

export function paraCss(p: { align?: string; lh?: number; before?: number; after?: number; level?: number; bullet?: BulletKind }, st: TextStyle | undefined, firstSize: number): CSSProperties {
  const lvl = p.level ?? 0
  const bullet = (p.bullet ?? st?.bullet ?? 'none') !== 'none'
  const marL = (bullet ? HANG : 0) + LEVEL_STEP * lvl
  return {
    textAlign: (p.align ?? st?.align ?? 'left') as CSSProperties['textAlign'],
    lineHeight: p.lh ?? st?.lh ?? 1.15,
    marginTop: `calc(var(--fit, 1) * ${p.before ?? st?.before ?? 0}px)`,
    marginBottom: `calc(var(--fit, 1) * ${p.after ?? st?.after ?? 0}px)`,
    '--marL': `${marL}px`, '--hang': `${bullet ? HANG : 0}px`, '--mk-sz': `calc(var(--fit, 1) * ${firstSize}px)`,
  } as CSSProperties
}

/** Text drawn statically (slides, thumbnails, the slideshow). Editing uses the editor below, with the same CSS. */
export function TextView({ text, ctx }: { text: Text; ctx: TextCtx }): ReactNode {
  const mk = markers(text.paras, ctx.st)
  return text.paras.map((p, i) => {
    const lvl = p.level ?? 0
    const first = p.runs.find((r) => r.t !== '\n')
    const size = first?.sz ?? baseSize(ctx.st, ctx.role, lvl)
    const fc = css(first?.c ?? ctx.st?.c ?? '@text', ctx.theme, 'inherit')
    return (
      <p key={i} className="pp" data-pi={i} data-m={p.runs.length ? mk[i]?.text ?? '' : ''} data-empty={p.runs.length === 0 || undefined} style={{ ...paraCss(p, ctx.st, size), '--mk-c': fc, '--mk-f': fontFamily(first?.f ?? ctx.st?.f, ctx.theme) } as CSSProperties}>
        {p.runs.map((r, j) => r.t === '\n' ? <br key={j} /> : r.link && ctx.link ? <a key={j} className="run" href={r.link} style={runCss(r, ctx, lvl)} onClick={(e) => { e.preventDefault(); ctx.link!(r.link!) }}>{r.t}</a> : <span key={j} className="run" style={runCss(r, ctx, lvl)}>{r.t}</span>)}
        {p.runs.length === 0 && <br />}
      </p>
    )
  })
}

/** Shrink-on-overflow: finds the largest scale (down to 40%) at which the text fits the box. */
export function useShrink(ref: RefObject<HTMLElement | null>, on: boolean, key: unknown) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.removeProperty('--fit')
    if (!on) return
    const box = el.parentElement
    if (!box) return
    const cs = getComputedStyle(box)
    const room = () => box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    const fits = () => el.scrollHeight <= room() + 1
    if (fits()) return
    let lo = 0.4, hi = 1
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2
      el.style.setProperty('--fit', String(mid))
      if (fits()) lo = mid; else hi = mid
    }
    el.style.setProperty('--fit', String(Math.floor(lo * 100) / 100))
  }, [ref, on, key])
}

// ---------------------------------------------------------------- editing: marks, paragraph attributes, conversion

let editorTheme: Theme | null = null
export const setEditorTheme = (t: Theme) => { editorTheme = t }
const th = () => editorTheme as Theme

const valueMark = (name: string, attr: string, style: (v: never) => string) => Mark.create({
  name,
  addAttributes() { return { [attr]: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) } } },
  parseHTML() { return [{ tag: `span[data-${name}]` }] },
  renderHTML({ HTMLAttributes }) { const v = (HTMLAttributes as Record<string, never>)[attr]; return ['span', mergeAttributes({ [`data-${name}`]: String(v), style: style(v) })] },
})
export const TColor = valueMark('tcolor', 'c', (c: string) => `color:${css(c, th(), 'inherit')}`)
export const THighlight = valueMark('thl', 'c', (c: string) => `background-color:${css(c, th())}`)
export const TFont = valueMark('tfont', 'f', (f: string) => `font-family:${fontFamily(f, th())}`)
export const TSize = valueMark('tsize', 'sz', (s: number) => `font-size:calc(var(--fit, 1) * ${s}px)`)
export const TBold = valueMark('tbold', 'v', (v: string) => `font-weight:${String(v) === 'true' ? 700 : 400}`)
export const TItalic = valueMark('titalic', 'v', (v: string) => `font-style:${String(v) === 'true' ? 'italic' : 'normal'}`)

export const ParaAttrs = Extension.create({
  name: 'paraAttrs',
  addGlobalAttributes() {
    const one = (name: string) => ({ default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`), renderHTML: () => ({}) })
    return [{ types: ['paragraph'], attributes: { align: one('align'), level: one('level'), bullet: one('bullet'), lh: one('lh'), before: one('before'), after: one('after') } }]
  },
})

const markersKey = new PluginKey('markers')
/** Draws bullets and numbers: they depend on neighbouring paragraphs, so they are decorations, not content. */
export const MarkerPlugin = (getStyle: () => TextStyle | undefined) => Extension.create({
  name: 'markers',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: markersKey,
      props: {
        decorations(state) {
          const st = getStyle()
          const items: { pos: number; size: number; node: import('@tiptap/pm/model').Node }[] = []
          state.doc.forEach((node, pos) => items.push({ pos, size: node.nodeSize, node }))
          const empty = state.doc.childCount === 1 && state.doc.firstChild!.content.size === 0
          const mk = markers(items.map((i) => ({ bullet: (i.node.attrs.bullet as BulletKind | null) ?? undefined, level: i.node.attrs.level == null ? 0 : Number(i.node.attrs.level) })), st)
          const ctxTheme = th()
          return DecorationSet.create(state.doc, items.map((it, k) => {
            const a = it.node.attrs
            const lvl = a.level == null ? 0 : Number(a.level)
            let first: { sz?: number; c?: string; f?: string } = {}
            it.node.descendants((n) => { if (n.isText && !first.sz && !first.c && !first.f) { for (const m of n.marks) { if (m.type.name === 'tsize') first.sz = Number(m.attrs.sz); if (m.type.name === 'tcolor') first.c = m.attrs.c; if (m.type.name === 'tfont') first.f = m.attrs.f } } return false })
            first = { ...first }
            const size = first.sz ?? baseSize(st, curRole, lvl)
            const style = paraCss({ align: a.align ?? undefined, lh: a.lh == null ? undefined : Number(a.lh), before: a.before == null ? undefined : Number(a.before), after: a.after == null ? undefined : Number(a.after), level: lvl, bullet: (a.bullet ?? undefined) as BulletKind | undefined }, st, size) as Record<string, string | number>
            style['--mk-c'] = css(first.c ?? st?.c ?? '@text', ctxTheme, 'inherit')
            style['--mk-f'] = fontFamily(first.f ?? st?.f, ctxTheme)
            return Decoration.node(it.pos, it.pos + it.size, { class: 'pp', 'data-m': empty ? '' : mk[k]?.text ?? '', style: Object.entries(style).map(([key, v]) => `${key.startsWith('--') ? key : key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`).join(';') })
          }))
        },
      },
    })]
  },
})
let curRole: PlaceholderRole | undefined
export const setEditorRole = (r: PlaceholderRole | undefined) => { curRole = r }

type M = { type: string; attrs?: Record<string, unknown> }
export function textToDoc(t: Text): JSONContent {
  return {
    type: 'doc',
    content: t.paras.map((p) => {
      const attrs: Record<string, unknown> = {}
      for (const k of ['align', 'level', 'bullet', 'lh', 'before', 'after'] as const) if (p[k] != null) attrs[k] = p[k]
      return {
        type: 'paragraph', attrs,
        content: p.runs.length ? p.runs.map((r): JSONContent => {
          if (r.t === '\n') return { type: 'hardBreak' }
          const marks: M[] = []
          if (r.b != null) marks.push({ type: 'tbold', attrs: { v: r.b } })
          if (r.i != null) marks.push({ type: 'titalic', attrs: { v: r.i } })
          if (r.u) marks.push({ type: 'underline' })
          if (r.s) marks.push({ type: 'strike' })
          if (r.c) marks.push({ type: 'tcolor', attrs: { c: r.c } })
          if (r.sz) marks.push({ type: 'tsize', attrs: { sz: r.sz } })
          if (r.f) marks.push({ type: 'tfont', attrs: { f: r.f } })
          if (r.hl) marks.push({ type: 'thl', attrs: { c: r.hl } })
          if (r.link) marks.push({ type: 'link', attrs: { href: r.link } })
          if (r.base === 1) marks.push({ type: 'superscript' })
          if (r.base === -1) marks.push({ type: 'subscript' })
          return { type: 'text', text: r.t, marks }
        }) : undefined,
      }
    }),
  }
}

export function docToText(doc: JSONContent, prev?: Text): Text {
  const paras: Para[] = (doc.content ?? []).map((p) => {
    const a = (p.attrs ?? {}) as Record<string, string | number | null>
    const para: Para = { runs: [] }
    if (a.align) para.align = a.align as Para['align']
    if (a.level != null) para.level = Number(a.level)
    if (a.bullet) para.bullet = a.bullet as BulletKind
    if (a.lh != null) para.lh = Number(a.lh)
    if (a.before != null) para.before = Number(a.before)
    if (a.after != null) para.after = Number(a.after)
    for (const n of p.content ?? []) {
      if (n.type === 'hardBreak') { para.runs.push({ t: '\n' }); continue }
      if (n.type !== 'text' || !n.text) continue
      const r: Run = { t: n.text }
      for (const m of (n.marks ?? []) as M[]) {
        const v = m.attrs ?? {}
        switch (m.type) {
          case 'tbold': r.b = String(v.v) === 'true'; break
          case 'titalic': r.i = String(v.v) === 'true'; break
          case 'bold': r.b = true; break
          case 'italic': r.i = true; break
          case 'underline': r.u = true; break
          case 'strike': r.s = true; break
          case 'tcolor': r.c = String(v.c); break
          case 'tsize': r.sz = Number(v.sz); break
          case 'tfont': r.f = String(v.f); break
          case 'thl': r.hl = String(v.c); break
          case 'link': r.link = String(v.href); break
          case 'superscript': r.base = 1; break
          case 'subscript': r.base = -1; break
        }
      }
      const last = para.runs[para.runs.length - 1]
      if (last && last.t !== '\n' && sameFmt(last, r)) last.t += r.t; else para.runs.push(r)
    }
    return para
  })
  return { ...prev, paras: paras.length ? paras : [{ runs: [] }] }
}
const sameFmt = (a: Run, b: Run) => (['b', 'i', 'u', 's', 'c', 'sz', 'f', 'hl', 'link', 'base'] as const).every((k) => a[k] === b[k])

/** Apply a change to every run in a text (used for whole-shape formatting when not editing). */
export function mapRuns(t: Text, fn: (r: Run) => Run): Text {
  return { ...t, paras: t.paras.map((p) => ({ ...p, runs: p.runs.map((r) => (r.t === '\n' ? r : fn(r))) })) }
}
export const wordCount = (t: Text) => t.paras.map((p) => p.runs.map((r) => r.t).join('')).join(' ').split(/\s+/).filter(Boolean).length
