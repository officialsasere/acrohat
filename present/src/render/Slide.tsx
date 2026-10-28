import { memo, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { css, fillCss, type Deck, type El, type Fill, type GroupEl, type ImageEl, type LineEl, type Link, type MediaEl, type ShapeEl, type TableEl, type Theme } from '../model'
import { scaleCustPath, shapePath, textBox } from '../geom'
import { TextView, useShrink, type TextCtx } from '../richtext'
import { ChartView } from './Chart'

export const mediaUrl = (media: Deck['media']) => (id: string) => media[id]?.data ?? ''

export interface ViewOpts {
  theme: Theme
  media: Deck['media']
  /** Draw "Click to add title" in empty placeholders (the editor, not the show). */
  prompts?: boolean
  /** Elements to leave out (not yet revealed by an animation). */
  hide?: Set<string>
  /** Replace an element's text with something live (the text editor). */
  liveText?: (el: ShapeEl | TableEl, cell?: { r: number; c: number }) => ReactNode | null
  onLink?: (l: Link) => void
  /** Called with each drawn element's DOM node, for animations and hit tests. */
  interactive?: boolean
  /** Elements being edited: draw their text through liveText. */
  editingId?: string | null
}

const TODAY = new Date().toLocaleDateString()
const PROMPTS: Record<string, string> = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text', body2: 'Click to add text', object: 'Click to add text', picture: 'Picture', footer: 'Footer', date: 'Date', num: '#' }

export function lineCss(l: { c: string; w: number; dash?: string; a?: number } | undefined, th: Theme) {
  if (!l || l.w <= 0) return { stroke: 'none' }
  const w = l.w
  return {
    stroke: css(l.c, th), strokeWidth: w, strokeOpacity: l.a ?? 1,
    strokeDasharray: l.dash === 'dash' ? `${w * 4} ${w * 3}` : l.dash === 'dot' ? `${w} ${w * 2}` : l.dash === 'dashDot' ? `${w * 4} ${w * 2} ${w} ${w * 2}` : undefined,
    strokeLinecap: l.dash === 'dot' ? 'round' as const : undefined,
  }
}
const shadowCss = (s: { c: string; blur: number; dx: number; dy: number; a: number } | undefined, th: Theme) => (s ? `drop-shadow(${s.dx}px ${s.dy}px ${s.blur}px ${withAlpha(css(s.c, th), s.a)})` : undefined)
export function withAlpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return c
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function boxStyle(e: El): CSSProperties {
  const sx = e.flipH ? -1 : 1, sy = e.flipV ? -1 : 1
  const t = [e.rot ? `rotate(${e.rot}deg)` : '', sx < 0 || sy < 0 ? `scale(${sx},${sy})` : ''].filter(Boolean).join(' ')
  return { left: e.x, top: e.y, width: e.w, height: e.h, transform: t || undefined }
}

function GradDef({ id, f, th }: { id: string; f: Extract<Fill, { t: 'grad' }>; th: Theme }) {
  const stops = f.stops.map((s, i) => <stop key={i} offset={`${s.p * 100}%`} stopColor={css(s.c, th)} />)
  if (f.radial) return <radialGradient id={id}>{stops}</radialGradient>
  return <linearGradient id={id} gradientTransform={`rotate(${f.angle} .5 .5)`}>{stops}</linearGradient>
}

function ShapeView({ el, o }: { el: ShapeEl; o: ViewOpts }) {
  const th = o.theme
  const id = useId().replace(/:/g, '')
  const p = el.cust ? { d: scaleCustPath(el.cust.d, el.w / el.cust.w, el.h / el.cust.h), open: false } as ReturnType<typeof shapePath> : shapePath(el.geom, el.w, el.h, el.adj)
  const f = el.fill
  const media = mediaUrl(o.media)
  const ln = lineCss(el.line, th)
  const paint = !f || p.open ? 'none' : f.t === 'solid' ? css(f.c, th) : f.t === 'grad' ? `url(#g${id})` : 'none'
  const imgFill = f?.t === 'image' && !p.open
  const live = o.liveText?.(el)
  const empty = !el.text || el.text.paras.every((x) => x.runs.length === 0)
  const [il, it, ir, ib] = textBox(el.geom, el.w, el.h, el.adj)
  const ins = el.text?.inset ?? [7.2, 3.6, 7.2, 3.6]
  const ctx: TextCtx = { theme: th, st: el.st, role: el.ph?.role, link: o.onLink ? (url) => o.onLink!({ url }) : undefined }
  const ref = useRef<HTMLDivElement>(null)
  useShrink(ref, el.text?.fit === 'shrink' && !live, el.text)
  const filter = shadowCss(el.shadow, th)
  return (
    <div className="el" data-el={el.id} style={{ ...boxStyle(el), opacity: el.opacity, filter }}>
      <svg className="shape-svg" width={el.w} height={el.h} style={{ overflow: 'visible' }} data-hit={el.fill || el.line || !empty ? undefined : 'none'}>
        {f?.t === 'grad' && <defs><GradDef id={`g${id}`} f={f} th={th} /></defs>}
        {imgFill && <defs><clipPath id={`c${id}`}><path d={p.d} /></clipPath></defs>}
        {imgFill && f?.t === 'image' && <foreignObject x="0" y="0" width={el.w} height={el.h} clipPath={`url(#c${id})`}><div style={{ width: '100%', height: '100%', background: fillCss(f, th, media) }} /></foreignObject>}
        <path d={p.d} fill={paint} fillOpacity={f?.t === 'solid' ? f.a ?? 1 : 1} fillRule="evenodd" {...ln} strokeLinejoin="miter" />
        {p.detail && <path d={p.detail} fill="none" {...ln} stroke={ln.stroke === 'none' ? 'none' : ln.stroke} />}
      </svg>
      {(el.text || live || (o.prompts && el.ph)) && (
        <div className="el-text" style={{ left: il, top: it, right: ir, bottom: ib, padding: `${ins[1]}px ${ins[2]}px ${ins[3]}px ${ins[0]}px`, justifyContent: el.text?.v === 'middle' ? 'center' : el.text?.v === 'bottom' ? 'flex-end' : 'flex-start', whiteSpace: el.text?.wrap === false ? 'pre' : undefined }}>
          <div ref={ref} className="tv" style={el.text?.cols && el.text.cols > 1 ? { columnCount: el.text.cols, columnGap: 24 } : undefined}>
            {live ?? (empty && o.prompts && el.ph ? <p className="pp prompt" style={{ color: css('@text2', th), opacity: 0.55, fontSize: (el.st?.sz ?? 18) * 0.9, fontFamily: undefined, textAlign: el.st?.align }}>{PROMPTS[el.ph.role] ?? ''}</p> : el.text && <TextView text={el.text} ctx={ctx} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function arrowPath(kind: string, s: number): { d: string; fill: boolean; w: number } {
  const k = Math.max(s, 1.5) * 1
  switch (kind) {
    case 'triangle': return { d: `M0 ${-k * 1.6}L${k * 3.2} 0L0 ${k * 1.6}Z`, fill: true, w: k * 3.2 }
    case 'stealth': return { d: `M0 ${-k * 1.8}L${k * 3.6} 0L0 ${k * 1.8}L${k * 1.2} 0Z`, fill: true, w: k * 3.6 }
    case 'open': return { d: `M${k * 0.2} ${-k * 1.8}L${k * 3} 0L${k * 0.2} ${k * 1.8}`, fill: false, w: k * 3 }
    case 'oval': return { d: `M0 0m${-k * 1.5} 0a${k * 1.5} ${k * 1.5} 0 1 0 ${k * 3} 0a${k * 1.5} ${k * 1.5} 0 1 0 ${-k * 3} 0Z`, fill: true, w: k * 1.5 }
    case 'diamond': return { d: `M${-k * 2} 0L0 ${-k * 1.6}L${k * 2} 0L0 ${k * 1.6}Z`, fill: true, w: k * 2 }
    default: return { d: '', fill: false, w: 0 }
  }
}

/** The path a line or connector follows inside its box. */
export function linePathD(e: LineEl): string {
  const { w, h } = e
  if (e.kind === 'elbow') return `M0 0H${w / 2}V${h}H${w}`
  if (e.kind === 'curve') return `M0 0C${w / 2} 0 ${w / 2} ${h} ${w} ${h}`
  return `M0 0L${w} ${h}`
}

function LineView({ el, o }: { el: LineEl; o: ViewOpts }) {
  const th = o.theme
  const d = linePathD(el)
  const ln = lineCss(el.line, th)
  const w = el.line.w
  const stroke = css(el.line.c, th)
  // Arrowheads are drawn at the ends, turned to follow the path's direction there.
  const dirStart = el.kind === 'straight' ? Math.atan2(el.h, el.w) + Math.PI : el.kind === 'elbow' ? Math.PI : Math.atan2(0, -1)
  const dirEnd = el.kind === 'straight' ? Math.atan2(el.h, el.w) : 0
  const head = arrowPath(el.line.head ?? 'none', w), tail = arrowPath(el.line.tail ?? 'none', w)
  return (
    <div className="el" data-el={el.id} style={{ ...boxStyle(el), filter: shadowCss(el.shadow, th) }}>
      <svg width={Math.max(el.w, 1)} height={Math.max(el.h, 1)} style={{ overflow: 'visible' }}>
        <path d={d} fill="none" {...ln} strokeLinecap={ln.strokeLinecap ?? 'butt'} strokeLinejoin="round" />
        {head.d && <path d={head.d} transform={`translate(0 0) rotate(${(dirStart * 180) / Math.PI})`} fill={head.fill ? stroke : 'none'} stroke={stroke} strokeWidth={head.fill ? 0 : w} strokeLinejoin="round" strokeLinecap="round" />}
        {tail.d && <path d={tail.d} transform={`translate(${el.w} ${el.h}) rotate(${(dirEnd * 180) / Math.PI})`} fill={tail.fill ? stroke : 'none'} stroke={stroke} strokeWidth={tail.fill ? 0 : w} strokeLinejoin="round" strokeLinecap="round" />}
        <path className="line-hit" d={d} fill="none" stroke="transparent" strokeWidth={Math.max(w + 10, 12)} />
      </svg>
    </div>
  )
}

function ImageView({ el, o }: { el: ImageEl; o: ViewOpts }) {
  const th = o.theme
  const src = mediaUrl(o.media)(el.media)
  const c = el.crop ?? { l: 0, t: 0, r: 0, b: 0 }
  const iw = el.w / Math.max(0.01, 1 - c.l - c.r), ih = el.h / Math.max(0.01, 1 - c.t - c.b)
  const clip = el.geom && el.geom !== 'rect' ? `path('${shapePath(el.geom, el.w, el.h).d}')` : undefined
  const ln = el.line && el.line.w > 0 ? el.line : undefined
  return (
    <div className="el" data-el={el.id} style={{ ...boxStyle(el), opacity: el.opacity, filter: shadowCss(el.shadow, th) }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', clipPath: clip }}>
        {src ? <img src={src} alt={el.alt ?? ''} draggable={false} style={{ position: 'absolute', left: -c.l * iw, top: -c.t * ih, width: iw, height: ih, maxWidth: 'none', userSelect: 'none' }} /> : <div style={{ width: '100%', height: '100%', background: '#ddd' }} />}
      </div>
      {ln && <svg width={el.w} height={el.h} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}><path d={shapePath(el.geom ?? 'rect', el.w, el.h).d} fill="none" {...lineCss(ln, th)} /></svg>}
    </div>
  )
}

function MediaView({ el, o }: { el: MediaEl; o: ViewOpts }) {
  const src = mediaUrl(o.media)(el.media)
  return (
    <div className="el" data-el={el.id} style={{ ...boxStyle(el), background: el.type === 'video' ? '#000' : 'transparent' }}>
      {el.type === 'video'
        ? <video src={src} controls={!!o.interactive} loop={el.loop} autoPlay={o.interactive && el.autoplay} style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: o.interactive ? 'auto' : 'none' }} />
        : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: css('@bg2', o.theme), borderRadius: 8 }}>{o.interactive ? <audio src={src} controls loop={el.loop} autoPlay={el.autoplay} /> : <span style={{ fontSize: 28 }}>🔊</span>}</div>}
    </div>
  )
}

const contrast = (bg: string) => { const m = /^#([0-9a-f]{6})$/i.exec(bg); if (!m) return '#000'; const n = parseInt(m[1], 16); return ((((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000) > 150 ? '#1b1b1b' : '#ffffff' }
export function cellLook(t: TableEl, r: number, c: number, th: Theme): { bg: string; fg: string } {
  const base = css(t.style.color, th)
  const header = t.style.header && r === 0
  const first = t.style.firstCol && c === 0
  const row = t.style.header ? r - 1 : r
  const band = t.style.banded && !header && row % 2 === 0
  const tint = (a: number) => { const m = /^#([0-9a-f]{6})$/i.exec(base); if (!m) return base; const n = parseInt(m[1], 16), mixc = (v: number) => Math.round(v + (255 - v) * a); return `rgb(${mixc((n >> 16) & 255)},${mixc((n >> 8) & 255)},${mixc(n & 255)})` }
  const bg = header || first ? base : band ? tint(0.82) : tint(0.92)
  const bgHex = header || first ? base : css('@bg', th)
  return { bg, fg: header || first ? contrast(bgHex) : css('@text', th) }
}

function TableView({ el, o }: { el: TableEl; o: ViewOpts }) {
  const th = o.theme
  const media = mediaUrl(o.media)
  return (
    <div className="el" data-el={el.id} style={boxStyle(el)}>
      <table style={{ width: el.w, height: el.h, tableLayout: 'fixed', borderCollapse: 'collapse', position: 'absolute', inset: 0 }}>
        <colgroup>{el.cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <tbody>
          {el.rows.map((row, r) => (
            <tr key={r} style={{ height: row.h }}>
              {row.cells.map((cell, c) => {
                if (cell.covered) return null
                const look = cellLook(el, r, c, th)
                const live = o.liveText?.(el, { r, c })
                return (
                  <td key={c} rowSpan={cell.span?.r} colSpan={cell.span?.c} style={{ background: cell.fill ? fillCss(cell.fill, th, media) : look.bg, border: el.style.borders ? `1px solid ${css('@bg', th)}` : 'none', verticalAlign: cell.v ?? 'middle', padding: '4px 8px', overflow: 'hidden' }}>
                    {live ?? <TextView text={cell.text} ctx={{ theme: th, st: { sz: 18, c: cell.fill ? undefined : look.fg, b: el.style.header && r === 0 ? true : undefined }, link: o.onLink ? (url) => o.onLink!({ url }) : undefined }} />}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupView({ el, o }: { el: GroupEl; o: ViewOpts }) {
  return (
    <div className="el" data-el={el.id} style={boxStyle(el)}>
      <div style={{ position: 'absolute', left: -el.x, top: -el.y }}>
        {el.children.map((c) => <ElView key={c.id} el={c} o={o} />)}
      </div>
    </div>
  )
}

export const ElView = memo(function ElView({ el, o }: { el: El; o: ViewOpts }): ReactNode {
  if (o.hide?.has(el.id)) return null
  const inner = ((): ReactNode => {
    switch (el.type) {
      case 'shape': return <ShapeView el={el} o={o} />
      case 'line': return <LineView el={el} o={o} />
      case 'image': return <ImageView el={el} o={o} />
      case 'table': return <TableView el={el} o={o} />
      case 'group': return <GroupView el={el} o={o} />
      case 'video': case 'audio': return <MediaView el={el} o={o} />
      case 'chart': return <div className="el" data-el={el.id} style={boxStyle(el)}><ChartView chart={el} th={o.theme} /></div>
    }
  })()
  if (o.onLink && el.link) {
    return <div className="link-wrap" onClick={() => o.onLink!(el.link!)} style={{ cursor: 'pointer' }}>{inner}</div>
  }
  return inner
}, (a, b) => a.el === b.el && a.o.theme === b.o.theme && a.o.media === b.o.media && a.o.prompts === b.o.prompts && a.o.hide === b.o.hide && a.o.liveText === b.o.liveText && a.o.onLink === b.o.onLink && a.o.interactive === b.o.interactive && a.o.editingId === b.o.editingId)

export function resolveBg(deck: Deck, layoutId: string | undefined, own?: Fill): Fill {
  const lay = deck.layouts.find((l) => l.id === layoutId)
  return own ?? lay?.bg ?? deck.master.bg ?? { t: 'solid', c: '@bg' }
}

export interface SlideViewProps {
  deck: Deck
  o: ViewOpts
  els: El[]
  bg: Fill
  /** Static layers drawn under the slide's own elements: master, then layout decoration. */
  under?: El[][]
  index?: number
  scale?: number
  className?: string
  children?: ReactNode
}

/** A slide drawn at 960 × 540 (or the deck's size) and scaled. The same component draws thumbnails, the editor and the show. */
export const SlideView = memo(function SlideView({ deck, o, els, bg, under, index, scale = 1, className, children }: SlideViewProps) {
  const th = deck.theme
  const so = { ...o, prompts: false, liveText: undefined, hide: o.hide }
  const showNum = deck.footer.num && index != null
  const foot = (x: number, w: number, a: 'left' | 'center' | 'right', t: string, k: string) => <div key={k} style={{ position: 'absolute', left: x, top: deck.h - 40, width: w, height: 26, textAlign: a, color: css('@text2', th), fontSize: 12, fontFamily: undefined, opacity: 0.8 }}>{t}</div>
  return (
    <div className={'slide ' + (className ?? '')} style={{ width: deck.w * scale, height: deck.h * scale }}>
      <div className="slide-inner" style={{ width: deck.w, height: deck.h, transform: `scale(${scale})`, background: fillCss(bg, th, mediaUrl(deck.media)) }}>
        {under?.map((layer, i) => layer.map((e) => <ElView key={`u${i}${e.id}`} el={e} o={so} />))}
        {deck.footer.text && index != null && foot(deck.w / 2 - 200, 400, 'center', deck.footer.text, 'f')}
        {deck.footer.date && index != null && foot(48, 200, 'left', TODAY, 'd')}
        {showNum && foot(deck.w - 148, 100, 'right', String(index! + 1), 'n')}
        {els.map((e) => <ElView key={e.id} el={e} o={o} />)}
        {children}
      </div>
    </div>
  )
})
