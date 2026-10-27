import { unzipSync, strFromU8 } from 'fflate'
import { fontStack } from '../editor/fonts'
import { DEFAULT_LINE_HEIGHT, DEFAULT_SPACE_AFTER, DEFAULT_SPACE_BEFORE } from '../editor/defaults'
import { attr, kid, kids, parseXml, type XEl } from './xml'
import { DEFAULT_SETTINGS, PAGE_SIZES, emptyDoc, type HeaderFooter, type PageSettings, type PMNode, type WriteDocument } from './types'

interface RProps {
  b?: boolean; i?: boolean; u?: boolean; strike?: boolean
  color?: string; sz?: number; font?: string; highlight?: string
  vert?: 'superscript' | 'subscript'
}
interface PProps {
  jc?: string; before?: number; after?: number; line?: number
  left?: number; first?: number; numId?: string; ilvl?: number
  pageBreakBefore?: boolean; styleId?: string
}
interface Style { id: string; name: string; type: string; basedOn?: string; p: PProps; r: RProps }

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000',
}

const on = (e: XEl | undefined) => {
  if (!e) return undefined
  const v = attr(e, 'val')
  return !(v === '0' || v === 'false' || v === 'off')
}
const num = (s: string | undefined) => (s === undefined || s === '' || isNaN(Number(s)) ? undefined : Number(s))

function base64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export function readDocx(bytes: Uint8Array, fileName = 'Document'): WriteDocument {
  const zip = unzipSync(bytes)
  const text = (name: string) => (zip[name] ? strFromU8(zip[name]) : null)
  const xml = (name: string) => { const t = text(name); return t ? parseXml(t) : undefined }
  if (!zip['word/document.xml']) throw new Error('This file is not a valid .docx document.')

  const docRoot = xml('word/document.xml')!
  const body = kid(docRoot, 'w:body')
  const relsOf = (part: string) => {
    const dir = part.slice(0, part.lastIndexOf('/') + 1), file = part.slice(part.lastIndexOf('/') + 1)
    const r = xml(`${dir}_rels/${file}.rels`)
    const map = new Map<string, { type: string; target: string; external: boolean }>()
    for (const e of kids(r, 'Relationship')) map.set(e.attrs.Id, { type: e.attrs.Type, target: e.attrs.Target, external: e.attrs.TargetMode === 'External' })
    return map
  }
  const rels = relsOf('word/document.xml')
  const resolvePart = (target: string) => (target.startsWith('/') ? target.slice(1) : 'word/' + target).replace(/\/\.\//g, '/')

  // ---- theme fonts ----
  const theme = xml('word/theme/theme1.xml')
  const themeFont = (which: 'major' | 'minor') => {
    const fs = kid(kid(kid(theme, 'a:themeElements'), 'a:fontScheme'), which === 'major' ? 'a:majorFont' : 'a:minorFont')
    return kid(fs, 'a:latin')?.attrs.typeface
  }

  // ---- properties ----
  function parseR(rPr: XEl | undefined): RProps {
    const r: RProps = {}
    if (!rPr) return r
    const fonts = kid(rPr, 'w:rFonts')
    if (fonts) {
      const th = attr(fonts, 'asciiTheme')
      r.font = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? (th ? themeFont(th.startsWith('major') ? 'major' : 'minor') : undefined)
    }
    const b = kid(rPr, 'w:b'); if (b) r.b = on(b)
    const i = kid(rPr, 'w:i'); if (i) r.i = on(i)
    const u = kid(rPr, 'w:u'); if (u) r.u = attr(u, 'val') !== 'none'
    const s = kid(rPr, 'w:strike'); if (s) r.strike = on(s)
    const c = attr(kid(rPr, 'w:color'), 'val'); if (c) r.color = c
    const sz = num(attr(kid(rPr, 'w:sz'), 'val')); if (sz) r.sz = sz / 2
    const hl = attr(kid(rPr, 'w:highlight'), 'val'); if (hl && hl !== 'none') r.highlight = HIGHLIGHT[hl]
    const shd = kid(rPr, 'w:shd'); const fill = attr(shd, 'fill')
    if (!r.highlight && fill && fill !== 'auto') r.highlight = '#' + fill.toLowerCase()
    const va = attr(kid(rPr, 'w:vertAlign'), 'val'); if (va === 'superscript' || va === 'subscript') r.vert = va
    return r
  }
  function parseP(pPr: XEl | undefined): PProps {
    const p: PProps = {}
    if (!pPr) return p
    p.styleId = attr(kid(pPr, 'w:pStyle'), 'val')
    const jc = attr(kid(pPr, 'w:jc'), 'val'); if (jc) p.jc = jc
    const sp = kid(pPr, 'w:spacing')
    if (sp) {
      const bf = num(attr(sp, 'before')), af = num(attr(sp, 'after')), ln = num(attr(sp, 'line'))
      if (bf !== undefined) p.before = bf / 20
      if (af !== undefined) p.after = af / 20
      if (ln !== undefined && (attr(sp, 'lineRule') ?? 'auto') === 'auto') p.line = ln / 240
    }
    const ind = kid(pPr, 'w:ind')
    if (ind) {
      const l = num(attr(ind, 'left') ?? attr(ind, 'start')), f = num(attr(ind, 'firstLine')), h = num(attr(ind, 'hanging'))
      if (l !== undefined) p.left = l / 20
      if (f !== undefined) p.first = f / 20
      if (h !== undefined) p.first = -h / 20
    }
    const np = kid(pPr, 'w:numPr')
    if (np) { p.numId = attr(kid(np, 'w:numId'), 'val'); p.ilvl = num(attr(kid(np, 'w:ilvl'), 'val')) ?? 0 }
    if (kid(pPr, 'w:pageBreakBefore')) p.pageBreakBefore = true
    return p
  }

  // ---- styles ----
  const styles = new Map<string, Style>()
  const stylesRoot = xml('word/styles.xml')
  const dd = kid(stylesRoot, 'w:docDefaults')
  const defR = parseR(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'))
  const defP = parseP(kid(kid(dd, 'w:pPrDefault'), 'w:pPr'))
  if (!defR.font) defR.font = themeFont('minor')
  let defaultParaStyle = 'Normal'
  for (const s of kids(stylesRoot, 'w:style')) {
    const id = attr(s, 'styleId')!
    styles.set(id, { id, name: attr(kid(s, 'w:name'), 'val') ?? id, type: attr(s, 'type') ?? 'paragraph', basedOn: attr(kid(s, 'w:basedOn'), 'val'), p: parseP(kid(s, 'w:pPr')), r: parseR(kid(s, 'w:rPr')) })
    if (attr(s, 'type') === 'paragraph' && attr(s, 'default') === '1') defaultParaStyle = id
  }
  const merge = <T extends object>(a: T, b: T): T => ({ ...a, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }) as T
  const chain = (id: string | undefined): Style[] => {
    const out: Style[] = []
    for (let n = 0; id && n < 20; n++) { const s = styles.get(id); if (!s) break; out.unshift(s); id = s.basedOn }
    return out
  }
  const styleEff = (id: string | undefined) => {
    let p: PProps = {}, r: RProps = {}
    for (const s of chain(id)) { p = merge(p, s.p); r = merge(r, s.r) }
    return { p, r }
  }
  /** What "normal text" looks like in this file: the baseline the page draws, so only differences become marks. */
  const normal = styleEff(defaultParaStyle)
  const baseR = merge(defR, normal.r)
  const baseP = merge(defP, normal.p)
  const bodyFont = baseR.font ?? 'Calibri'
  const bodySize = baseR.sz ?? 11

  const styleName = (id: string | undefined) => (id ? styles.get(id)?.name ?? id : '')
  type Kind = { type: 'paragraph' } | { type: 'heading'; level: number } | { type: 'title' } | { type: 'subtitle' } | { type: 'quote' } | { type: 'code' }
  function kindOf(id: string | undefined): Kind {
    for (const s of chain(id).reverse()) {
      const n = s.name.toLowerCase()
      const h = /^heading\s*([1-9])$/.exec(n)
      if (h) return { type: 'heading', level: Math.min(6, Number(h[1])) }
      if (n === 'title') return { type: 'title' }
      if (n === 'subtitle') return { type: 'subtitle' }
      if (n === 'quote' || n === 'intense quote') return { type: 'quote' }
      if (n === 'code block' || n === 'code' || n === 'source code' || n === 'html preformatted' || n === 'plain text') return { type: 'code' }
    }
    return { type: 'paragraph' }
  }

  // ---- numbering ----
  interface Lvl { fmt: string; text: string; start: number }
  const abstracts = new Map<string, Map<number, Lvl>>()
  const numMap = new Map<string, { abs: string; start: Map<number, number> }>()
  const numRoot = xml('word/numbering.xml')
  for (const a of kids(numRoot, 'w:abstractNum')) {
    const lv = new Map<number, Lvl>()
    for (const l of kids(a, 'w:lvl')) lv.set(Number(attr(l, 'ilvl')), { fmt: attr(kid(l, 'w:numFmt'), 'val') ?? 'decimal', text: attr(kid(l, 'w:lvlText'), 'val') ?? '', start: num(attr(kid(l, 'w:start'), 'val')) ?? 1 })
    abstracts.set(attr(a, 'abstractNumId')!, lv)
  }
  for (const n of kids(numRoot, 'w:num')) {
    const start = new Map<number, number>()
    for (const o of kids(n, 'w:lvlOverride')) { const s = num(attr(kid(o, 'w:startOverride'), 'val')); if (s !== undefined) start.set(Number(attr(o, 'ilvl')), s) }
    numMap.set(attr(n, 'numId')!, { abs: attr(kid(n, 'w:abstractNumId'), 'val')!, start })
  }
  const levelOf = (numId: string, ilvl: number) => {
    const n = numMap.get(numId)
    const l = n ? abstracts.get(n.abs)?.get(ilvl) : undefined
    return l ? { ...l, start: n!.start.get(ilvl) ?? l.start } : undefined
  }

  // ---- inline content ----
  type Part = PMNode | 'pagebreak'
  const marksFor = (eff: RProps, direct: boolean, link?: string) => {
    const marks: NonNullable<PMNode['marks']> = []
    const b = baseR
    if (eff.b && (direct || !b.b)) marks.push({ type: 'bold' })
    if (eff.i && (direct || !b.i)) marks.push({ type: 'italic' })
    if (eff.u && !b.u) marks.push({ type: 'underline' })
    if (eff.strike && !b.strike) marks.push({ type: 'strike' })
    if (eff.vert === 'superscript') marks.push({ type: 'superscript' })
    if (eff.vert === 'subscript') marks.push({ type: 'subscript' })
    const ts: Record<string, string> = {}
    if (eff.font && eff.font.toLowerCase() !== bodyFont.toLowerCase()) ts.fontFamily = fontStack(eff.font)
    if (eff.sz && Math.abs(eff.sz - bodySize) > 0.01) ts.fontSize = `${eff.sz}pt`
    if (eff.color && eff.color !== 'auto' && eff.color.toLowerCase() !== '000000' && /^[0-9a-f]{6}$/i.test(eff.color)) ts.color = '#' + eff.color.toLowerCase()
    if (Object.keys(ts).length) marks.push({ type: 'textStyle', attrs: ts })
    if (eff.highlight) marks.push({ type: 'highlight', attrs: { color: eff.highlight } })
    if (link) marks.push({ type: 'link', attrs: { href: link } })
    return marks
  }

  function images(run: XEl, rl: Map<string, { type: string; target: string; external: boolean }>, partDir: string): PMNode[] {
    const out: PMNode[] = []
    const find = (e: XEl, name: string, acc: XEl[] = []): XEl[] => { if (e.name === name) acc.push(e); for (const c of e.children) find(c, name, acc); return acc }
    for (const blip of find(run, 'a:blip')) {
      const rid = attr(blip, 'embed')
      const r = rid ? rl.get(rid) : undefined
      if (!r || r.external) continue
      const path = (r.target.startsWith('/') ? r.target.slice(1) : partDir + r.target).replace(/[^/]+\/\.\.\//g, '')
      const data = zip[path]
      const ext = path.split('.').pop()!.toLowerCase()
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext]
      if (!data || !mime) continue
      const ext1 = find(run, 'wp:extent')[0]
      const w = num(attr(ext1, 'cx')), h = num(attr(ext1, 'cy'))
      const docPr = find(run, 'wp:docPr')[0]
      out.push({ type: 'image', attrs: { src: `data:${mime};base64,${base64(data)}`, alt: attr(docPr, 'descr') ?? null, width: w ? Math.round(w / 9525) : null, height: h ? Math.round(h / 9525) : null } })
    }
    for (const im of find(run, 'v:imagedata')) {
      const rid = attr(im, 'id'); const r = rid ? rl.get(rid) : undefined
      const path = r && !r.external ? partDir + r.target : ''
      const data = zip[path]; const ext = path.split('.').pop()?.toLowerCase()
      const mime = ext && { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' }[ext]
      if (data && mime) out.push({ type: 'image', attrs: { src: `data:${mime};base64,${base64(data)}`, alt: null, width: null, height: null } })
    }
    return out
  }

  function inlineParts(p: XEl, pEff: RProps, direct: boolean, rl: typeof rels, partDir: string): Part[] {
    const parts: Part[] = []
    const fields: { instr: string; phase: 'instr' | 'result'; token?: string; link?: string }[] = []
    const push = (n: PMNode) => parts.push(n)
    const addText = (s: string, marks: NonNullable<PMNode['marks']>) => { if (s) push({ type: 'text', text: s, marks: marks.length ? marks : undefined }) }

    function run(r: XEl, link?: string) {
      const rStyle = attr(kid(kid(r, 'w:rPr'), 'w:rStyle'), 'val')
      let eff = merge(pEff, styleEff(rStyle).r)
      const dr = parseR(kid(r, 'w:rPr'))
      eff = merge(eff, dr)
      const f = fields[fields.length - 1]
      const fieldLink = f?.phase === 'result' ? f.link : undefined
      const marks = marksFor(eff, direct || Object.keys(dr).length > 0, link ?? fieldLink)
      let buf = ''
      const flush = () => { addText(buf, marks); buf = '' }
      for (const c of r.children) {
        switch (c.name) {
          case 'w:t':
            if (f && f.phase === 'instr') break
            if (f && f.token && f.phase === 'result') break
            buf += c.text; break
          case 'w:tab': buf += '\t'; break
          case 'w:noBreakHyphen': buf += '‑'; break
          case 'w:br': {
            const t = attr(c, 'type')
            flush()
            if (t === 'page') parts.push('pagebreak')
            else push({ type: 'hardBreak' })
            break
          }
          case 'w:cr': flush(); push({ type: 'hardBreak' }); break
          case 'w:instrText': if (f) f.instr += c.text; break
          case 'w:fldChar': {
            const t = attr(c, 'fldCharType')
            if (t === 'begin') fields.push({ instr: '', phase: 'instr' })
            else if (t === 'separate' && f) {
              f.phase = 'result'
              const ins = f.instr.trim().toUpperCase()
              if (ins.startsWith('PAGE')) { f.token = '{page}'; flush(); addText('{page}', marks) }
              else if (ins.startsWith('NUMPAGES')) { f.token = '{pages}'; flush(); addText('{pages}', marks) }
              else { const h = /^HYPERLINK\s+"([^"]+)"/i.exec(f.instr.trim()); if (h) f.link = h[1] }
            } else if (t === 'end') fields.pop()
            break
          }
          case 'w:drawing': case 'w:pict': case 'mc:AlternateContent': flush(); for (const im of images(c, rl, partDir)) push(im); break
        }
      }
      flush()
    }
    function walk(e: XEl, link?: string) {
      for (const c of e.children) {
        switch (c.name) {
          case 'w:r': run(c, link); break
          case 'w:hyperlink': {
            const rid = attr(c, 'id'); const t = rid ? rl.get(rid) : undefined
            walk(c, t && t.external ? t.target : link)
            break
          }
          case 'w:fldSimple': {
            const ins = (attr(c, 'instr') ?? '').trim().toUpperCase()
            if (ins.startsWith('PAGE')) addText('{page}', [])
            else if (ins.startsWith('NUMPAGES')) addText('{pages}', [])
            else walk(c, link)
            break
          }
          case 'w:ins': case 'w:smartTag': case 'w:customXml': case 'w:moveTo': walk(c, link); break
          case 'w:sdt': walk(kid(c, 'w:sdtContent') ?? c, link); break
        }
      }
    }
    walk(p)
    return parts
  }

  const mergeText = (nodes: PMNode[]): PMNode[] => {
    const out: PMNode[] = []
    for (const n of nodes) {
      const last = out[out.length - 1]
      if (n.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks ?? null) === JSON.stringify(n.marks ?? null)) last.text = (last.text ?? '') + (n.text ?? '')
      else out.push({ ...n })
    }
    return out
  }

  // ---- blocks ----
  type Li = { __li: true; numId: string; ilvl: number; kind: 'bullet' | 'ordered' | 'task'; checked: boolean; start: number; node: PMNode }
  type Item = PMNode | Li
  const isLi = (x: Item): x is Li => (x as Li).__li === true

  function paraAttrs(direct: PProps, eff: PProps, k: Kind): Record<string, unknown> {
    const a: Record<string, unknown> = {}
    const src = k.type === 'paragraph' || k.type === 'quote' || k.type === 'code' ? eff : direct
    const jc = { center: 'center', right: 'right', both: 'justify', distribute: 'justify', end: 'right' }[src.jc ?? '']
    if (jc) a.textAlign = jc
    if (src.line !== undefined && Math.abs(src.line - DEFAULT_LINE_HEIGHT) > 0.1) a.lineHeight = Math.round(src.line * 100) / 100
    if (src.after !== undefined && Math.abs(src.after - DEFAULT_SPACE_AFTER) > 0.5 && (k.type === 'paragraph' || direct.after !== undefined)) a.spaceAfter = src.after
    if (src.before !== undefined && Math.abs(src.before - DEFAULT_SPACE_BEFORE) > 0.5 && (k.type === 'paragraph' || direct.before !== undefined)) a.spaceBefore = src.before
    if (k.type === 'paragraph') {
      if (src.left) a.indent = Math.max(0, src.left)
      if (src.first) a.firstLine = src.first
      if (k.type === 'paragraph' && styleName(direct.styleId).toLowerCase() === 'title') a.pStyle = 'title'
    }
    return a
  }

  function paragraph(p: XEl, rl: typeof rels, partDir: string): Item[] {
    const direct = parseP(kid(p, 'w:pPr'))
    const k = kindOf(direct.styleId ?? defaultParaStyle)
    const se = styleEff(direct.styleId ?? defaultParaStyle)
    const eff = merge(merge(baseP, se.p), direct)
    const isPlain = k.type === 'paragraph' || k.type === 'quote' || k.type === 'code'
    // Headings and titles are drawn by the page's own styles; only formatting typed directly onto the text is kept.
    const rBase = isPlain ? merge(baseR, se.r) : baseR
    let parts = inlineParts(p, rBase, !isPlain, rl, partDir)
    if (k.type === 'code') parts = parts.map((x) => (typeof x === 'string' ? x : { ...x, marks: undefined }))
    const out: Item[] = []
    if (direct.pageBreakBefore) out.push({ type: 'pageBreak' })
    const flush = (content: PMNode[], force = false) => {
      content = mergeText(content)
      if (!content.length && !force) return
      const attrs = paraAttrs(direct, eff, k)
      const node: PMNode =
        k.type === 'heading' ? { type: 'heading', attrs: { level: k.level, ...attrs }, content }
        : k.type === 'code' ? { type: 'codeBlock', content: content.length ? [{ type: 'text', text: content.map((c) => c.text ?? '').join('') }] : undefined }
        : { type: 'paragraph', attrs: k.type === 'title' || k.type === 'subtitle' ? { ...attrs, pStyle: k.type } : attrs, content: content.length ? content : undefined }
      if (!node.content) delete node.content
      if (k.type === 'quote') out.push({ type: 'blockquote', content: [node] })
      else if (direct.numId && direct.numId !== '0' && k.type !== 'heading') {
        const lv = levelOf(direct.numId, direct.ilvl ?? 0)
        if (lv) {
          const task = lv.fmt === 'bullet' && /[☐☑☒]/.test(lv.text)
          const kind = task ? 'task' : lv.fmt === 'bullet' ? 'bullet' : 'ordered'
          const li: Li = { __li: true, numId: direct.numId, ilvl: direct.ilvl ?? 0, kind, checked: task && /[☑☒]/.test(lv.text), start: lv.start, node: { type: 'paragraph', attrs: { ...(attrs.textAlign ? { textAlign: attrs.textAlign } : {}) }, content: node.content } }
          if (!node.content) delete li.node.content
          out.push(li)
        } else out.push(node)
      } else out.push(node)
    }
    let cur: PMNode[] = []
    let first = true
    for (const part of parts) {
      if (part === 'pagebreak') { flush(cur, first && cur.length === 0 ? false : false); cur = []; out.push({ type: 'pageBreak' }); first = false }
      else cur.push(part)
    }
    flush(cur, out.length === 0 || !out.some((x) => !isLi(x) && x.type === 'pageBreak'))
    return out
  }

  function table(t: XEl, rl: typeof rels, partDir: string): PMNode {
    const grid = kids(kid(t, 'w:tblGrid'), 'w:gridCol').map((g) => (num(attr(g, 'w')) ?? 0) / 15)
    const rows: PMNode[] = []
    const open = new Map<number, PMNode>() // column -> the cell a vertical merge started in
    for (const tr of kids(t, 'w:tr')) {
      const header = !!kid(kid(tr, 'w:trPr'), 'w:tblHeader')
      const cells: PMNode[] = []
      let col = 0
      for (const tc of kids(tr, 'w:tc')) {
        const pr = kid(tc, 'w:tcPr')
        const span = num(attr(kid(pr, 'w:gridSpan'), 'val')) ?? 1
        const vm = kid(pr, 'w:vMerge')
        if (vm && attr(vm, 'val') !== 'restart') {
          const owner = open.get(col)
          if (owner) owner.attrs!.rowspan = (owner.attrs!.rowspan as number) + 1
          col += span
          continue
        }
        const fill = attr(kid(pr, 'w:shd'), 'fill')
        const w = grid.slice(col, col + span)
        const tcW = (num(attr(kid(pr, 'w:tcW'), 'w')) ?? 0) / 15
        const widths = span === 1 ? [Math.round(w[0] || tcW) || null] : w.length === span ? w.map(Math.round) : null
        const blocks = groupLists(bodyItems(tc, rl, partDir))
        const cell: PMNode = {
          type: header ? 'tableHeader' : 'tableCell',
          attrs: { colspan: span, rowspan: 1, colwidth: widths && widths.every(Boolean) ? widths : null, backgroundColor: fill && fill !== 'auto' ? '#' + fill.toLowerCase() : null },
          content: blocks.length ? blocks : [{ type: 'paragraph' }],
        }
        if (vm) open.set(col, cell)
        else for (let i = 0; i < span; i++) open.delete(col + i)
        cells.push(cell)
        col += span
      }
      if (cells.length) rows.push({ type: 'tableRow', content: cells })
    }
    return { type: 'table', content: rows }
  }

  function bodyItems(container: XEl | undefined, rl: typeof rels, partDir: string): Item[] {
    const out: Item[] = []
    for (const c of container?.children ?? []) {
      if (c.name === 'w:p') out.push(...paragraph(c, rl, partDir))
      else if (c.name === 'w:tbl') out.push(table(c, rl, partDir))
      else if (c.name === 'w:sdt') out.push(...bodyItems(kid(c, 'w:sdtContent'), rl, partDir))
    }
    return out
  }

  /** Turns flat "list paragraphs" into nested lists, and merges neighbouring quote and code paragraphs. */
  function groupLists(items: Item[]): PMNode[] {
    const out: PMNode[] = []
    let stack: { level: number; list: PMNode; numId: string; kind: Li['kind'] }[] = []
    const closeLists = () => { stack = [] }
    for (const it of items) {
      if (!isLi(it)) {
        closeLists()
        const last = out[out.length - 1]
        if (it.type === 'blockquote' && last?.type === 'blockquote') last.content!.push(...it.content!)
        else if (it.type === 'codeBlock' && last?.type === 'codeBlock') last.content = [{ type: 'text', text: (last.content?.[0]?.text ?? '') + '\n' + (it.content?.[0]?.text ?? '') }]
        else out.push(it)
        continue
      }
      const listType = it.kind === 'task' ? 'taskList' : it.kind === 'ordered' ? 'orderedList' : 'bulletList'
      const itemNode: PMNode = it.kind === 'task' ? { type: 'taskItem', attrs: { checked: it.checked }, content: [it.node] } : { type: 'listItem', content: [it.node] }
      while (stack.length && stack[stack.length - 1].level > it.ilvl) stack.pop()
      let top = stack[stack.length - 1]
      if (top && top.level === it.ilvl && (top.kind !== it.kind || (it.kind !== 'task' && top.numId !== it.numId))) { stack.pop(); top = stack[stack.length - 1] }
      if (!top || top.level < it.ilvl) {
        const list: PMNode = { type: listType, content: [], ...(it.kind === 'ordered' && it.start !== 1 ? { attrs: { start: it.start } } : {}) }
        if (top) { const parentItem = top.list.content![top.list.content!.length - 1]; parentItem.content!.push(list) }
        else out.push(list)
        stack.push({ level: it.ilvl, list, numId: it.numId, kind: it.kind })
        top = stack[stack.length - 1]
      }
      top.list.content!.push(itemNode)
    }
    return out
  }

  // ---- header / footer ----
  function headerFooter(type: 'header' | 'footer'): HeaderFooter {
    const hf: HeaderFooter = { left: '', center: '', right: '' }
    const sect = lastSect
    const ref = kids(sect, type === 'header' ? 'w:headerReference' : 'w:footerReference').find((r) => attr(r, 'type') === 'default') ?? kids(sect, type === 'header' ? 'w:headerReference' : 'w:footerReference')[0]
    const rid = attr(ref, 'id'); const target = rid ? rels.get(rid)?.target : undefined
    if (!target) return hf
    const part = resolvePart(target)
    const root = xml(part)
    if (!root) return hf
    const rl = relsOf(part)
    const dir = part.slice(0, part.lastIndexOf('/') + 1)
    const pEl = kids(root, 'w:p').find((p) => inlineParts(p, baseR, false, rl, dir).some((x) => typeof x !== 'string' && (x.text ?? '').trim()))
    if (!pEl) return hf
    const jc = attr(kid(kid(pEl, 'w:pPr'), 'w:jc'), 'val')
    const segs: string[] = ['']
    for (const part of inlineParts(pEl, baseR, false, rl, dir)) {
      if (typeof part === 'string') continue
      if (part.type === 'text') {
        const pieces = (part.text ?? '').split('\t')
        pieces.forEach((s, i) => { if (i > 0) segs.push(''); segs[segs.length - 1] += s })
      }
    }
    const clean = segs.map((s) => s.trim())
    if (clean.length === 1) hf[jc === 'center' ? 'center' : jc === 'right' ? 'right' : 'left'] = clean[0]
    else if (clean.length === 2) { hf.left = clean[0]; hf.right = clean[1] }
    else { hf.left = clean[0]; hf.center = clean[1]; hf.right = clean.slice(2).join(' ') }
    return hf
  }

  // ---- go ----
  const sects = kids(body, 'w:sectPr')
  let lastSect = sects[sects.length - 1]
  if (!lastSect) for (const p of kids(body, 'w:p')) { const s = kid(kid(p, 'w:pPr'), 'w:sectPr'); if (s) lastSect = s }
  const items = bodyItems(body, rels, 'word/')
  const content = groupLists(items)

  const settings: PageSettings = { ...DEFAULT_SETTINGS, margins: { ...DEFAULT_SETTINGS.margins }, bodyFont, bodySize }
  const pg = kid(lastSect, 'w:pgSz'), mg = kid(lastSect, 'w:pgMar')
  if (pg) {
    let w = (num(attr(pg, 'w')) ?? 12240) / 1440, h = (num(attr(pg, 'h')) ?? 15840) / 1440
    const land = attr(pg, 'orient') === 'landscape' || w > h
    if (land) [w, h] = [Math.min(w, h), Math.max(w, h)]
    let best = 'letter', diff = Infinity
    for (const [k, v] of Object.entries(PAGE_SIZES)) { const d = Math.abs(v.w - w) + Math.abs(v.h - h); if (d < diff) { diff = d; best = k } }
    settings.size = best as PageSettings['size']
    settings.orientation = land ? 'landscape' : 'portrait'
  }
  if (mg) {
    const inch = (n: string, d: number) => (num(attr(mg, n)) ?? d * 1440) / 1440
    settings.margins = { top: inch('top', 1), right: inch('right', 1), bottom: inch('bottom', 1), left: inch('left', 1) }
  }
  if (lastSect) { settings.header = headerFooter('header'); settings.footer = headerFooter('footer') }

  const core = xml('docProps/core.xml')
  const title = kid(core, 'dc:title')?.text.trim() || fileName.replace(/\.docx$/i, '')
  const doc = content.length ? { type: 'doc' as const, content } : emptyDoc()
  return { title, doc, settings }
}
