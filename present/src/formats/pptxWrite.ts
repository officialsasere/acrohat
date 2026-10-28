import { strToU8, zipSync } from 'fflate'
import { escapeXml as esc } from '../../../shared/xml'
import { css, findEl, hexToRgb, type Anim, type ChartEl, type Color, type Deck, type El, type Fill, type GroupEl, type ImageEl, type Layout, type Line, type LineEl, type Para, type Run, type ShapeEl, type Shadow, type Slide, type TableEl, type Text, type TextStyle, type Theme, type Transition } from '../model'
import { adjCount } from '../geom'
import { baseSize, HANG, LEVEL_STEP } from '../richtext'
import { cellLook } from '../render/Slide'
import { buildSteps } from '../show/anim'
import { ANIM_PRESET, ARROW_OUT, BULLET_CHAR, CT, DASH_OUT, MIME_EXT, NS_A, NS_P, NS_R, NUM_OUT, PH_OUT, REL, SCHEME, dataUrlToBytes, emu } from './ooxml'
import { writeSheetXlsx } from './miniXlsx'

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`
interface Rel { id: string; type: string; target: string; external?: boolean }
const relsXml = (list: Rel[]) => XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`

class Part {
  rels: Rel[] = []
  n = 1
  add(type: string, target: string, external = false): string {
    const hit = this.rels.find((r) => r.type === type && r.target === target)
    if (hit) return hit.id
    const id = `rId${this.n++}`
    this.rels.push({ id, type, target, external })
    return id
  }
}

interface Out {
  files: Record<string, Uint8Array>
  overrides: [string, string][]
  defaults: Map<string, string>
  mediaFiles: Map<string, string>
  charts: number
}

const hex = (c: string, th: Theme) => { const v = css(c, th, '#000000'); return /^#[0-9a-f]{6}$/i.test(v) ? v.slice(1).toUpperCase() : '000000' }
function clr(c: Color | undefined, th: Theme, alpha?: number): string {
  if (!c || c === 'transparent') return ''
  const a = alpha !== undefined && alpha < 1 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : ''
  if (c[0] === '@') return `<a:schemeClr val="${SCHEME[c.slice(1) as keyof typeof SCHEME] ?? 'tx1'}">${a}</a:schemeClr>`
  return `<a:srgbClr val="${hex(c, th)}">${a}</a:srgbClr>`
}
const solid = (c: Color | undefined, th: Theme, alpha?: number) => (c ? `<a:solidFill>${clr(c, th, alpha)}</a:solidFill>` : '')

function fillXml(f: Fill | undefined, th: Theme, part: Part, out: Out, deck: Deck, alpha?: number): string {
  if (!f) return '<a:noFill/>'
  if (f.t === 'solid') return solid(f.c, th, f.a !== undefined && f.a < 1 ? f.a * (alpha ?? 1) : alpha)
  if (f.t === 'grad') {
    const stops = f.stops.map((s) => `<a:gs pos="${Math.round(s.p * 100000)}">${clr(s.c, th)}</a:gs>`).join('')
    return f.radial ? `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>` : `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(((f.angle % 360) + 360) % 360 * 60000)}" scaled="0"/></a:gradFill>`
  }
  const rid = mediaRel(f.media, part, out, deck)
  if (!rid) return '<a:noFill/>'
  return `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid}"/><a:srcRect/>${f.mode === 'tile' ? '<a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>' : '<a:stretch><a:fillRect/></a:stretch>'}</a:blipFill>`
}

function mediaRel(id: string, part: Part, out: Out, deck: Deck): string | null {
  let name = out.mediaFiles.get(id)
  if (!name) {
    const m = deck.media[id]
    const b = m && dataUrlToBytes(m.data)
    if (!b) return null
    const ext = MIME_EXT[b.mime] ?? 'png'
    name = `media/image${out.mediaFiles.size + 1}.${ext}`
    out.files[`ppt/${name}`] = b.bytes
    out.defaults.set(ext, b.mime === 'image/jpg' ? 'image/jpeg' : b.mime)
    out.mediaFiles.set(id, name)
  }
  return part.add(REL.image, `../${name}`)
}

function lnXml(l: Line | undefined, th: Theme): string {
  if (!l || l.w <= 0) return '<a:ln><a:noFill/></a:ln>'
  const head = ARROW_OUT[l.head ?? 'none'], tail = ARROW_OUT[l.tail ?? 'none']
  return `<a:ln w="${emu(l.w)}" cap="flat">${solid(l.c, th, l.a)}<a:prstDash val="${DASH_OUT[l.dash ?? 'solid']}"/><a:round/>${head ? `<a:headEnd type="${head}"/>` : ''}${tail ? `<a:tailEnd type="${tail}"/>` : ''}</a:ln>`
}
function shadowXml(s: Shadow | undefined, th: Theme): string {
  if (!s) return ''
  const dist = Math.hypot(s.dx, s.dy), dir = Math.round(((Math.atan2(s.dy, s.dx) * 180) / Math.PI + 360) % 360 * 60000)
  return `<a:effectLst><a:outerShdw blurRad="${emu(s.blur)}" dist="${emu(dist)}" dir="${dir}" algn="ctr" rotWithShape="0">${clr(s.c, th, s.a)}</a:outerShdw></a:effectLst>`
}

// ---------------------------------------------------------------- text

const fontRef = (f: string | undefined) => (!f || f === '+body' ? '+mn-lt' : f === '+head' ? '+mj-lt' : f)
function rPr(r: Run, st: TextStyle | undefined, role: ShapeEl['ph'] | undefined, level: number, th: Theme, part: Part, tag = 'a:rPr'): string {
  const sz = r.sz ?? baseSize(st, role?.role, level)
  const b = r.b ?? st?.b, i = r.i ?? st?.i
  const attrs = [`lang="en-US"`, `sz="${Math.round(sz * 100)}"`, b ? 'b="1"' : r.b === false ? 'b="0"' : '', i ? 'i="1"' : '', r.u ? 'u="sng"' : '', r.s ? 'strike="sngStrike"' : '', r.base ? `baseline="${r.base * 30000}"` : '', 'dirty="0"'].filter(Boolean).join(' ')
  const color = r.c ?? st?.c ?? '@text'
  return `<${tag} ${attrs}>${solid(color, th)}${r.hl ? `<a:highlight>${clr(r.hl, th)}</a:highlight>` : ''}<a:latin typeface="${esc(fontRef(r.f ?? st?.f))}"/>${r.link ? hlink(r.link, part) : ''}</${tag}>`
}
function hlink(url: string, part: Part) {
  const rid = part.add(REL.hyperlink, url, true)
  return `<a:hlinkClick r:id="${rid}"/>`
}

function paraXml(p: Para, st: TextStyle | undefined, ph: ShapeEl['ph'] | undefined, th: Theme, part: Part): string {
  const lvl = p.level ?? 0
  const bullet = p.bullet ?? st?.bullet ?? 'none'
  const hasB = bullet !== 'none'
  const marL = (hasB ? HANG : 0) + LEVEL_STEP * lvl
  const algn = { left: 'l', center: 'ctr', right: 'r', justify: 'just' }[p.align ?? st?.align ?? 'left']
  const lh = p.lh ?? st?.lh, before = p.before ?? st?.before, after = p.after ?? st?.after
  const first = p.runs.find((r) => r.t !== '\n')
  const bu = !hasB ? '<a:buNone/>' : NUM_OUT[bullet] ? `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${NUM_OUT[bullet]}"/>` : `<a:buFont typeface="Arial"/><a:buChar char="${BULLET_CHAR[bullet] ?? '•'}"/>`
  const ppr = `<a:pPr marL="${emu(marL)}" indent="${emu(-(hasB ? HANG : 0))}" algn="${algn}"${lvl ? ` lvl="${lvl}"` : ''}>${lh ? `<a:lnSpc><a:spcPct val="${Math.round(lh * 100000)}"/></a:lnSpc>` : ''}${before ? `<a:spcBef><a:spcPts val="${Math.round(before * 100)}"/></a:spcBef>` : ''}${after ? `<a:spcAft><a:spcPts val="${Math.round(after * 100)}"/></a:spcAft>` : ''}${hasB ? `<a:buClr>${clr(first?.c ?? st?.c ?? '@text', th)}</a:buClr>` : ''}${bu}</a:pPr>`
  const runs = p.runs.map((r) => (r.t === '\n' ? `<a:br>${rPr({ t: '' }, st, ph, lvl, th, part)}</a:br>` : `<a:r>${rPr(r, st, ph, lvl, th, part)}<a:t>${esc(r.t)}</a:t></a:r>`)).join('')
  return `<a:p>${ppr}${runs}${rPr({ t: '' }, st, ph, lvl, th, part, 'a:endParaRPr')}</a:p>`
}

function txBody(t: Text | undefined, st: TextStyle | undefined, ph: ShapeEl['ph'] | undefined, th: Theme, part: Part, tag = 'p:txBody'): string {
  const text = t ?? { paras: [{ runs: [] }] }
  const ins = text.inset ?? [7.2, 3.6, 7.2, 3.6]
  const anchor = text.v === 'middle' ? 'ctr' : text.v === 'bottom' ? 'b' : 't'
  const fit = text.fit === 'shrink' ? '<a:normAutofit/>' : '<a:noAutofit/>'
  return `<${tag}><a:bodyPr wrap="${text.wrap === false ? 'none' : 'square'}" lIns="${emu(ins[0])}" tIns="${emu(ins[1])}" rIns="${emu(ins[2])}" bIns="${emu(ins[3])}" anchor="${anchor}"${text.cols && text.cols > 1 ? ` numCol="${text.cols}"` : ''} rtlCol="0">${fit}</a:bodyPr><a:lstStyle/>${text.paras.map((p) => paraXml(p, st, ph, th, part)).join('')}</${tag}>`
}

// ---------------------------------------------------------------- shapes

interface Ctx { deck: Deck; th: Theme; part: Part; out: Out; ids: Map<string, number>; next: number; slideRels?: Map<string, string> }
const nid = (c: Ctx, id: string) => { const n = c.next++; c.ids.set(id, n); return n }
const xfrm = (e: El, tag = 'a:xfrm', extra = '') => `<${tag}${e.rot ? ` rot="${Math.round(e.rot * 60000)}"` : ''}${e.flipH ? ' flipH="1"' : ''}${e.flipV ? ' flipV="1"' : ''}${extra}><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/></${tag}>`
const linkXml = (e: El, c: Ctx): string => {
  if (!e.link) return ''
  if (e.link.url) return hlink(e.link.url, c.part)
  if (e.link.slide && c.slideRels?.has(e.link.slide)) { const rid = c.part.add(REL.slide, c.slideRels.get(e.link.slide)!); return `<a:hlinkClick r:id="${rid}" action="ppaction://hlinksldjump"/>` }
  return ''
}
const cNvPr = (e: El, id: number, c: Ctx) => `<p:cNvPr id="${id}" name="${esc(e.name || `${e.type} ${id}`)}"${e.alt ? ` descr="${esc(e.alt)}"` : ''}>${linkXml(e, c)}</p:cNvPr>`

function custXml(c: NonNullable<ShapeEl['cust']>): string {
  const pts = (n: number[]) => { let o = ''; for (let i = 0; i + 1 < n.length; i += 2) o += `<a:pt x="${Math.round(n[i])}" y="${Math.round(n[i + 1])}"/>`; return o }
  let body = ''
  for (const m of c.d.matchAll(/([MLCQAZ])([^MLCQAZ]*)/g)) {
    const n = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    if (m[1] === 'M') body += `<a:moveTo>${pts(n)}</a:moveTo>`
    else if (m[1] === 'L') body += `<a:lnTo>${pts(n)}</a:lnTo>`
    else if (m[1] === 'C') body += `<a:cubicBezTo>${pts(n)}</a:cubicBezTo>`
    else if (m[1] === 'Q') body += `<a:quadBezTo>${pts(n)}</a:quadBezTo>`
    else if (m[1] === 'A') body += `<a:lnTo>${pts(n.slice(5))}</a:lnTo>`
    else body += '<a:close/>'
  }
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${Math.round(c.w)}" h="${Math.round(c.h)}">${body}</a:path></a:pathLst></a:custGeom>`
}
function geomXml(geom: string, adj: number[] | undefined): string {
  const n = adjCount(geom)
  const gd = n && adj?.length ? adj.slice(0, n).map((v, i) => `<a:gd name="${n === 1 ? 'adj' : `adj${i + 1}`}" fmla="val ${Math.round(v)}"/>`).join('') : ''
  return `<a:prstGeom prst="${geom}"><a:avLst>${gd}</a:avLst></a:prstGeom>`
}

function shapeXml(e: ShapeEl, c: Ctx): string {
  const id = nid(c, e.id)
  const isBox = !e.ph && e.geom === 'rect' && !e.fill && !(e.line && e.line.w > 0)
  const nv = `<p:nvPr>${e.ph ? `<p:ph type="${PH_OUT[e.ph.role] ?? 'body'}"${e.ph.idx ? ` idx="${e.ph.idx}"` : ''}/>` : ''}</p:nvPr>`
  return `<p:sp><p:nvSpPr>${cNvPr(e, id, c)}<p:cNvSpPr${isBox ? ' txBox="1"' : ''}/>${nv}</p:nvSpPr><p:spPr>${xfrm(e)}${e.cust ? custXml(e.cust) : geomXml(e.geom, e.adj)}${fillXml(e.fill, c.th, c.part, c.out, c.deck, e.opacity)}${lnXml(e.line, c.th)}${shadowXml(e.shadow, c.th)}</p:spPr>${txBody(e.text, e.st, e.ph, c.th, c.part)}</p:sp>`
}
function lineXml(e: LineEl, c: Ctx): string {
  const id = nid(c, e.id)
  const prst = e.kind === 'elbow' ? 'bentConnector3' : e.kind === 'curve' ? 'curvedConnector3' : 'line'
  return `<p:cxnSp><p:nvCxnSpPr>${cNvPr(e, id, c)}<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(e)}<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${lnXml(e.line, c.th)}${shadowXml(e.shadow, c.th)}</p:spPr></p:cxnSp>`
}
function picXml(e: ImageEl, c: Ctx): string {
  const id = nid(c, e.id)
  const rid = mediaRel(e.media, c.part, c.out, c.deck)
  if (!rid) return ''
  const cr = e.crop
  const src = cr ? `<a:srcRect l="${Math.round(cr.l * 100000)}" t="${Math.round(cr.t * 100000)}" r="${Math.round(cr.r * 100000)}" b="${Math.round(cr.b * 100000)}"/>` : ''
  return `<p:pic><p:nvPicPr>${cNvPr(e, id, c)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"${e.opacity !== undefined && e.opacity < 1 ? '' : ''}>${e.opacity !== undefined && e.opacity < 1 ? `<a:alphaModFix amt="${Math.round(e.opacity * 100000)}"/>` : ''}</a:blip>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(e)}${geomXml(e.geom ?? 'rect', undefined)}${lnXml(e.line, c.th)}${shadowXml(e.shadow, c.th)}</p:spPr></p:pic>`
}

function tableXml(e: TableEl, c: Ctx): string {
  const id = nid(c, e.id)
  const th = c.th
  const rows = e.rows.map((row, r) => `<a:tr h="${emu(row.h)}">${row.cells.map((cell, ci) => {
    if (cell.covered) {
      // Cells swallowed by a merge: find which direction.
      let hm = false, vm = false
      for (let rr = r; rr >= 0 && !hm && !vm; rr--) for (let cc = ci; cc >= 0; cc--) { const o = e.rows[rr].cells[cc]; if (o.span && rr + o.span.r > r && cc + o.span.c > ci) { if (rr === r) hm = true; else vm = true; if (cc !== ci && rr !== r) hm = true; break } }
      return `<a:tc${hm ? ' hMerge="1"' : ''}${vm ? ' vMerge="1"' : ''}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>`
    }
    const look = cellLook(e, r, ci, th)
    const bg = cell.fill ?? { t: 'solid' as const, c: /^#/.test(look.bg) ? look.bg : look.bg.startsWith('rgb') ? '#' + (look.bg.match(/\d+/g) ?? ['255', '255', '255']).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#ffffff' }
    const st: TextStyle = { sz: 18, c: cell.fill ? undefined : look.fg.startsWith('#') ? look.fg : '@text', b: e.style.header && r === 0 ? true : undefined }
    const border = e.style.borders ? `<a:lnL w="12700">${solid('@bg', th)}</a:lnL><a:lnR w="12700">${solid('@bg', th)}</a:lnR><a:lnT w="12700">${solid('@bg', th)}</a:lnT><a:lnB w="12700">${solid('@bg', th)}</a:lnB>` : ''
    return `<a:tc${cell.span?.c ? ` gridSpan="${cell.span.c}"` : ''}${cell.span?.r ? ` rowSpan="${cell.span.r}"` : ''}>${txBody(cell.text, st, undefined, th, c.part, 'a:txBody').replace(/<a:bodyPr[^>]*>.*?<\/a:bodyPr>/, '<a:bodyPr/>')}<a:tcPr marL="${emu(8)}" marR="${emu(8)}" marT="${emu(4)}" marB="${emu(4)}" anchor="${cell.v === 'top' ? 't' : cell.v === 'bottom' ? 'b' : 'ctr'}">${border}${fillXml(bg, th, c.part, c.out, c.deck)}</a:tcPr></a:tc>`
  }).join('')}</a:tr>`).join('')
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(e, id, c)}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(e, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${e.style.header ? ' firstRow="1"' : ''}${e.style.banded ? ' bandRow="1"' : ''}${e.style.firstCol ? ' firstCol="1"' : ''}/><a:tblGrid>${e.cols.map((w) => `<a:gridCol w="${emu(w)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

function chartXml(e: ChartEl, c: Ctx): string {
  const id = nid(c, e.id)
  const n = ++c.out.charts
  const chartPath = `charts/chart${n}.xml`
  const xl = `embeddings/workbook${n}.xlsx`
  c.out.files[`ppt/${chartPath}`] = strToU8(buildChart(e, c.th, xl))
  c.out.files[`ppt/${xl}`] = writeSheetXlsx(chartTable(e))
  c.out.overrides.push([`/ppt/${chartPath}`, CT.chart])
  c.out.defaults.set('xlsx', CT.xlsx)
  const crel = new Part()
  crel.add(REL.pkg, `../${xl}`)
  c.out.files[`ppt/charts/_rels/chart${n}.xml.rels`] = strToU8(relsXml(crel.rels))
  const rid = c.part.add(REL.chart, `../${chartPath}`)
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(e, id, c)}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(e, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`
}

const colName = (i: number) => String.fromCharCode(65 + i)
function chartTable(e: ChartEl): (string | number)[][] {
  if (e.kind === 'scatter') {
    const rows: (string | number)[][] = [['X', ...e.series.map((s) => s.name)]]
    const n = Math.max(...e.series.map((s) => s.vals.length), 0)
    for (let i = 0; i < n; i++) rows.push([e.series[0]?.xs?.[i] ?? i + 1, ...e.series.map((s) => s.vals[i] ?? '')])
    return rows
  }
  const rows: (string | number)[][] = [['', ...e.series.map((s) => s.name)]]
  const n = Math.max(e.cats.length, ...e.series.map((s) => s.vals.length), 0)
  for (let i = 0; i < n; i++) rows.push([e.cats[i] ?? '', ...e.series.map((s) => s.vals[i] ?? '')])
  return rows
}

const ORDER = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
function buildChart(e: ChartEl, th: Theme, _xl: string): string {
  const n = Math.max(e.cats.length, ...e.series.map((s) => s.vals.length), 0)
  const txt = (v: string) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${esc(v)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/>`
  const catRef = (i: number) => e.kind === 'scatter' ? `<c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${Array.from({ length: n }, (_, k) => `<c:pt idx="${k}"><c:v>${e.series[i]?.xs?.[k] ?? k + 1}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:xVal>` : `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${n}"/>${Array.from({ length: n }, (_, k) => `<c:pt idx="${k}"><c:v>${esc(e.cats[k] ?? '')}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat>`
  const ser = e.series.map((s, i) => {
    const color = s.color ?? `@${ORDER[i % 6]}`
    const col = colName(i + 1)
    const sp = e.kind === 'line' || e.kind === 'scatter' || e.kind === 'radar' ? `<c:spPr><a:ln w="28575" cap="rnd">${solid(color, th)}<a:round/></a:ln></c:spPr>` : `<c:spPr>${solid(color, th)}</c:spPr>`
    const dpt = e.kind === 'pie' || e.kind === 'doughnut' ? e.cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr>${solid(`@${ORDER[k % 6]}`, th)}<a:ln w="12700">${solid('@bg', th)}</a:ln></c:spPr></c:dPt>`).join('') : ''
    const marker = e.kind === 'line' ? `<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>` : e.kind === 'scatter' ? `<c:marker><c:symbol val="circle"/><c:size val="8"/><c:spPr>${solid(color, th)}</c:spPr></c:marker>` : ''
    const val = `<c:${e.kind === 'scatter' ? 'yVal' : 'val'}><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${Array.from({ length: n }, (_, k) => (s.vals[k] === undefined ? '' : `<c:pt idx="${k}"><c:v>${s.vals[k]}</c:v></c:pt>`)).join('')}</c:numCache></c:numRef></c:${e.kind === 'scatter' ? 'yVal' : 'val'}>`
    const dl = e.labels ? `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="${e.kind === 'pie' || e.kind === 'doughnut' ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${e.kind === 'pie' || e.kind === 'doughnut' ? 1 : 0}"/><c:showBubbleSize val="0"/></c:dLbls>` : ''
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>${sp}${e.kind === 'line' || e.kind === 'scatter' ? marker : e.kind === 'column' || e.kind === 'bar' ? '<c:invertIfNegative val="0"/>' : ''}${dpt}${dl}${catRef(i)}${val}${e.kind === 'line' ? `<c:smooth val="${e.smooth ? 1 : 0}"/>` : e.kind === 'scatter' ? '<c:smooth val="0"/>' : ''}</c:ser>`
  }).join('')
  const grouping = e.grouping === 'stacked' ? 'stacked' : e.grouping === 'percent' ? 'percentStacked' : 'clustered'
  const axes = '<c:axId val="111111111"/><c:axId val="222222222"/>'
  let plot: string
  switch (e.kind) {
    case 'column': case 'bar': plot = `<c:barChart><c:barDir val="${e.kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>${ser}<c:gapWidth val="80"/>${grouping !== 'clustered' ? '<c:overlap val="100"/>' : ''}${axes}</c:barChart>`; break
    case 'line': plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/>${axes}</c:lineChart>`; break
    case 'area': plot = `<c:areaChart><c:grouping val="${e.grouping === 'clustered' ? 'standard' : grouping}"/><c:varyColors val="0"/>${ser}${axes}</c:areaChart>`; break
    case 'pie': plot = `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/></c:pieChart>`; break
    case 'doughnut': plot = `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`; break
    case 'scatter': plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}${axes}</c:scatterChart>`; break
    default: plot = `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${ser}${axes}</c:radarChart>`
  }
  const hasAxes = !(e.kind === 'pie' || e.kind === 'doughnut')
  const ax = hasAxes ? (e.kind === 'scatter'
    ? `<c:valAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${e.xTitle ? `<c:title>${txt(e.xTitle)}</c:title>` : ''}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
    : `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${e.kind === 'bar' ? 'l' : 'b'}"/>${e.xTitle ? `<c:title>${txt(e.xTitle)}</c:title>` : ''}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`)
    + `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${e.kind === 'bar' ? 'b' : 'l'}"/>${e.grid ? '<c:majorGridlines/>' : ''}${e.yTitle ? `<c:title>${txt(e.yTitle)}</c:title>` : ''}<c:numFmt formatCode="${e.grouping === 'percent' ? '0%' : 'General'}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` : ''
  const legend = e.legend !== 'none' ? `<c:legend><c:legendPos val="${{ top: 't', right: 'r', bottom: 'b' }[e.legend]}"/><c:overlay val="0"/></c:legend>` : ''
  return XML + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>${e.title ? `<c:title>${txt(e.title)}</c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>'}<c:plotArea><c:layout/>${plot}${ax}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200">${solid('@text2', th)}</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
}

function groupXml(e: GroupEl, c: Ctx): string {
  const id = nid(c, e.id)
  const kids = e.children.map((k) => elXml(k, c)).join('')
  return `<p:grpSp><p:nvGrpSpPr>${cNvPr(e, id, c)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(e, 'a:xfrm', '').replace('</a:xfrm>', `<a:chOff x="${emu(e.x)}" y="${emu(e.y)}"/><a:chExt cx="${emu(e.w)}" cy="${emu(e.h)}"/></a:xfrm>`)}</p:grpSpPr>${kids}</p:grpSp>`
}

function elXml(e: El, c: Ctx): string {
  switch (e.type) {
    case 'shape': return shapeXml(e, c)
    case 'line': return lineXml(e, c)
    case 'image': return picXml(e, c)
    case 'table': return tableXml(e, c)
    case 'chart': return chartXml(e, c)
    case 'group': return groupXml(e, c)
    default: return '' // video and audio are kept only in the Kwiiva copy of the deck
  }
}

// ---------------------------------------------------------------- slide parts

const SPTREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

function bgXml(f: Fill | undefined, c: Ctx): string {
  if (!f) return ''
  return `<p:bg><p:bgPr>${fillXml(f, c.th, c.part, c.out, c.deck)}<a:effectLst/></p:bgPr></p:bg>`
}

function transitionXml(t: Transition | undefined, auto: number | undefined, useTimings: boolean): string {
  if ((!t || t.kind === 'none') && !auto) return ''
  const spd = !t ? 'med' : t.dur < 0.5 ? 'fast' : t.dur <= 1.2 ? 'med' : 'slow'
  const dir = { left: 'r', right: 'l', up: 'd', down: 'u' }[t?.dir ?? 'left']
  const body = !t || t.kind === 'none' ? '' : {
    fade: '<p:fade/>', dissolve: '<p:dissolve/>', push: `<p:push dir="${dir}"/>`, wipe: `<p:wipe dir="${dir}"/>`, cover: `<p:cover dir="${dir}"/>`, uncover: `<p:pull dir="${dir}"/>`,
    zoom: '<p:zoom dir="in"/>', split: '<p:split orient="vert" dir="out"/>', blinds: '<p:blinds dir="horz"/>', flip: '<p:fade/>', cube: '<p:fade/>', morph: '<p:fade/>',
  }[t.kind] ?? '<p:fade/>'
  return `<p:transition spd="${spd}"${auto && useTimings ? ` advTm="${Math.round(auto * 1000)}"` : ''}>${body}</p:transition>`
}

const SUB: Record<string, number> = { left: 8, right: 2, up: 1, down: 4 }
function timingXml(slide: Slide, c: Ctx): string {
  const steps = buildSteps(slide)
  if (!steps.length) return ''
  let id = 3
  const tgt = (a: Anim, para?: number) => {
    const spid = c.ids.get(a.target)
    return spid === undefined ? '' : `<p:tgtEl><p:spTgt spid="${spid}">${para !== undefined ? `<p:txEl><p:pRg st="${para}" end="${para}"/></p:txEl>` : ''}</p:spTgt></p:tgtEl>`
  }
  const behaviours = (a: Anim, para: number | undefined): string => {
    const t = tgt(a, para)
    if (!t) return ''
    const dur = Math.max(1, Math.round(a.dur * 1000))
    const set = (v: 'visible' | 'hidden', delay: number, d = 1) => `<p:set><p:cBhvr><p:cTn id="${id++}" dur="${d}" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${t}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${v}"/></p:to></p:set>`
    const eff = (filter: string, tr: 'in' | 'out') => `<p:animEffect transition="${tr}" filter="${filter}"><p:cBhvr><p:cTn id="${id++}" dur="${dur}"/>${t}</p:cBhvr></p:animEffect>`
    const anim = (attr: string, from: string, to: string) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${id++}" dur="${dur}" fill="hold"/>${t}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`
    const inn = a.kind === 'in', out = a.kind === 'out'
    if (a.kind === 'emph') {
      switch (a.effect) {
        case 'spin': return `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${id++}" dur="${dur}" fill="hold"/>${t}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`
        case 'teeter': return `<p:animRot by="300000"><p:cBhvr><p:cTn id="${id++}" dur="${Math.round(dur / 2)}" autoRev="1" fill="hold"/>${t}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`
        case 'grow': return `<p:animScale><p:cBhvr><p:cTn id="${id++}" dur="${dur}" fill="hold"/>${t}</p:cBhvr><p:by x="140000" y="140000"/></p:animScale>`
        default: return `<p:animScale><p:cBhvr><p:cTn id="${id++}" dur="${Math.round(dur / 2)}" autoRev="1" fill="hold"/>${t}</p:cBhvr><p:by x="112000" y="112000"/></p:animScale>`
      }
    }
    const dir = a.dir ?? 'left'
    const tr = inn ? 'in' : 'out'
    const parts: string[] = []
    if (inn) parts.push(set('visible', 0))
    switch (a.effect) {
      case 'appear': break
      case 'fade': parts.push(eff('fade', tr)); break
      case 'wipe': parts.push(eff(`wipe(${dir})`, tr)); break
      case 'split': parts.push(eff('barn(inVertical)', tr)); break
      case 'blinds': parts.push(eff('blinds(horizontal)', tr)); break
      case 'zoom': parts.push(anim('ppt_w', inn ? '0' : '#ppt_w', inn ? '#ppt_w' : '0'), anim('ppt_h', inn ? '0' : '#ppt_h', inn ? '#ppt_h' : '0'), eff('fade', tr)); break
      case 'float': parts.push(anim('ppt_y', inn ? '#ppt_y+.1' : '#ppt_y', inn ? '#ppt_y' : '#ppt_y+.1'), eff('fade', tr)); break
      case 'fly': {
        const horiz = dir === 'left' || dir === 'right'
        const off = dir === 'left' ? '0-#ppt_w/2' : dir === 'right' ? '1+#ppt_w/2' : dir === 'up' ? '0-#ppt_h/2' : '1+#ppt_h/2'
        const home = horiz ? '#ppt_x' : '#ppt_y'
        parts.push(anim(horiz ? 'ppt_x' : 'ppt_y', inn ? off : home, inn ? home : off))
        break
      }
      default: parts.push(eff('fade', tr))
    }
    if (out) parts.push(set('hidden', Math.max(0, dur - 1)))
    return parts.join('')
  }
  const builds = new Map<number, boolean>()
  const clickPars = steps.map((step) => {
    const groups: { delay: number; effects: string[] }[] = []
    let prevEnd = 0
    step.forEach((tm, i) => {
      const a = tm.anim
      const preset = ANIM_PRESET[a.effect]
      const cls = a.kind === 'in' ? 'entr' : a.kind === 'out' ? 'exit' : 'emph'
      const nodeType = i === 0 && a.trigger === 'click' ? 'clickEffect' : a.trigger === 'with' ? 'withEffect' : a.trigger === 'after' ? 'afterEffect' : 'clickEffect'
      const body = behaviours(a, tm.para)
      if (!body) return
      const group = a.trigger === 'with' && groups.length ? groups[groups.length - 1] : (() => { const g = { delay: Math.round(prevEnd * 1000), effects: [] as string[] }; groups.push(g); return g })()
      const subtype = preset.id === 2 || preset.id === 22 ? SUB[a.dir ?? 'left'] : 0
      const isShape = findEl(slide.els, a.target)?.type === 'shape'
      if (isShape) builds.set(c.ids.get(a.target)!, tm.para !== undefined)
      group.effects.push(`<p:par><p:cTn id="${id++}" presetID="${preset.id}" presetClass="${cls}" presetSubtype="${subtype}"${isShape ? ' grpId="0"' : ''} fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${Math.round(a.delay * 1000)}"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`)
      prevEnd = tm.end
    })
    return `<p:par><p:cTn id="${id++}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${groups.map((g) => `<p:par><p:cTn id="${id++}" fill="hold"><p:stCondLst><p:cond delay="${g.delay}"/></p:stCondLst><p:childTnLst>${g.effects.join('')}</p:childTnLst></p:cTn></p:par>`).join('')}</p:childTnLst></p:cTn></p:par>`
  }).join('')
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clickPars}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${builds.size ? `<p:bldLst>${[...builds].map(([spid, para]) => `<p:bldP spid="${spid}" grpId="0"${para ? ' build="p"' : ' animBg="1"'}/>`).join('')}</p:bldLst>` : ''}</p:timing>`
}

function footerShapes(deck: Deck, index: number, c: Ctx): string {
  const th = c.th
  const box = (kind: 'ftr' | 'dt' | 'sldNum', x: number, w: number, a: 'l' | 'ctr' | 'r', body: string) => {
    const id = c.next++
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${kind}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${kind}" sz="quarter" idx="${kind === 'dt' ? 10 : kind === 'ftr' ? 11 : 12}"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(deck.h - 40)}"/><a:ext cx="${emu(w)}" cy="${emu(26)}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${a}"/>${body}</a:p></p:txBody></p:sp>`
  }
  const rp = `<a:rPr lang="en-US" sz="1200">${solid('@text2', th)}</a:rPr>`
  let out = ''
  if (deck.footer.date) out += box('dt', 48, 200, 'l', `<a:r>${rp}<a:t>${esc(new Date().toLocaleDateString())}</a:t></a:r>`)
  if (deck.footer.text) out += box('ftr', deck.w / 2 - 200, 400, 'ctr', `<a:r>${rp}<a:t>${esc(deck.footer.text)}</a:t></a:r>`)
  if (deck.footer.num) out += box('sldNum', deck.w - 148, 100, 'r', `<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum">${rp}<a:t>${index + 1}</a:t></a:fld>`)
  return out
}

function buildSlide(deck: Deck, slide: Slide, index: number, out: Out, layoutIdx: number, slideTargets: Map<string, string>): { xml: string; rels: Rel[]; notes: boolean } {
  const part = new Part()
  part.add(REL.layout, `../slideLayouts/slideLayout${layoutIdx + 1}.xml`)
  const c: Ctx = { deck, th: deck.theme, part, out, ids: new Map(), next: 2, slideRels: slideTargets }
  const shapes = slide.els.map((e) => elXml(e, c)).join('') + footerShapes(deck, index, c)
  const hasNotes = !!slide.notes.trim()
  if (hasNotes) part.add(REL.notesSlide, `../notesSlides/notesSlide${index + 1}.xml`)
  const xml = XML + `<p:sld ${NS}${slide.hidden ? ' show="0"' : ''}><p:cSld>${bgXml(slide.bg, c)}<p:spTree>${SPTREE_HEAD}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(slide.trans, slide.auto, deck.show.useTimings)}${timingXml(slide, c)}</p:sld>`
  return { xml, rels: part.rels, notes: hasNotes }
}

// ---------------------------------------------------------------- theme, master, layouts

function themeXml(deck: Deck, name: string): string {
  const th = deck.theme
  const c = th.colors
  const col = (v: string) => `<a:srgbClr val="${hex(v, th)}"/>`
  return XML + `<a:theme xmlns:a="${NS_A}" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(th.name)}"><a:dk1>${col(c.text)}</a:dk1><a:lt1>${col(c.bg)}</a:lt1><a:dk2>${col(c.text2)}</a:dk2><a:lt2>${col(c.bg2)}</a:lt2><a:accent1>${col(c.accent1)}</a:accent1><a:accent2>${col(c.accent2)}</a:accent2><a:accent3>${col(c.accent3)}</a:accent3><a:accent4>${col(c.accent4)}</a:accent4><a:accent5>${col(c.accent5)}</a:accent5><a:accent6>${col(c.accent6)}</a:accent6><a:hlink>${col(c.link)}</a:hlink><a:folHlink>${col(c.link)}</a:folHlink></a:clrScheme><a:fontScheme name="${esc(th.name)}"><a:majorFont><a:latin typeface="${esc(th.headFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(th.bodyFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Kwiiva"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
}

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'

function lstStyle(st: TextStyle | undefined, th: Theme): string {
  if (!st) return '<a:lstStyle/>'
  const bu = st.bullet && st.bullet !== 'none' ? (NUM_OUT[st.bullet] ? `<a:buAutoNum type="${NUM_OUT[st.bullet]}"/>` : `<a:buFont typeface="Arial"/><a:buChar char="${BULLET_CHAR[st.bullet] ?? '•'}"/>`) : '<a:buNone/>'
  const marL = st.bullet && st.bullet !== 'none' ? HANG : 0
  return `<a:lstStyle><a:lvl1pPr marL="${emu(marL)}" indent="${emu(-marL)}" algn="${{ left: 'l', center: 'ctr', right: 'r', justify: 'just' }[st.align ?? 'left']}">${st.before ? `<a:spcBef><a:spcPts val="${Math.round(st.before * 100)}"/></a:spcBef>` : ''}${bu}<a:defRPr sz="${Math.round((st.sz ?? 18) * 100)}"${st.b ? ' b="1"' : ''}${st.i ? ' i="1"' : ''}>${solid(st.c ?? '@text', th)}<a:latin typeface="${esc(fontRef(st.f))}"/></a:defRPr></a:lvl1pPr></a:lstStyle>`
}

function layoutShapes(els: El[], deck: Deck, part: Part, out: Out, start = 2): string {
  const c: Ctx = { deck, th: deck.theme, part, out, ids: new Map(), next: start }
  return els.map((e) => {
    if (e.type === 'shape' && e.ph) {
      const id = nid(c, e.id)
      const prompt = { title: 'Click to edit the title', subtitle: 'Click to edit the subtitle', body: 'Click to edit text', body2: 'Click to edit text', object: 'Click to edit text', picture: 'Picture', footer: '', date: '', num: '' }[e.ph.role] ?? ''
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(e.ph.role)} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${PH_OUT[e.ph.role] ?? 'body'}"${e.ph.idx ? ` idx="${e.ph.idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm(e)}${e.fill ? fillXml(e.fill, deck.theme, part, out, deck) : ''}</p:spPr><p:txBody><a:bodyPr anchor="${e.text?.v === 'middle' ? 'ctr' : e.text?.v === 'bottom' ? 'b' : 't'}"><a:normAutofit/></a:bodyPr>${lstStyle(e.st, deck.theme)}<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(prompt)}</a:t></a:r></a:p></p:txBody></p:sp>`
    }
    return elXml(e, c)
  }).join('')
}

function buildMaster(deck: Deck, out: Out): { xml: string; rels: Rel[] } {
  const part = new Part()
  deck.layouts.forEach((_, i) => part.add(REL.layout, `../slideLayouts/slideLayout${i + 1}.xml`))
  part.add(REL.theme, '../theme/theme1.xml')
  const shapes = layoutShapes(deck.master.els, deck, part, out)
  const bg = deck.master.bg ?? { t: 'solid' as const, c: '@bg' }
  const c: Ctx = { deck, th: deck.theme, part, out, ids: new Map(), next: 2 }
  const lvl = (sz: number, bold = false, head = false) => `<a:lvl1pPr algn="l"><a:defRPr sz="${sz * 100}"${bold ? ' b="1"' : ''}>${solid('@text', deck.theme)}<a:latin typeface="${head ? '+mj-lt' : '+mn-lt'}"/></a:defRPr></a:lvl1pPr>`
  const xml = XML + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr>${fillXml(bg, deck.theme, part, out, deck)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${SPTREE_HEAD}${shapes}</p:spTree></p:cSld>${CLR_MAP}<p:sldLayoutIdLst>${deck.layouts.map((_, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldLayoutIdLst><p:txStyles><p:titleStyle>${lvl(40, true, true)}</p:titleStyle><p:bodyStyle>${lvl(24)}</p:bodyStyle><p:otherStyle>${lvl(18)}</p:otherStyle></p:txStyles></p:sldMaster>`
  void c
  return { xml, rels: part.rels }
}

function buildLayout(deck: Deck, l: Layout, out: Out): { xml: string; rels: Rel[] } {
  const part = new Part()
  part.add(REL.master, '../slideMasters/slideMaster1.xml')
  const shapes = layoutShapes(l.els, deck, part, out)
  const type = { title: 'title', titleBody: 'obj', section: 'secHead', twoContent: 'twoObj', comparison: 'twoTxTwoObj', titleOnly: 'titleOnly', pictureCaption: 'picTx', blank: 'blank' }[l.id] ?? 'cust'
  const c: Ctx = { deck, th: deck.theme, part, out, ids: new Map(), next: 2 }
  const xml = XML + `<p:sldLayout ${NS} type="${type}" preserve="1"><p:cSld name="${esc(l.name)}">${l.bg ? bgXml(l.bg, c) : ''}<p:spTree>${SPTREE_HEAD}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  return { xml, rels: part.rels }
}

function notesXml(text: string): string {
  const paras = text.split('\n').map((l) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')
  return XML + `<p:notes ${NS}><p:cSld><p:spTree>${SPTREE_HEAD}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
}
function notesMasterXml(): string {
  return XML + `<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${SPTREE_HEAD}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit notes</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>${CLR_MAP}<p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`
}

/** A checksum of the standard parts, so a copy of the deck kept inside the file is trusted only if nothing else has edited the file since. */
export function fingerprint(files: Record<string, Uint8Array>): string {
  let h1 = 0x811c9dc5, h2 = 0
  for (const name of Object.keys(files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters|notesSlides|charts)\/[^/]+\.xml$|^ppt\/media\//.test(n)).sort()) {
    for (let i = 0; i < name.length; i++) { h1 ^= name.charCodeAt(i); h1 = Math.imul(h1, 16777619) }
    const b = files[name]
    for (let i = 0; i < b.length; i++) { h1 ^= b[i]; h1 = Math.imul(h1, 16777619); h2 = (h2 + b[i] * (i + 1)) >>> 0 }
  }
  return `${(h1 >>> 0).toString(16)}-${h2.toString(16)}`
}

/** `original` is the deck as the person made it, kept inside the file; `deck` may have had pictures converted for other programs. */
export function writePptx(deck: Deck, original: Deck = deck): Uint8Array {
  const out: Out = { files: {}, overrides: [], defaults: new Map([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']]), mediaFiles: new Map(), charts: 0 }
  const slideTargets = new Map(deck.slides.map((s, i) => [s.id, `slide${i + 1}.xml`]))
  const layoutIdx = (id: string) => Math.max(0, deck.layouts.findIndex((l) => l.id === id))

  const pres = new Part()
  const masterRid = pres.add(REL.master, 'slideMasters/slideMaster1.xml')
  const slideRids = deck.slides.map((_, i) => pres.add(REL.slide, `slides/slide${i + 1}.xml`))
  const hasNotes = deck.slides.some((s) => s.notes.trim())
  const nmRid = hasNotes ? pres.add(REL.notesMaster, 'notesMasters/notesMaster1.xml') : ''
  pres.add(REL.theme, 'theme/theme1.xml')
  pres.add(REL.presProps, 'presProps.xml'); pres.add(REL.viewProps, 'viewProps.xml'); pres.add(REL.tableStyles, 'tableStyles.xml')

  const master = buildMaster(deck, out)
  out.files['ppt/slideMasters/slideMaster1.xml'] = strToU8(master.xml)
  out.files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(relsXml(master.rels))
  out.overrides.push(['/ppt/slideMasters/slideMaster1.xml', CT.master])
  deck.layouts.forEach((l, i) => {
    const r = buildLayout(deck, l, out)
    out.files[`ppt/slideLayouts/slideLayout${i + 1}.xml`] = strToU8(r.xml)
    out.files[`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`] = strToU8(relsXml(r.rels))
    out.overrides.push([`/ppt/slideLayouts/slideLayout${i + 1}.xml`, CT.layout])
  })
  out.files['ppt/theme/theme1.xml'] = strToU8(themeXml(deck, 'Kwiiva'))
  out.overrides.push(['/ppt/theme/theme1.xml', CT.theme])

  deck.slides.forEach((s, i) => {
    const r = buildSlide(deck, s, i, out, layoutIdx(s.layout), slideTargets)
    out.files[`ppt/slides/slide${i + 1}.xml`] = strToU8(r.xml)
    out.files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(relsXml(r.rels))
    out.overrides.push([`/ppt/slides/slide${i + 1}.xml`, CT.slide])
    if (r.notes) {
      out.files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = strToU8(notesXml(s.notes))
      const nr = new Part()
      nr.add(REL.notesMaster, '../notesMasters/notesMaster1.xml'); nr.add(REL.slide, `../slides/slide${i + 1}.xml`)
      out.files[`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`] = strToU8(relsXml(nr.rels))
      out.overrides.push([`/ppt/notesSlides/notesSlide${i + 1}.xml`, CT.notesSlide])
    }
  })
  if (hasNotes) {
    out.files['ppt/notesMasters/notesMaster1.xml'] = strToU8(notesMasterXml())
    const nm = new Part(); nm.add(REL.theme, '../theme/theme2.xml')
    out.files['ppt/notesMasters/_rels/notesMaster1.xml.rels'] = strToU8(relsXml(nm.rels))
    out.files['ppt/theme/theme2.xml'] = strToU8(themeXml(deck, 'Kwiiva notes'))
    out.overrides.push(['/ppt/notesMasters/notesMaster1.xml', CT.notesMaster], ['/ppt/theme/theme2.xml', CT.theme])
  }

  out.files['ppt/presProps.xml'] = strToU8(XML + `<p:presentationPr ${NS}/>`)
  out.files['ppt/viewProps.xml'] = strToU8(XML + `<p:viewPr ${NS}/>`)
  out.files['ppt/tableStyles.xml'] = strToU8(XML + `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  out.overrides.push(['/ppt/presProps.xml', CT.presProps], ['/ppt/viewProps.xml', CT.viewProps], ['/ppt/tableStyles.xml', CT.tableStyles])

  out.files['ppt/presentation.xml'] = strToU8(XML + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="${masterRid}"/></p:sldMasterIdLst>${hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${nmRid}"/></p:notesMasterIdLst>` : ''}<p:sldIdLst>${slideRids.map((r, i) => `<p:sldId id="${256 + i}" r:id="${r}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${emu(deck.w)}" cy="${emu(deck.h)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>`)
  out.files['ppt/_rels/presentation.xml.rels'] = strToU8(relsXml(pres.rels))
  out.overrides.push(['/ppt/presentation.xml', CT.presentation])

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  out.files['docProps/core.xml'] = strToU8(XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title)}</dc:title><dc:creator>Kwiiva Present</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  out.files['docProps/app.xml'] = strToU8(XML + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kwiiva Present</Application><AppVersion>0.1</AppVersion><Slides>${deck.slides.length}</Slides></Properties>`)
  out.overrides.push(['/docProps/core.xml', CT.core], ['/docProps/app.xml', CT.app])

  // A copy of the whole deck, for a lossless reopen in Kwiiva Present. Other programs ignore it.
  const root = new Part()
  root.add(REL.doc, 'ppt/presentation.xml'); root.add(REL.core, 'docProps/core.xml'); root.add(REL.app, 'docProps/app.xml')
  const fp = fingerprint(out.files)
  out.files['kwiiva/deck.json'] = strToU8(JSON.stringify({ app: 'kwiiva-present', version: 1, fingerprint: fp, deck: original }))
  root.add(REL.kwiiva, 'kwiiva/deck.json')
  out.defaults.set('json', 'application/json')
  out.files['_rels/.rels'] = strToU8(relsXml(root.rels))

  out.files['[Content_Types].xml'] = strToU8(XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[...out.defaults].map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('')}${out.overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`)
  return zipSync(out.files, { level: 6 })
}
void hexToRgb
