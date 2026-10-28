import { strFromU8, unzipSync } from 'fflate'
import { attr, parseXml, type XEl } from '../../../shared/xml'
import { uid, hexToRgb, rgbToHex, type Anim, type BulletKind, type ChartEl, type ChartKind, type ChartSeries, type Color, type Deck, type Dir, type Effect, type El, type Fill, type Layout, type Line, type Para, type Run, type ShapeEl, type Shadow, type Slide, type TableCell, type TableEl, type Text, type TextStyle, type Theme, type Transition, type TransitionKind } from '../model'
import { makeDeck } from '../themes'
import { fingerprint } from './pptxWrite'
import { ANIM_BY_ID, ARROW_IN, CHAR_IN, DASH_IN, EXT_MIME, NUM_IN, SCHEME_REV, bytesToDataUrl, pt } from './ooxml'

// ---------------------------------------------------------------- small XML helpers (namespace prefixes are ignored)

const L = (e: XEl) => (e.name.includes(':') ? e.name.slice(e.name.indexOf(':') + 1) : e.name)
const kidsL = (e: XEl | undefined, n: string) => (e ? e.children.filter((c) => L(c) === n) : [])
const kidL = (e: XEl | undefined, n: string) => e?.children.find((c) => L(c) === n)
const pathL = (e: XEl | undefined, ...names: string[]) => names.reduce<XEl | undefined>((x, n) => kidL(x, n), e)
const descL = (e: XEl | undefined, n: string): XEl | undefined => { if (!e) return undefined; for (const c of e.children) { if (L(c) === n) return c; const r = descL(c, n); if (r) return r } return undefined }
const allDesc = (e: XEl | undefined, n: string, out: XEl[] = []): XEl[] => { if (e) for (const c of e.children) { if (L(c) === n) out.push(c); allDesc(c, n, out) } return out }
/** The relationship id of a part reference (r:id), not a numeric id attribute. */
const rId = (e: XEl | undefined) => e?.attrs['r:id'] ?? attr(e, 'id')
const numAttr = (e: XEl | undefined, n: string) => { const v = attr(e, n); return v === undefined || v === '' ? undefined : Number(v) }
const textOfEl = (e: XEl | undefined): string => (e ? e.text + e.children.map(textOfEl).join('') : '')

type Files = Record<string, Uint8Array>
interface RelInfo { type: string; target: string; external: boolean }
function dirOf(p: string) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i) }
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dirOf(base) ? dirOf(base).split('/') : []).concat(target.split('/'))
  const out: string[] = []
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p) }
  return out.join('/')
}

class Pkg {
  constructor(public files: Files) {}
  xml(path: string): XEl | undefined { const f = this.files[path]; return f ? parseXml(strFromU8(f)) : undefined }
  rels(part: string): Map<string, RelInfo> {
    const rp = `${dirOf(part)}/_rels/${part.split('/').pop()}.rels`
    const x = this.xml(rp)
    const m = new Map<string, RelInfo>()
    for (const r of kidsL(x, 'Relationship')) m.set(r.attrs.Id, { type: r.attrs.Type, target: r.attrs.TargetMode === 'External' ? r.attrs.Target : resolve(part, r.attrs.Target), external: r.attrs.TargetMode === 'External' })
    return m
  }
}

// ---------------------------------------------------------------- colours

const SYS: Record<string, string> = { windowText: '000000', window: 'FFFFFF' }
const PRESET: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', lime: '00FF00', cyan: '00FFFF', magenta: 'FF00FF' }
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = (t: number) => { t = (t + 1) % 1; return (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p) * 255 }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)]
}

interface ColorCtx { theme: Record<string, string>; map: Record<string, string> }
/** A colour element (srgbClr, schemeClr, …) as our colour: a theme reference when plain, a hex when it was lightened or darkened. */
function colorOf(el: XEl | undefined, cc: ColorCtx, override?: string): { c: Color; a?: number } | null {
  if (!el) return null
  const kind = L(el)
  const mods = el.children
  let base: string | null = null
  let ref: string | null = null
  if (kind === 'srgbClr') base = attr(el, 'val') ?? '000000'
  else if (kind === 'sysClr') base = attr(el, 'lastClr') ?? SYS[attr(el, 'val') ?? ''] ?? '000000'
  else if (kind === 'prstClr') base = PRESET[attr(el, 'val') ?? ''] ?? '000000'
  else if (kind === 'schemeClr') {
    let v = override ?? attr(el, 'val') ?? 'tx1'
    if (v === 'phClr') v = override ?? 'accent1'
    const mapped = cc.map[v] ?? v
    ref = SCHEME_REV[v] ? v : mapped
    base = cc.theme[mapped] ?? cc.theme[v] ?? '000000'
  } else return null
  let alpha: number | undefined
  let r = hexToRgb('#' + base)
  let modified = false
  for (const m of mods) {
    const v = Number(attr(m, 'val') ?? 0) / 100000
    switch (L(m)) {
      case 'alpha': alpha = v; break
      case 'lumMod': { const [h, s, l] = rgbToHsl(...r); r = hslToRgb(h, s, Math.min(1, l * v)); modified = true; break }
      case 'lumOff': { const [h, s, l] = rgbToHsl(...r); r = hslToRgb(h, s, Math.min(1, Math.max(0, l + v))); modified = true; break }
      case 'tint': r = [r[0] + (255 - r[0]) * (1 - v), r[1] + (255 - r[1]) * (1 - v), r[2] + (255 - r[2]) * (1 - v)]; modified = true; break
      case 'shade': r = [r[0] * v, r[1] * v, r[2] * v]; modified = true; break
      case 'satMod': { const [h, s, l] = rgbToHsl(...r); r = hslToRgb(h, Math.min(1, s * v), l); modified = true; break }
    }
  }
  if (ref && !modified && SCHEME_REV[ref]) return { c: '@' + SCHEME_REV[ref], a: alpha }
  return { c: rgbToHex(...r), a: alpha }
}
const firstColor = (e: XEl | undefined, cc: ColorCtx, override?: string) => { for (const c of e?.children ?? []) { const r = colorOf(c, cc, override); if (r) return r } return null }

// ---------------------------------------------------------------- context

interface Ctx {
  pkg: Pkg
  part: string
  rels: Map<string, RelInfo>
  cc: ColorCtx
  deck: { media: Deck['media'] }
  idMap: Map<string, string>
  slidePaths: Map<string, string>
  pendingSlideLinks: { set: (id: string) => void; path: string }[]
  /** Style the slide's shape inherits through its layout and the master. */
  placeholders?: { find: (type: string, idx: string | undefined) => PhInfo | undefined }
  fonts: { major: string; minor: string }
  notes: Set<string>
  size: { w: number; h: number }
}
interface PhInfo { x?: number; y?: number; w?: number; h?: number; lst?: XEl; bodyPr?: XEl; style?: XEl }

function mediaId(c: Ctx, path: string): string | null {
  const f = c.pkg.files[path]
  if (!f) return null
  const ext = path.split('.').pop()!.toLowerCase()
  const mime = EXT_MIME[ext] ?? 'application/octet-stream'
  const id = 'm' + Object.keys(c.deck.media).length + Math.random().toString(36).slice(2, 6)
  c.deck.media[id] = { mime, data: bytesToDataUrl(f, mime), name: path.split('/').pop() }
  return id
}
const relTarget = (c: Ctx, rid: string | undefined) => (rid ? c.rels.get(rid) : undefined)

// ---------------------------------------------------------------- fills and lines

function fillOf(spPr: XEl | undefined, c: Ctx, phOverride?: string): Fill | undefined | null {
  if (!spPr) return null
  for (const k of spPr.children) {
    switch (L(k)) {
      case 'noFill': return undefined
      case 'solidFill': { const r = firstColor(k, c.cc, phOverride); return r ? { t: 'solid', c: r.c, a: r.a } : undefined }
      case 'gradFill': {
        const stops = kidsL(kidL(k, 'gsLst'), 'gs').map((g) => ({ p: Number(attr(g, 'pos') ?? 0) / 100000, c: firstColor(g, c.cc, phOverride)?.c ?? '#000000' }))
        if (!stops.length) return null
        const lin = kidL(k, 'lin')
        return { t: 'grad', angle: lin ? Number(attr(lin, 'ang') ?? 0) / 60000 : 90, stops, radial: !!kidL(k, 'path') }
      }
      case 'blipFill': {
        const rid = attr(kidL(k, 'blip'), 'embed')
        const t = relTarget(c, rid)
        const id = t && mediaId(c, t.target)
        return id ? { t: 'image', media: id, mode: kidL(k, 'tile') ? 'tile' : 'cover' } : undefined
      }
      case 'pattFill': { const r = firstColor(kidL(k, 'fgClr'), c.cc); return r ? { t: 'solid', c: r.c } : undefined }
    }
  }
  return null
}

function lineOf(spPr: XEl | undefined, c: Ctx): Line | undefined | null {
  const ln = kidL(spPr, 'ln')
  if (!ln) return null
  if (kidL(ln, 'noFill')) return undefined
  const sf = kidL(ln, 'solidFill')
  const col = firstColor(sf, c.cc)
  const w = numAttr(ln, 'w')
  const out: Line = { c: col?.c ?? '@text', w: w === undefined ? (sf ? 0.75 : 0.75) : pt(w), a: col?.a }
  const d = attr(kidL(ln, 'prstDash'), 'val')
  if (d) out.dash = DASH_IN[d]
  const he = attr(kidL(ln, 'headEnd'), 'type'), te = attr(kidL(ln, 'tailEnd'), 'type')
  if (he && ARROW_IN[he]) out.head = ARROW_IN[he]
  if (te && ARROW_IN[te]) out.tail = ARROW_IN[te]
  if (!sf && !kidL(ln, 'gradFill')) return { ...out, c: '@text' }
  return out
}

function shadowOf(spPr: XEl | undefined, c: Ctx): Shadow | undefined {
  const s = descL(kidL(spPr, 'effectLst'), 'outerShdw')
  if (!s) return undefined
  const dist = pt(attr(s, 'dist') ?? 0), dir = (Number(attr(s, 'dir') ?? 0) / 60000) * (Math.PI / 180)
  const col = firstColor(s, c.cc)
  return { c: col?.c ?? '#000000', blur: pt(attr(s, 'blurRad') ?? 0), dx: Math.cos(dir) * dist, dy: Math.sin(dir) * dist, a: col?.a ?? 0.4 }
}

// ---------------------------------------------------------------- text

interface RProps { sz?: number; b?: boolean; i?: boolean; u?: boolean; s?: boolean; c?: Color; f?: string; base?: 1 | -1; hl?: Color }
interface PProps { algn?: Para['align']; bullet?: BulletKind; lh?: number; before?: number; after?: number; level?: number }

function fontName(typeface: string | undefined, c: Ctx): string | undefined {
  if (!typeface) return undefined
  if (typeface === '+mj-lt') return '+head'
  if (typeface === '+mn-lt') return '+body'
  if (typeface.startsWith('+')) return undefined
  if (typeface === c.fonts.major) return '+head'
  if (typeface === c.fonts.minor) return '+body'
  return typeface
}
function rProps(rPr: XEl | undefined, c: Ctx, into: RProps = {}): RProps {
  if (!rPr) return into
  const out = { ...into }
  const sz = numAttr(rPr, 'sz'); if (sz !== undefined) out.sz = sz / 100
  const b = attr(rPr, 'b'); if (b !== undefined) out.b = b === '1' || b === 'true'
  const i = attr(rPr, 'i'); if (i !== undefined) out.i = i === '1' || i === 'true'
  const u = attr(rPr, 'u'); if (u !== undefined) out.u = u !== 'none'
  const st = attr(rPr, 'strike'); if (st !== undefined) out.s = st !== 'noStrike'
  const bl = numAttr(rPr, 'baseline'); if (bl !== undefined) out.base = bl > 0 ? 1 : bl < 0 ? -1 : undefined
  const sf = kidL(rPr, 'solidFill'); if (sf) { const col = firstColor(sf, c.cc); if (col) out.c = col.c }
  const hl = kidL(rPr, 'highlight'); if (hl) { const col = firstColor(hl, c.cc); if (col) out.hl = col.c }
  const f = fontName(attr(kidL(rPr, 'latin'), 'typeface'), c); if (f) out.f = f
  return out
}
function pProps(pPr: XEl | undefined, into: PProps = {}): PProps {
  if (!pPr) return into
  const out = { ...into }
  const a = attr(pPr, 'algn'); if (a) out.algn = a === 'ctr' ? 'center' : a === 'r' ? 'right' : a === 'just' || a === 'dist' ? 'justify' : 'left'
  const lvl = numAttr(pPr, 'lvl'); if (lvl !== undefined) out.level = lvl
  const ls = kidL(pPr, 'lnSpc'); const sp = kidL(ls, 'spcPct'); if (sp) out.lh = Number(attr(sp, 'val')) / 100000
  const sb = pathL(pPr, 'spcBef', 'spcPts'); if (sb) out.before = Number(attr(sb, 'val')) / 100
  const sbp = pathL(pPr, 'spcBef', 'spcPct'); if (sbp) out.before = (Number(attr(sbp, 'val')) / 100000) * 18
  const sa = pathL(pPr, 'spcAft', 'spcPts'); if (sa) out.after = Number(attr(sa, 'val')) / 100
  if (kidL(pPr, 'buNone')) out.bullet = 'none'
  const bc = kidL(pPr, 'buChar'); if (bc) out.bullet = CHAR_IN(attr(bc, 'char') ?? '•')
  const ba = kidL(pPr, 'buAutoNum'); if (ba) out.bullet = NUM_IN[attr(ba, 'type') ?? ''] ?? 'num'
  return out
}

/** Defaults for a shape's text at each level, from the master, the layout and the shape's own list style. */
function levelDefaults(c: Ctx, chain: (XEl | undefined)[]): { r: RProps; p: PProps }[] {
  const out: { r: RProps; p: PProps }[] = []
  for (let lvl = 1; lvl <= 9; lvl++) {
    let r: RProps = {}, p: PProps = {}
    for (const lst of chain) {
      const lp = kidL(lst, `lvl${lvl}pPr`)
      if (!lp) continue
      p = pProps(lp, p)
      r = rProps(kidL(lp, 'defRPr'), c, r)
    }
    out.push({ r, p })
  }
  return out
}

function textFrom(txBody: XEl, c: Ctx, role: string | undefined, defaults: { r: RProps; p: PProps }[], fontRefColor: Color | undefined, inheritedBody?: XEl): { text: Text; st: TextStyle } {
  const bodyPr = kidL(txBody, 'bodyPr')
  const ibp = inheritedBody
  const bp = (n: string) => attr(bodyPr, n) ?? attr(ibp, n)
  const anchor = bp('anchor')
  const insets: [number, number, number, number] = [pt(bp('lIns') ?? 91440), pt(bp('tIns') ?? 45720), pt(bp('rIns') ?? 91440), pt(bp('bIns') ?? 45720)]
  const fitEl = bodyPr && (kidL(bodyPr, 'normAutofit') || kidL(bodyPr, 'spAutoFit') || kidL(bodyPr, 'noAutofit')) ? bodyPr : ibp
  const fit: Text['fit'] = kidL(fitEl, 'normAutofit') ? 'shrink' : 'none'
  const l0 = defaults[0]
  const st: TextStyle = { sz: l0.r.sz ?? 18, c: l0.r.c ?? fontRefColor ?? '@text', b: l0.r.b, i: l0.r.i, f: l0.r.f ?? '+body', align: l0.p.algn ?? 'left', bullet: l0.p.bullet ?? 'none', lh: l0.p.lh, before: l0.p.before, after: l0.p.after }
  const factor = [1, 0.86, 0.72, 0.64]
  const isBody = role === 'body' || role === 'body2' || role === 'object'
  const paras: Para[] = []
  for (const p of kidsL(txBody, 'p')) {
    const pPr = kidL(p, 'pPr')
    const own = pProps(pPr)
    const lvl = own.level ?? 0
    const d = defaults[Math.min(lvl, 8)]
    const pp = { ...d.p, ...own }
    const para: Para = { runs: [] }
    if (lvl) para.level = lvl
    if (pp.algn && pp.algn !== st.align) para.align = pp.algn
    if (pp.bullet && pp.bullet !== st.bullet) para.bullet = pp.bullet
    if (pp.lh !== undefined && pp.lh !== st.lh) para.lh = pp.lh
    if (pp.before !== undefined && pp.before !== st.before) para.before = pp.before
    if (pp.after !== undefined && pp.after !== st.after) para.after = pp.after
    const pDef = rProps(kidL(pPr, 'defRPr'), c, d.r)
    const stBase = st.sz ?? 18
    const levelBase = isBody ? Math.round(stBase * (factor[lvl] ?? 0.64) * 10) / 10 : stBase
    for (const r of p.children) {
      const k = L(r)
      if (k === 'br') { para.runs.push({ t: '\n' }); continue }
      if (k !== 'r' && k !== 'fld') continue
      const t = kidsL(r, 't').map((x) => x.text).join('')
      if (!t && k === 'r') continue
      const rp = rProps(kidL(r, 'rPr'), c, pDef)
      const run: Run = { t: k === 'fld' && !t ? '‹#›' : t }
      if (rp.sz !== undefined && Math.abs(rp.sz - levelBase) > 0.05) run.sz = rp.sz
      if (rp.b !== undefined && !!rp.b !== !!st.b) run.b = rp.b
      if (rp.i !== undefined && !!rp.i !== !!st.i) run.i = rp.i
      if (rp.u) run.u = true
      if (rp.s) run.s = true
      if (rp.c && rp.c !== st.c) run.c = rp.c
      if (rp.f && rp.f !== st.f) run.f = rp.f
      if (rp.base) run.base = rp.base
      if (rp.hl) run.hl = rp.hl
      const hl = kidL(kidL(r, 'rPr'), 'hlinkClick')
      if (hl) {
        const rel = relTarget(c, attr(hl, 'id'))
        if (rel?.external) run.link = rel.target
        else if (rel && /slide/.test(attr(hl, 'action') ?? '')) { /* slide jump on text: kept as plain text */ }
      }
      const last = para.runs[para.runs.length - 1]
      if (last && last.t !== '\n' && (['b', 'i', 'u', 's', 'c', 'sz', 'f', 'hl', 'link', 'base'] as const).every((x) => last[x] === run[x])) last.t += run.t; else para.runs.push(run)
    }
    paras.push(para)
  }
  const text: Text = { paras: paras.length ? paras : [{ runs: [] }], v: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top', inset: insets, wrap: bp('wrap') !== 'none', fit }
  const cols = numAttr(bodyPr, 'numCol'); if (cols && cols > 1) text.cols = cols
  return { text, st }
}

// ---------------------------------------------------------------- geometry

function custPath(cg: XEl): { d: string; w: number; h: number } | null {
  const list = kidL(cg, 'pathLst')
  const path = kidsL(list, 'path')[0]
  if (!path) return null
  const w = Number(attr(path, 'w') ?? 0), h = Number(attr(path, 'h') ?? 0)
  let d = ''
  const pointOf = (p: XEl) => `${attr(p, 'x')} ${attr(p, 'y')}`
  let cur: [number, number] = [0, 0]
  for (const cmd of path.children) {
    const pts = kidsL(cmd, 'pt')
    switch (L(cmd)) {
      case 'moveTo': d += `M${pointOf(pts[0])}`; cur = [Number(attr(pts[0], 'x')), Number(attr(pts[0], 'y'))]; break
      case 'lnTo': d += `L${pointOf(pts[0])}`; cur = [Number(attr(pts[0], 'x')), Number(attr(pts[0], 'y'))]; break
      case 'cubicBezTo': d += `C${pts.map(pointOf).join(' ')}`; cur = [Number(attr(pts[2], 'x')), Number(attr(pts[2], 'y'))]; break
      case 'quadBezTo': d += `Q${pts.map(pointOf).join(' ')}`; cur = [Number(attr(pts[1], 'x')), Number(attr(pts[1], 'y'))]; break
      case 'arcTo': {
        const wr = Number(attr(cmd, 'wR')), hr = Number(attr(cmd, 'hR')), st = (Number(attr(cmd, 'stAng')) / 60000) * (Math.PI / 180), sw = (Number(attr(cmd, 'swAng')) / 60000) * (Math.PI / 180)
        const cx = cur[0] - wr * Math.cos(st), cy = cur[1] - hr * Math.sin(st)
        const ex = cx + wr * Math.cos(st + sw), ey = cy + hr * Math.sin(st + sw)
        d += `A${wr} ${hr} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey}`
        cur = [ex, ey]
        break
      }
      case 'close': d += 'Z'; break
    }
  }
  return d && w && h ? { d, w, h } : null
}

function frame(spPr: XEl | undefined, ph: PhInfo | undefined) {
  const x = kidL(spPr, 'xfrm')
  const off = kidL(x, 'off'), ext = kidL(x, 'ext')
  return {
    x: off ? pt(attr(off, 'x')) : ph?.x ?? 0, y: off ? pt(attr(off, 'y')) : ph?.y ?? 0,
    w: ext ? pt(attr(ext, 'cx')) : ph?.w ?? 100, h: ext ? pt(attr(ext, 'cy')) : ph?.h ?? 50,
    rot: x && attr(x, 'rot') ? Number(attr(x, 'rot')) / 60000 : undefined, flipH: attr(x, 'flipH') === '1' || undefined, flipV: attr(x, 'flipV') === '1' || undefined,
    has: !!x,
  }
}

const ROLE: Record<string, string> = { title: 'title', ctrTitle: 'title', subTitle: 'subtitle', body: 'body', obj: 'body', pic: 'picture', ftr: 'footer', dt: 'date', sldNum: 'num' }

// ---------------------------------------------------------------- elements

type Tf = (r: { x: number; y: number; w: number; h: number }) => { x: number; y: number; w: number; h: number }
const identity: Tf = (r) => r

function styleRefs(sp: XEl, c: Ctx) {
  const st = kidL(sp, 'style')
  if (!st) return {}
  const fillRef = kidL(st, 'fillRef'), lnRef = kidL(st, 'lnRef'), fontRef = kidL(st, 'fontRef')
  return {
    fill: fillRef && attr(fillRef, 'idx') !== '0' ? firstColor(fillRef, c.cc) : null,
    line: lnRef && attr(lnRef, 'idx') !== '0' ? { col: firstColor(lnRef, c.cc), w: { '1': 0.75, '2': 2, '3': 3 }[attr(lnRef, 'idx') ?? '1'] ?? 1 } : null,
    font: fontRef ? firstColor(fontRef, c.cc)?.c : undefined,
  }
}

function parseSp(sp: XEl, c: Ctx, tf: Tf): El | null {
  const nv = kidL(sp, 'nvSpPr')
  const cNv = kidL(nv, 'cNvPr')
  const ph = descL(kidL(nv, 'nvPr'), 'ph')
  const spPr = kidL(sp, 'spPr')
  const type = ph ? attr(ph, 'type') ?? 'obj' : undefined
  const idx = ph ? attr(ph, 'idx') : undefined
  const inherited = ph ? c.placeholders?.find(type!, idx) : undefined
  const f = frame(spPr, inherited)
  const role = type ? ROLE[type] ?? 'body' : undefined
  if (role === 'footer' || role === 'date' || role === 'num') { c.notes.add(role); return null }
  const refs = styleRefs(sp, c)
  const prst = attr(kidL(spPr, 'prstGeom'), 'prst')
  const cg = kidL(spPr, 'custGeom')
  const box = tf(f)
  let fill = fillOf(spPr, c)
  if (fill === null) fill = refs.fill ? { t: 'solid', c: refs.fill.c, a: refs.fill.a } : undefined
  let line = lineOf(spPr, c)
  if (line === null) line = refs.line && refs.line.col ? { c: refs.line.col.c, w: refs.line.w } : undefined
  const txBody = kidL(sp, 'txBody')
  const defaults = levelDefaults(c, [inherited?.lst, kidL(txBody, 'lstStyle')])
  const hasText = !!txBody && kidsL(txBody, 'p').some((p) => kidsL(p, 'r').length || kidsL(p, 'fld').length)
  const parsed = txBody ? textFrom(txBody, c, role, defaults, refs.font, inherited?.bodyPr) : undefined
  const isLine = prst === 'line' || prst === 'straightConnector1'
  if (isLine && !hasText) {
    const el: El = { id: uid(), type: 'line', kind: 'straight', ...box, rot: f.rot, flipH: f.flipH, flipV: f.flipV, line: line ?? { c: '@text', w: 1 } }
    c.idMap.set(attr(cNv, 'id') ?? '', el.id)
    return el
  }
  const geom = prst ?? (cg ? 'rect' : 'rect')
  const adj = kidsL(pathL(spPr, 'prstGeom', 'avLst'), 'gd').map((g) => Number((attr(g, 'fmla') ?? '').replace(/^val\s+/, '')))
  const el: ShapeEl = { id: uid(), type: 'shape', geom, ...box, rot: f.rot, flipH: f.flipH, flipV: f.flipV, fill: fill ?? undefined, line: line ?? undefined, name: attr(cNv, 'name') || undefined, alt: attr(cNv, 'descr') || undefined }
  if (adj.length && adj.every((n) => Number.isFinite(n))) el.adj = adj
  if (cg) { const cp = custPath(cg); if (cp) { el.cust = cp; el.geom = 'rect' } }
  const sh = shadowOf(spPr, c); if (sh) el.shadow = sh
  if (parsed) { el.text = parsed.text; el.st = parsed.st }
  if (role) el.ph = { role: role as ShapeEl['ph'] extends infer P ? P extends { role: infer R } ? R : never : never, idx: idx ? Number(idx) : undefined }
  if (ph && !f.has) { /* inherits its frame from the layout */ }
  if (ph && role === 'body' && idx && Number(idx) > 1) el.ph = { role: 'body2', idx: Number(idx) }
  if (!parsed && !ph) delete el.text
  const hl = kidL(cNv, 'hlinkClick')
  if (hl) setLink(el, hl, c)
  c.idMap.set(attr(cNv, 'id') ?? '', el.id)
  return el
}

function setLink(el: El, hl: XEl, c: Ctx) {
  const rel = relTarget(c, attr(hl, 'id'))
  if (!rel) return
  if (rel.external) el.link = { url: rel.target }
  else if (/slide/i.test(rel.type)) c.pendingSlideLinks.push({ path: rel.target, set: (id) => { el.link = { slide: id } } })
}

function parsePic(pic: XEl, c: Ctx, tf: Tf): El | null {
  const nv = kidL(pic, 'nvPicPr')
  const cNv = kidL(nv, 'cNvPr')
  const spPr = kidL(pic, 'spPr')
  const bf = kidL(pic, 'blipFill')
  const blip = kidL(bf, 'blip')
  const f = frame(spPr, undefined)
  const box = tf(f)
  const nvPr = kidL(nv, 'nvPr')
  const vid = descL(nvPr, 'videoFile'), aud = descL(nvPr, 'audioFile')
  if (vid || aud) {
    const mediaRel = descL(nvPr, 'media')
    const rel = relTarget(c, attr(mediaRel, 'embed') ?? attr(vid ?? aud, 'link'))
    const id = rel && !rel.external ? mediaId(c, rel.target) : null
    if (id) { const el: El = { id: uid(), type: vid ? 'video' : 'audio', media: id, ...box, alt: attr(cNv, 'descr') || undefined }; c.idMap.set(attr(cNv, 'id') ?? '', el.id); return el }
  }
  const rel = relTarget(c, attr(blip, 'embed'))
  const id = rel && !rel.external ? mediaId(c, rel.target) : null
  if (!id) return null
  const sr = kidL(bf, 'srcRect')
  const crop = sr ? { l: Number(attr(sr, 'l') ?? 0) / 100000, t: Number(attr(sr, 't') ?? 0) / 100000, r: Number(attr(sr, 'r') ?? 0) / 100000, b: Number(attr(sr, 'b') ?? 0) / 100000 } : undefined
  const prst = attr(kidL(spPr, 'prstGeom'), 'prst')
  const line = lineOf(spPr, c)
  const el: El = { id: uid(), type: 'image', media: id, ...box, rot: f.rot, flipH: f.flipH, flipV: f.flipV, crop: crop && (crop.l || crop.t || crop.r || crop.b) ? crop : undefined, geom: prst && prst !== 'rect' ? prst : undefined, line: line ?? undefined, alt: attr(cNv, 'descr') || undefined, name: attr(cNv, 'name') || undefined }
  const sh = shadowOf(spPr, c); if (sh) el.shadow = sh
  const hl = kidL(cNv, 'hlinkClick'); if (hl) setLink(el, hl, c)
  c.idMap.set(attr(cNv, 'id') ?? '', el.id)
  return el
}

function parseCxn(cx: XEl, c: Ctx, tf: Tf): El | null {
  const cNv = kidL(kidL(cx, 'nvCxnSpPr'), 'cNvPr')
  const spPr = kidL(cx, 'spPr')
  const f = frame(spPr, undefined)
  const prst = attr(kidL(spPr, 'prstGeom'), 'prst') ?? 'line'
  const kind = /^bent/.test(prst) ? 'elbow' : /^curved/.test(prst) ? 'curve' : 'straight'
  const refs = styleRefs(cx, c)
  const line = lineOf(spPr, c) ?? (refs.line?.col ? { c: refs.line.col.c, w: refs.line.w } : { c: '@text', w: 1 })
  const el: El = { id: uid(), type: 'line', kind, ...tf(f), rot: f.rot, flipH: f.flipH, flipV: f.flipV, line }
  c.idMap.set(attr(cNv, 'id') ?? '', el.id)
  return el
}

function parseTable(gf: XEl, tbl: XEl, c: Ctx, tf: Tf): El | null {
  const cNv = kidL(kidL(gf, 'nvGraphicFramePr'), 'cNvPr')
  const f = frame(kidL(gf, 'xfrm') ? { children: [kidL(gf, 'xfrm')!], name: 'spPr', attrs: {}, text: '' } : undefined, undefined)
  const cols = kidsL(kidL(tbl, 'tblGrid'), 'gridCol').map((g) => pt(attr(g, 'w')))
  const tblPr = kidL(tbl, 'tblPr')
  const rows = kidsL(tbl, 'tr').map((tr) => ({
    h: pt(attr(tr, 'h')),
    cells: kidsL(tr, 'tc').map((tc): TableCell => {
      const tcPr = kidL(tc, 'tcPr')
      const txBody = kidL(tc, 'txBody')
      const d = levelDefaults(c, [])
      const parsed = txBody ? textFrom(txBody, c, undefined, d, undefined) : { text: { paras: [{ runs: [] }] } as Text, st: {} }
      const cell: TableCell = { text: { paras: parsed.text.paras } }
      // Text inside table cells has no list style of its own: keep sizes explicit.
      const bodySize = parsed.st.sz
      if (bodySize !== undefined && bodySize !== 18) cell.text.paras = cell.text.paras.map((p) => ({ ...p, runs: p.runs.map((r) => (r.sz === undefined ? { ...r, sz: bodySize } : r)) }))
      const fill = fillOf(tcPr, c)
      if (fill) cell.fill = fill
      const anchor = attr(tcPr, 'anchor'); if (anchor) cell.v = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'
      const gs = numAttr(tc, 'gridSpan'), rs = numAttr(tc, 'rowSpan')
      if (gs && gs > 1 || rs && rs > 1) cell.span = { c: gs ?? 1, r: rs ?? 1 }
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') cell.covered = true
      return cell
    }),
  }))
  if (!cols.length || !rows.length) return null
  const box = tf(f)
  const el: TableEl = { id: uid(), type: 'table', ...box, cols, rows, style: { header: attr(tblPr, 'firstRow') === '1', banded: attr(tblPr, 'bandRow') === '1', firstCol: attr(tblPr, 'firstCol') === '1', color: '@accent1', borders: true } }
  el.w = cols.reduce((a, b) => a + b, 0); el.h = rows.reduce((a, r) => a + r.h, 0)
  c.idMap.set(attr(cNv, 'id') ?? '', el.id)
  return el
}

const strPts = (cache: XEl | undefined) => kidsL(cache, 'pt').sort((a, b) => Number(attr(a, 'idx')) - Number(attr(b, 'idx'))).map((p) => textOfEl(kidL(p, 'v')))
function numPts(cache: XEl | undefined): number[] {
  const n = Number(attr(kidL(cache, 'ptCount'), 'val') ?? 0)
  const out = Array.from({ length: n }, () => 0)
  for (const p of kidsL(cache, 'pt')) out[Number(attr(p, 'idx'))] = parseFloat(textOfEl(kidL(p, 'v'))) || 0
  return out
}

function parseChart(gf: XEl, c: Ctx, tf: Tf): El | null {
  const cNv = kidL(kidL(gf, 'nvGraphicFramePr'), 'cNvPr')
  const ref = descL(gf, 'chart')
  const rel = relTarget(c, attr(ref, 'id'))
  const cx = rel && c.pkg.xml(rel.target)
  if (!cx) return null
  const chart = kidL(cx, 'chart')
  const plot = kidL(chart, 'plotArea')
  const typeEl = plot?.children.find((k) => /Chart$/.test(L(k)) && !/^(bubble|stock|surface|ofPie)/.test(L(k)))
  if (!typeEl) return null
  const tn = L(typeEl)
  let kind: ChartKind = tn === 'barChart' || tn === 'bar3DChart' ? (attr(kidL(typeEl, 'barDir'), 'val') === 'bar' ? 'bar' : 'column') : tn.startsWith('line') ? 'line' : tn.startsWith('area') ? 'area' : tn.startsWith('doughnut') ? 'doughnut' : tn.startsWith('pie') ? 'pie' : tn === 'scatterChart' ? 'scatter' : 'radar'
  if (tn === 'ofPieChart') kind = 'pie'
  const g = attr(kidL(typeEl, 'grouping'), 'val')
  const grouping: ChartEl['grouping'] = g === 'stacked' ? 'stacked' : g === 'percentStacked' ? 'percent' : 'clustered'
  const series: ChartSeries[] = []
  let cats: string[] = []
  for (const s of kidsL(typeEl, 'ser')) {
    const nameEl = kidL(s, 'tx')
    const name = strPts(descL(nameEl, 'strCache'))[0] ?? textOfEl(descL(nameEl, 'v')) ?? `Series ${series.length + 1}`
    const catEl = kidL(s, 'cat') ?? kidL(s, 'xVal')
    const catStr = descL(catEl, 'strCache'), catNum = descL(catEl, 'numCache')
    const valEl = kidL(s, 'val') ?? kidL(s, 'yVal')
    const vals = numPts(descL(valEl, 'numCache') ?? descL(valEl, 'numLit'))
    if (kind === 'scatter') series.push({ name, vals, xs: numPts(catNum ?? descL(catEl, 'numLit')), color: firstColor(pathL(s, 'spPr', 'ln') ?? kidL(s, 'spPr'), c.cc)?.c })
    else {
      if (!cats.length) cats = catStr ? strPts(catStr) : catNum ? numPts(catNum).map(String) : strPts(descL(catEl, 'strLit'))
      series.push({ name, vals, color: firstColor(kidL(kidL(s, 'spPr'), 'solidFill'), c.cc)?.c ?? firstColor(pathL(s, 'spPr', 'ln', 'solidFill'), c.cc)?.c })
    }
  }
  const title = kidL(chart, 'title')
  const legendPos = attr(kidL(kidL(chart, 'legend'), 'legendPos'), 'val')
  const f = frame(kidL(gf, 'xfrm') ? { children: [kidL(gf, 'xfrm')!], name: 'spPr', attrs: {}, text: '' } : undefined, undefined)
  const dl = descL(typeEl, 'dLbls')
  const el: ChartEl = {
    id: uid(), type: 'chart', ...tf(f), kind, grouping, cats, series: series.length ? series : [{ name: 'Series 1', vals: [] }],
    title: title && !descL(chart, 'autoTitleDeleted')?.attrs.val?.match(/1/) ? textOfEl(descL(title, 'rich')).trim() || undefined : undefined,
    legend: kidL(chart, 'legend') ? ({ t: 'top', r: 'right', b: 'bottom', l: 'right' } as Record<string, ChartEl['legend']>)[legendPos ?? 'r'] ?? 'bottom' : 'none',
    labels: !!dl && (attr(kidL(dl, 'showVal'), 'val') === '1' || attr(kidL(dl, 'showPercent'), 'val') === '1'),
    grid: !!descL(plot, 'majorGridlines'),
    smooth: attr(descL(typeEl, 'smooth'), 'val') === '1' || undefined,
  }
  c.idMap.set(attr(cNv, 'id') ?? '', el.id)
  return el
}

function parseGraphicFrame(gf: XEl, c: Ctx, tf: Tf): El | El[] | null {
  const data = descL(gf, 'graphicData')
  const uri = attr(data, 'uri') ?? ''
  if (uri.endsWith('/table')) { const t = descL(data, 'tbl'); return t ? parseTable(gf, t, c, tf) : null }
  if (uri.endsWith('/chart')) return parseChart(gf, c, tf)
  if (uri.includes('diagram')) {
    // SmartArt: use the picture of it that the file carries.
    const rel = [...c.rels.values()].find((r) => /diagramDrawing/.test(r.type))
    const dx = rel && c.pkg.xml(rel.target)
    if (dx) return parseTree(kidL(dx, 'spTree') ?? dx, { ...c, part: rel!.target, rels: c.pkg.rels(rel!.target) }, tf)
    c.notes.add('smartart')
  } else c.notes.add('object')
  return null
}

function parseGroup(g: XEl, c: Ctx, tf: Tf): El | El[] | null {
  const gp = kidL(g, 'grpSpPr')
  const x = kidL(gp, 'xfrm')
  const off = kidL(x, 'off'), ext = kidL(x, 'ext'), cho = kidL(x, 'chOff'), che = kidL(x, 'chExt')
  const gx = pt(attr(off, 'x')), gy = pt(attr(off, 'y')), gw = pt(attr(ext, 'cx')), gh = pt(attr(ext, 'cy'))
  const cx = pt(attr(cho, 'x')), cy = pt(attr(cho, 'y')), cw = pt(attr(che, 'cx')) || gw || 1, ch = pt(attr(che, 'cy')) || gh || 1
  const kx = gw / cw || 1, ky = gh / ch || 1
  const inner: Tf = (r) => tf({ x: gx + (r.x - cx) * kx, y: gy + (r.y - cy) * ky, w: r.w * kx, h: r.h * ky })
  const children = parseTree(g, c, inner)
  if (!children.length) return null
  const rot = x && attr(x, 'rot') ? Number(attr(x, 'rot')) / 60000 : 0
  const gb = tf({ x: gx, y: gy, w: gw, h: gh })
  if (rot) {
    const r = (rot * Math.PI) / 180, mx = gb.x + gb.w / 2, my = gb.y + gb.h / 2
    return children.map((k) => { const dx = k.x + k.w / 2 - mx, dy = k.y + k.h / 2 - my; const nx = mx + dx * Math.cos(r) - dy * Math.sin(r), ny = my + dx * Math.sin(r) + dy * Math.cos(r); return { ...k, x: nx - k.w / 2, y: ny - k.h / 2, rot: ((k.rot ?? 0) + rot) % 360 } as El })
  }
  const el: El = { id: uid(), type: 'group', ...gb, children }
  c.idMap.set(attr(kidL(kidL(g, 'nvGrpSpPr'), 'cNvPr'), 'id') ?? '', el.id)
  return el
}

function parseTree(tree: XEl, c: Ctx, tf: Tf): El[] {
  const out: El[] = []
  const push = (r: El | El[] | null) => { if (!r) return; if (Array.isArray(r)) out.push(...r); else out.push(r) }
  for (const k of tree.children) {
    switch (L(k)) {
      case 'sp': push(parseSp(k, c, tf)); break
      case 'pic': push(parsePic(k, c, tf)); break
      case 'cxnSp': push(parseCxn(k, c, tf)); break
      case 'graphicFrame': push(parseGraphicFrame(k, c, tf)); break
      case 'grpSp': push(parseGroup(k, c, tf)); break
      case 'AlternateContent': {
        const choice = kidL(k, 'Choice'), fb = kidL(k, 'Fallback')
        const got = choice ? parseTree(choice, c, tf) : []
        push(got.length ? got : fb ? parseTree(fb, c, tf) : [])
        break
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- slides, layouts, master

function bgOf(cSld: XEl | undefined, c: Ctx): Fill | undefined {
  const bg = kidL(cSld, 'bg')
  if (!bg) return undefined
  const pr = kidL(bg, 'bgPr')
  if (pr) { const f = fillOf(pr, c); return f ?? undefined }
  const ref = kidL(bg, 'bgRef')
  const col = ref && firstColor(ref, c.cc)
  return col ? { t: 'solid', c: col.c, a: col.a } : undefined
}

const TRANS_MAP: Record<string, TransitionKind> = { fade: 'fade', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'uncover', zoom: 'zoom', split: 'split', blinds: 'blinds', dissolve: 'dissolve', flip: 'flip', prism: 'cube', cube: 'cube', morph: 'morph', random: 'fade', randomBar: 'blinds', wheel: 'fade', circle: 'zoom', diamond: 'zoom', plus: 'zoom', newsflash: 'zoom' }
function parseTransition(sld: XEl): { trans?: Transition; auto?: number } {
  const tr = descL(sld, 'transition')
  if (!tr) return {}
  const adv = numAttr(tr, 'advTm')
  const body = tr.children.find((k) => L(k) !== 'sndAc' && L(k) !== 'extLst')
  const name = body ? L(body) : ''
  const kind = TRANS_MAP[name]
  const spd = attr(tr, 'spd'), p14 = numAttr(tr, 'dur')
  const dur = p14 !== undefined ? p14 / 1000 : spd === 'fast' ? 0.4 : spd === 'slow' ? 1.2 : 0.7
  const d = attr(body, 'dir')
  const dir: Dir | undefined = d === 'l' ? 'right' : d === 'r' ? 'left' : d === 'u' ? 'down' : d === 'd' ? 'up' : d === 'ld' ? 'right' : undefined
  return { trans: kind ? { kind, dur, dir } : undefined, auto: adv !== undefined ? adv / 1000 : undefined }
}

const SUB_DIR: Record<string, Dir> = { '8': 'left', '2': 'right', '1': 'up', '4': 'down' }
function parseTiming(sld: XEl, idMap: Map<string, string>): Anim[] {
  const timing = descL(sld, 'timing')
  const main = timing && allDesc(timing, 'cTn').find((x) => attr(x, 'nodeType') === 'mainSeq')
  if (!main) return []
  const out: Anim[] = []
  for (const e of allDesc(main, 'cTn')) {
    const cls = attr(e, 'presetClass')
    if (!cls || !['entr', 'exit', 'emph'].includes(cls)) continue
    const spTgt = descL(e, 'spTgt')
    const target = spTgt && idMap.get(attr(spTgt, 'spid') ?? '')
    if (!target) continue
    const pr = descL(spTgt, 'pRg')
    const id = attr(e, 'presetID') ?? ''
    const eff: Effect = ANIM_BY_ID[id] ?? (cls === 'emph' ? 'pulse' : 'fade')
    const delay = Number(attr(descL(kidL(e, 'stCondLst'), 'cond'), 'delay') ?? 0)
    const durNode = allDesc(e, 'cTn').find((x) => x !== e && x.attrs.dur && x.attrs.dur !== '1' && attr(x, 'dur') !== 'indefinite')
    const nt = attr(e, 'nodeType')
    out.push({ id: uid('a'), target, effect: eff, kind: cls === 'entr' ? 'in' : cls === 'exit' ? 'out' : 'emph', trigger: nt === 'withEffect' ? 'with' : nt === 'afterEffect' ? 'after' : 'click', dur: durNode ? Number(attr(durNode, 'dur')) / 1000 : 0.5, delay: delay / 1000, dir: SUB_DIR[attr(e, 'presetSubtype') ?? ''], byPara: pr ? true : undefined })
  }
  // A by-paragraph animation is written once per paragraph: keep one.
  const seen = new Set<string>()
  return out.filter((a) => { const k = a.target + a.effect + a.kind; if (a.byPara) { if (seen.has(k)) return false; seen.add(k) } return true })
}

function notesOf(pkg: Pkg, rels: Map<string, RelInfo>): string {
  const r = [...rels.values()].find((x) => /notesSlide$/.test(x.type))
  const nx = r && pkg.xml(r.target)
  if (!nx) return ''
  for (const sp of allDesc(nx, 'sp')) {
    const ph = descL(sp, 'ph')
    if (ph && (attr(ph, 'type') === 'body' || attr(ph, 'idx') === '1')) return kidsL(kidL(sp, 'txBody'), 'p').map((p) => textOfEl(p).replace(/\n/g, '')).join('\n').replace(/\n+$/, '')
  }
  return ''
}

export interface PptxResult { deck: Deck; notes: string[] }

export function readPptx(bytes: Uint8Array, name: string): PptxResult {
  let files: Files
  try { files = unzipSync(bytes) } catch { throw new Error('That is not a .pptx file (it could not be unzipped).') }
  const pkg = new Pkg(files)

  // A Kwiiva copy inside the file is used when nothing else has changed the file since.
  const extra = files['kwiiva/deck.json']
  if (extra) {
    try {
      const j = JSON.parse(strFromU8(extra))
      if (j.app === 'kwiiva-present' && j.fingerprint === fingerprint(files) && j.deck?.slides) return { deck: j.deck as Deck, notes: [] }
    } catch { /* fall through to the standard parts */ }
  }

  const presPath = 'ppt/presentation.xml'
  const pres = pkg.xml(presPath)
  if (!pres) throw new Error('This file has no presentation in it.')
  const prels = pkg.rels(presPath)
  const size = kidL(pres, 'sldSz')
  const w = size ? pt(attr(size, 'cx')) : 960, h = size ? pt(attr(size, 'cy')) : 540

  const masterRel = [...prels.values()].find((r) => /slideMaster$/.test(r.type))
  const masterPath = masterRel?.target ?? 'ppt/slideMasters/slideMaster1.xml'
  const master = pkg.xml(masterPath)
  const mrels = pkg.rels(masterPath)
  const themeRel = [...mrels.values()].find((r) => /theme$/.test(r.type))
  const themeX = themeRel && pkg.xml(themeRel.target)
  const scheme = descL(themeX, 'clrScheme')
  const tcolors: Record<string, string> = {}
  for (const k of scheme?.children ?? []) { const v = firstColor(k, { theme: {}, map: {} }); tcolors[L(k)] = (v?.c ?? '#000000').replace('#', '').toUpperCase() }
  const clrMapEl = kidL(master, 'clrMap')
  const clrMap: Record<string, string> = {}
  for (const k in clrMapEl?.attrs ?? {}) clrMap[k] = clrMapEl!.attrs[k]
  const cc: ColorCtx = { theme: tcolors, map: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', ...clrMap } }
  const fontScheme = descL(themeX, 'fontScheme')
  const fonts = { major: attr(pathL(fontScheme, 'majorFont', 'latin'), 'typeface') ?? 'Calibri', minor: attr(pathL(fontScheme, 'minorFont', 'latin'), 'typeface') ?? 'Calibri' }
  const hx = (k: string, d: string) => '#' + (tcolors[k] ?? d)
  const theme: Theme = {
    id: 'imported', name: attr(scheme, 'name') ?? 'Imported',
    colors: { bg: hx(cc.map.bg1 ?? 'lt1', 'FFFFFF'), text: hx(cc.map.tx1 ?? 'dk1', '000000'), bg2: hx(cc.map.bg2 ?? 'lt2', 'EEEEEE'), text2: hx(cc.map.tx2 ?? 'dk2', '444444'), accent1: hx('accent1', '4472C4'), accent2: hx('accent2', 'ED7D31'), accent3: hx('accent3', 'A5A5A5'), accent4: hx('accent4', 'FFC000'), accent5: hx('accent5', '5B9BD5'), accent6: hx('accent6', '70AD47'), link: hx('hlink', '0563C1') },
    headFont: fonts.major, bodyFont: fonts.minor,
  }
  const deck = makeDeck('paper', name.replace(/\.[^.]+$/, ''))
  deck.w = w; deck.h = h; deck.theme = theme; deck.slides = []; deck.layouts = []
  const media: Deck['media'] = {}
  deck.media = media
  const notes = new Set<string>()
  const idMapAll = new Map<string, string>()
  const slidePaths = new Map<string, string>()
  const pending: Ctx['pendingSlideLinks'] = []

  const mk = (part: string, ph?: Ctx['placeholders']): Ctx => ({ pkg, part, rels: pkg.rels(part), cc, deck: { media }, idMap: idMapAll, slidePaths, pendingSlideLinks: pending, placeholders: ph, fonts, notes, size: { w, h } })

  // Master: its placeholders give frames and text styles to layouts and slides.
  const mc = mk(masterPath)
  const mtree = pathL(master, 'cSld', 'spTree')
  const mPh = new Map<string, PhInfo>()
  const txStyles = kidL(master, 'txStyles')
  const styleFor = (type: string) => (/title/i.test(type) ? kidL(txStyles, 'titleStyle') : type === 'body' || type === 'subTitle' || type === 'obj' ? kidL(txStyles, 'bodyStyle') : kidL(txStyles, 'otherStyle'))
  const phFrame = (sp: XEl): PhInfo => { const f = frame(kidL(sp, 'spPr'), undefined); return { x: f.has ? f.x : undefined, y: f.has ? f.y : undefined, w: f.has ? f.w : undefined, h: f.has ? f.h : undefined, lst: kidL(kidL(sp, 'txBody'), 'lstStyle'), bodyPr: kidL(kidL(sp, 'txBody'), 'bodyPr') } }
  for (const sp of kidsL(mtree, 'sp')) { const ph = descL(kidL(kidL(sp, 'nvSpPr'), 'nvPr'), 'ph'); if (ph) mPh.set(attr(ph, 'type') ?? 'obj', phFrame(sp)) }
  const withStyle = (type: string, info: PhInfo | undefined): PhInfo | undefined => ({ ...info, lst: info?.lst ?? undefined, style: styleFor(type) })
  const masterLookup = (type: string): PhInfo | undefined => {
    const t = type === 'ctrTitle' ? 'title' : type === 'subTitle' ? 'body' : type === 'obj' || type === 'pic' ? 'body' : type
    return mPh.get(t) ?? mPh.get('body')
  }
  /** Merge frames and list styles up the chain: master → layout → slide. */
  const chainLookup = (lay: Map<string, PhInfo>, layIdx: Map<string, PhInfo>) => ({
    find: (type: string, idx: string | undefined): PhInfo | undefined => {
      const m = masterLookup(type)
      const l = (idx !== undefined ? layIdx.get(idx) : undefined) ?? lay.get(type) ?? (type === 'ctrTitle' ? lay.get('title') : undefined)
      const style = styleFor(type)
      return { x: l?.x ?? m?.x, y: l?.y ?? m?.y, w: l?.w ?? m?.w, h: l?.h ?? m?.h, bodyPr: l?.bodyPr ?? m?.bodyPr, lst: mergeLst([style, m?.lst, l?.lst]) }
    },
  })
  const mergeLst = (list: (XEl | undefined)[]): XEl => {
    // Later lists override earlier ones level by level.
    const merged: XEl = { name: 'lstStyle', attrs: {}, children: [], text: '' }
    for (let lvl = 1; lvl <= 9; lvl++) {
      const nodes = list.map((l) => kidL(l, `lvl${lvl}pPr`)).filter((x): x is XEl => !!x)
      if (!nodes.length) continue
      const comb: XEl = { name: `lvl${lvl}pPr`, attrs: Object.assign({}, ...nodes.map((n) => n.attrs)), children: [], text: '' }
      const defs: XEl = { name: 'defRPr', attrs: {}, children: [], text: '' }
      for (const n of nodes) {
        for (const ch of n.children) { if (L(ch) === 'defRPr') { Object.assign(defs.attrs, ch.attrs); for (const g of ch.children) { defs.children = defs.children.filter((q) => L(q) !== L(g)); defs.children.push(g) } } else { comb.children = comb.children.filter((q) => L(q) !== L(ch) && !(L(ch).startsWith('bu') && L(q).startsWith('bu'))); comb.children.push(ch) } }
      }
      comb.children.push(defs)
      merged.children.push(comb)
    }
    return merged
  }
  void withStyle

  const masterBg = bgOf(kidL(master, 'cSld'), mc)
  const masterEls = parseTree(mtree ?? { name: 'spTree', attrs: {}, children: [], text: '' }, mc, identity).filter((e) => !(e.type === 'shape' && e.ph))
  deck.master = { bg: masterBg, els: masterEls.map((e) => ({ ...e, locked: true })) }

  // Layouts.
  const layoutOf = new Map<string, string>()
  const layoutLookups = new Map<string, ReturnType<typeof chainLookup>>()
  const layoutRels = [...mrels.values()].filter((r) => /slideLayout$/.test(r.type))
  const idCount = new Map<string, number>()
  const KNOWN: Record<string, string> = { title: 'title', obj: 'titleBody', secHead: 'section', twoObj: 'twoContent', twoTxTwoObj: 'comparison', titleOnly: 'titleOnly', picTx: 'pictureCaption', blank: 'blank' }
  const layoutOrder = (kidsL(kidL(master, 'sldLayoutIdLst'), 'sldLayoutId')).map((l) => mrels.get(rId(l) ?? '')).filter((x): x is RelInfo => !!x)
  for (const rel of layoutOrder.length ? layoutOrder : layoutRels) {
    const lx = pkg.xml(rel.target)
    if (!lx) continue
    const lrels = pkg.rels(rel.target)
    const tree = pathL(lx, 'cSld', 'spTree')
    const phByType = new Map<string, PhInfo>(), phByIdx = new Map<string, PhInfo>()
    for (const sp of kidsL(tree, 'sp')) {
      const ph = descL(kidL(kidL(sp, 'nvSpPr'), 'nvPr'), 'ph')
      if (!ph) continue
      const info = phFrame(sp)
      phByType.set(attr(ph, 'type') ?? 'obj', info)
      if (attr(ph, 'idx')) phByIdx.set(attr(ph, 'idx')!, info)
    }
    const lookup = chainLookup(phByType, phByIdx)
    const lc = { ...mk(rel.target, lookup), rels: lrels }
    let base = KNOWN[attr(lx, 'type') ?? ''] ?? `L${layoutOf.size}`
    const n = idCount.get(base) ?? 0; idCount.set(base, n + 1)
    if (n) base = `${base}${n + 1}`
    const els = parseTree(tree ?? { name: 'spTree', attrs: {}, children: [], text: '' }, lc, identity)
    const layout: Layout = { id: base, name: attr(kidL(lx, 'cSld'), 'name') ?? base, bg: bgOf(kidL(lx, 'cSld'), lc), els: els.map((e) => (e.type === 'shape' && e.ph ? e : { ...e, locked: true })) }
    // Placeholders of a layout show no text of their own.
    layout.els = layout.els.map((e) => (e.type === 'shape' && e.ph ? { ...e, text: { ...e.text!, paras: [{ runs: [] }] } } : e))
    deck.layouts.push(layout)
    layoutOf.set(rel.target, base)
    layoutLookups.set(rel.target, lookup)
  }
  if (!deck.layouts.length) deck.layouts = makeDeck('paper').layouts

  // Slides, in order.
  const order = kidsL(kidL(pres, 'sldIdLst'), 'sldId').map((s) => prels.get(rId(s) ?? '')).filter((x): x is RelInfo => !!x)
  const slideIds: string[] = []
  const footer = { num: false, text: '', date: false }
  for (const rel of order) {
    const sx = pkg.xml(rel.target)
    if (!sx) continue
    const srels = pkg.rels(rel.target)
    const lrel = [...srels.values()].find((r) => /slideLayout$/.test(r.type))
    const lookup = (lrel && layoutLookups.get(lrel.target)) ?? chainLookup(new Map(), new Map())
    const sc = { ...mk(rel.target, lookup), rels: srels }
    const cSld = kidL(sx, 'cSld')
    const slideNotes = new Set<string>()
    sc.notes = slideNotes
    const els = parseTree(kidL(cSld, 'spTree') ?? { name: 'spTree', attrs: {}, children: [], text: '' }, sc, identity)
    if (slideNotes.has('num')) footer.num = true
    if (slideNotes.has('date')) footer.date = true
    for (const n of slideNotes) if (n === 'smartart' || n === 'object') notes.add(n)
    // Footer text: read it from the footer placeholder, if any.
    for (const sp of allDesc(kidL(cSld, 'spTree'), 'sp')) { const ph = descL(kidL(kidL(sp, 'nvSpPr'), 'nvPr'), 'ph'); if (ph && attr(ph, 'type') === 'ftr') { const t = textOfEl(kidL(sp, 'txBody')).trim(); if (t) footer.text = t } }
    const { trans, auto } = parseTransition(sx)
    const slide: Slide = {
      id: uid('s'), layout: (lrel && layoutOf.get(lrel.target)) ?? deck.layouts[0].id, bg: bgOf(cSld, sc), els, notes: notesOf(pkg, srels), anims: parseTiming(sx, idMapAll),
      trans, auto, hidden: attr(sx, 'show') === '0' || undefined,
    }
    slidePaths.set(rel.target, slide.id)
    slideIds.push(slide.id)
    deck.slides.push(slide)
  }
  for (const p of pending) { const id = slidePaths.get(p.path); if (id) p.set(id) }
  deck.footer = footer
  const msgs: string[] = []
  if (notes.has('smartart')) msgs.push('Some diagrams could not be shown and were left out.')
  if (notes.has('object')) msgs.push('Some embedded objects (such as equations or 3D models) are not supported and were left out.')
  return { deck, notes: msgs }
}
