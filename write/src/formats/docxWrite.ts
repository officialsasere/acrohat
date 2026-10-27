import { zipSync, strToU8 } from 'fflate'
import { fontNameOf } from '../editor/fonts'
import { DEFAULT_LINE_HEIGHT, DEFAULT_SPACE_AFTER, HEADING_SIZE, SUBTITLE_SIZE, TITLE_SIZE } from '../editor/defaults'
import { escapeXml as esc } from './xml'
import { pagePx, type HeaderFooter, type PMNode, type WriteDocument } from './types'

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

const TWIP_PER_PT = 20
const PX_TO_EMU = 9525

type Mark = NonNullable<PMNode['marks']>[number]

/** Image width and height in pixels, read from the file header (PNG, JPEG, GIF). */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], h: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] }
  if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
  }
  return null
}

function dataUrl(src: string): { bytes: Uint8Array; ext: 'png' | 'jpeg' | 'gif' } | null {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/s.exec(src)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext: m[1] === 'png' ? 'png' : m[1] === 'gif' ? 'gif' : 'jpeg' }
}

const hex6 = (c: string | undefined | null) => {
  if (!c) return null
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  if (m) return m[1].toUpperCase()
  const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c.trim())
  if (s) return (s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toUpperCase()
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c.trim())
  if (r) return [r[1], r[2], r[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}
const halfPoints = (size: string | undefined) => {
  if (!size) return null
  const m = /^([\d.]+)\s*(pt|px)?$/.exec(size.trim())
  if (!m) return null
  const pt = m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])
  return Math.round(pt * 2)
}

export function writeDocx(wd: WriteDocument): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const rels: { id: string; type: string; target: string; external?: boolean }[] = []
  const nums: { abstract: number; start: number }[] = []
  let relN = 10
  let drawN = 1
  const rel = (type: string, target: string, external = false) => {
    const id = `rId${relN++}`
    rels.push({ id, type, target, external })
    return id
  }
  const media = new Map<string, string>()

  const page = pagePx(wd.settings)
  const m = wd.settings.margins
  const contentTwips = Math.round((page.w / 96 - m.left - m.right) * 1440)

  // ---- runs ----
  function runProps(marks: Mark[] | undefined, extra = ''): string {
    let p = ''
    let font: string | null = null, color: string | null = null, size: string | null = null, shade: string | null = null
    const has = (t: string) => marks?.find((x) => x.type === t)
    for (const mk of marks ?? []) {
      if (mk.type === 'textStyle') {
        font = fontNameOf(mk.attrs?.fontFamily as string) ?? font
        color = hex6(mk.attrs?.color as string) ?? color
        const hp = halfPoints(mk.attrs?.fontSize as string)
        if (hp) size = String(hp)
        shade = hex6(mk.attrs?.backgroundColor as string) ?? shade
      } else if (mk.type === 'highlight') shade = hex6(mk.attrs?.color as string) ?? 'FFFF00'
    }
    if (has('code') && !font) font = 'Courier New'
    if (font) p += `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}" w:eastAsia="${esc(font)}"/>`
    if (has('bold')) p += '<w:b/><w:bCs/>'
    if (has('italic')) p += '<w:i/><w:iCs/>'
    if (has('strike')) p += '<w:strike/>'
    if (color) p += `<w:color w:val="${color}"/>`
    if (size) p += `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`
    if (shade) p += `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`
    if (has('underline')) p += '<w:u w:val="single"/>'
    if (has('superscript')) p += '<w:vertAlign w:val="superscript"/>'
    if (has('subscript')) p += '<w:vertAlign w:val="subscript"/>'
    const body = extra + p
    return body ? `<w:rPr>${body}</w:rPr>` : ''
  }

  const textRun = (text: string, marks: Mark[] | undefined, extra = '') => {
    // Tabs and line breaks inside text become real tab/break elements.
    const parts = text.split(/(\t|\n)/)
    const inner = parts.map((s) => (s === '\t' ? '<w:tab/>' : s === '\n' ? '<w:br/>' : s ? `<w:t xml:space="preserve">${esc(s)}</w:t>` : '')).join('')
    return `<w:r>${runProps(marks, extra)}${inner}</w:r>`
  }

  function imageRun(n: PMNode): string {
    const d = dataUrl(String(n.attrs?.src ?? ''))
    if (!d) return textRun(`[image: ${String(n.attrs?.alt || 'not embedded')}]`, undefined)
    let name = media.get(String(n.attrs!.src))
    if (!name) {
      name = `image${media.size + 1}.${d.ext === 'jpeg' ? 'jpg' : d.ext}`
      media.set(String(n.attrs!.src), name)
      files[`word/media/${name}`] = d.bytes
    }
    const rid = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${name}`)
    const natural = imageSize(d.bytes) ?? { w: 400, h: 300 }
    let w = Number(n.attrs?.width) || natural.w
    let h = Number(n.attrs?.height) || Math.round((w * natural.h) / natural.w)
    const maxW = contentTwips / 15
    if (w > maxW) { h = Math.round((h * maxW) / w); w = Math.round(maxW) }
    const id = drawN++
    const cx = w * PX_TO_EMU, cy = h * PX_TO_EMU
    return (
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${esc(String(n.attrs?.alt ?? ''))}"/>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    )
  }

  function inline(nodes: PMNode[] | undefined, baseMarks: Mark[] = [], extraRun = ''): string {
    let out = ''
    for (const n of nodes ?? []) {
      const marks = [...baseMarks, ...(n.marks ?? [])]
      if (n.type === 'text') {
        const link = marks.find((x) => x.type === 'link')
        const run = textRun(n.text ?? '', marks.filter((x) => x.type !== 'link'), extraRun + (link ? '<w:color w:val="0563C1"/><w:u w:val="single"/>' : ''))
        if (link && /^[a-z][a-z0-9+.-]*:/i.test(String(link.attrs?.href ?? ''))) {
          const rid = rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', String(link.attrs!.href), true)
          out += `<w:hyperlink r:id="${rid}" w:history="1">${run}</w:hyperlink>`
        } else out += run
      } else if (n.type === 'hardBreak') out += '<w:r><w:br/></w:r>'
      else if (n.type === 'image') out += imageRun(n)
    }
    return out
  }

  // ---- paragraphs ----
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  function paraProps(n: PMNode, o: { style?: string; list?: { numId: number; level: number }; indentLeft?: number; keepNext?: boolean; extra?: string } = {}): string {
    const a = n.attrs ?? {}
    let p = ''
    const style = o.style ?? (a.pStyle === 'title' ? 'Title' : a.pStyle === 'subtitle' ? 'Subtitle' : n.type === 'heading' ? `Heading${Math.min(6, Number(a.level) || 1)}` : undefined)
    if (style) p += `<w:pStyle w:val="${style}"/>`
    if (o.keepNext) p += '<w:keepNext/>'
    if (o.list) p += `<w:numPr><w:ilvl w:val="${o.list.level}"/><w:numId w:val="${o.list.numId}"/></w:numPr>`
    if (o.extra) p += o.extra
    const before = num(a.spaceBefore), after = num(a.spaceAfter), line = num(a.lineHeight)
    if (before !== null || after !== null || line !== null)
      p += `<w:spacing${before !== null ? ` w:before="${Math.round(before * TWIP_PER_PT)}"` : ''}${after !== null ? ` w:after="${Math.round(after * TWIP_PER_PT)}"` : ''}${line !== null ? ` w:line="${Math.round(line * 240)}" w:lineRule="auto"` : ''}/>`
    const indent = (num(a.indent) ?? 0) + (o.indentLeft ?? 0)
    const first = num(a.firstLine)
    if (indent || first) p += `<w:ind w:left="${Math.round(indent * TWIP_PER_PT)}"${first ? (first < 0 ? ` w:hanging="${Math.round(-first * TWIP_PER_PT)}"` : ` w:firstLine="${Math.round(first * TWIP_PER_PT)}"`) : ''}/>`
    const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[String(a.textAlign)]
    if (jc && jc !== 'left') p += `<w:jc w:val="${jc}"/>`
    return p ? `<w:pPr>${p}</w:pPr>` : ''
  }

  function paragraph(n: PMNode, o: Parameters<typeof paraProps>[1] = {}, prefix = ''): string {
    // A page break inside the content ends the paragraph; handled as its own node, so nothing to do here.
    return `<w:p>${paraProps(n, o)}${prefix}${inline(n.content)}</w:p>`
  }

  // ---- lists ----
  function numFor(abstract: number, start = 1) {
    nums.push({ abstract, start })
    return nums.length // numId (1-based)
  }
  function list(n: PMNode, level: number): string {
    const kind: 'bullet' | 'ordered' | 'task' = n.type === 'orderedList' ? 'ordered' : n.type === 'taskList' ? 'task' : 'bullet'
    let out = ''
    const start = kind === 'ordered' ? Number(n.attrs?.start) || 1 : 1
    const baseNum = kind === 'task' ? 0 : numFor(kind === 'ordered' ? 1 : 0, start)
    for (const item of n.content ?? []) {
      const numId = kind === 'task' ? numFor(item.attrs?.checked ? 3 : 2) : baseNum
      let first = true
      for (const c of item.content ?? []) {
        if (c.type === 'paragraph' || c.type === 'heading') {
          out += first
            ? paragraph(c, { style: 'ListParagraph', list: { numId, level } })
            : paragraph(c, { style: 'ListParagraph', indentLeft: (level + 1) * 36 })
          first = false
        } else if (c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList') out += list(c, Math.min(level + 1, 8))
        else out += block(c)
      }
      if (first) out += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr></w:p>`
    }
    return out
  }

  // ---- tables ----
  function table(n: PMNode): string {
    const rows = n.content ?? []
    // Work out the grid: how many columns, and which cells are covered by a cell above that spans down.
    const covered: number[][] = []
    let cols = 0
    const placed = rows.map((r, ri) => {
      let c = 0
      const cells: { node: PMNode; col: number; span: number; rowspan: number }[] = []
      for (const cell of r.content ?? []) {
        while ((covered[ri] ?? [])[c]) c++
        const span = Number(cell.attrs?.colspan) || 1, rowspan = Number(cell.attrs?.rowspan) || 1
        cells.push({ node: cell, col: c, span, rowspan })
        for (let dr = 1; dr < rowspan; dr++) for (let dc = 0; dc < span; dc++) ((covered[ri + dr] ??= [])[c + dc] = 1)
        c += span
      }
      cols = Math.max(cols, c, (covered[ri] ?? []).length)
      return cells
    })
    const widths: number[] = Array(cols).fill(0)
    for (const r of placed) for (const c of r) {
      const cw = c.node.attrs?.colwidth as number[] | null | undefined
      if (cw) for (let i = 0; i < c.span; i++) if (cw[i]) widths[c.col + i] = Math.round(cw[i] * 15)
    }
    const known = widths.reduce((s, w) => s + w, 0), unknown = widths.filter((w) => !w).length
    const fill = unknown ? Math.max(720, Math.round((contentTwips - known) / unknown)) : 0
    for (let i = 0; i < cols; i++) if (!widths[i]) widths[i] = fill
    const border = (k: string) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`
    let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((s, w) => s + w, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr>`
    x += `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    rows.forEach((r, ri) => {
      const cells = placed[ri]
      const header = (r.content ?? []).length > 0 && (r.content ?? []).every((c) => c.type === 'tableHeader')
      x += header ? '<w:tr><w:trPr><w:tblHeader/></w:trPr>' : '<w:tr>'
      let col = 0
      const emit = (cell: (typeof cells)[number] | null, cc: number, continuation = false) => {
        const span = cell?.span ?? 1
        const w = widths.slice(cc, cc + span).reduce((s, v) => s + v, 0)
        let tcPr = `<w:tcW w:w="${w}" w:type="dxa"/>`
        if (span > 1) tcPr += `<w:gridSpan w:val="${span}"/>`
        if (cell && cell.rowspan > 1) tcPr += '<w:vMerge w:val="restart"/>'
        if (continuation) tcPr += '<w:vMerge/>'
        const bg = hex6(cell?.node.attrs?.backgroundColor as string)
        if (bg) tcPr += `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>`
        const body = cell ? (cell.node.content ?? []).map(block).join('') : ''
        // A cell must end with a paragraph (a nested table is followed by one already, but be safe).
        x += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${body && body.endsWith('</w:p>') ? body : body + '<w:p/>'}</w:tc>`
      }
      while (col < cols) {
        const here = cells.find((c) => c.col === col)
        if (here) { emit(here, col); col += here.span }
        else {
          // Covered by a cell above: write the "continue" cell the format expects.
          let span = 1
          while (col + span < cols && !cells.find((c) => c.col === col + span)) span++
          x += `<w:tc><w:tcPr><w:tcW w:w="${widths.slice(col, col + span).reduce((s, v) => s + v, 0)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`
          col += span
        }
      }
      x += '</w:tr>'
    })
    return x + '</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'
  }

  // ---- blocks ----
  function headings(n: PMNode, out: { level: number; text: string }[]) {
    if (n.type === 'heading') out.push({ level: Number(n.attrs?.level) || 1, text: textOf(n) })
    for (const c of n.content ?? []) headings(c, out)
    return out
  }
  const textOf = (n: PMNode): string => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? ' ' : (n.content ?? []).map(textOf).join(''))

  function block(n: PMNode): string {
    switch (n.type) {
      case 'paragraph':
        return paragraph(n)
      case 'heading':
        return paragraph(n, { keepNext: true })
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return list(n, 0)
      case 'blockquote':
        return (n.content ?? []).map((c) => (c.type === 'paragraph' ? paragraph(c, { style: 'Quote' }) : block(c))).join('')
      case 'codeBlock': {
        const code = (n.content ?? []).map((c) => c.text ?? '').join('')
        return code.split('\n').map((line) => `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${textRun(line, [{ type: 'code' }])}</w:p>`).join('')
      }
      case 'horizontalRule':
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr><w:spacing w:after="120"/></w:pPr></w:p>'
      case 'pageBreak':
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
      case 'table':
        return table(n)
      case 'image': {
        const jc = { center: 'center', right: 'right' }[String(n.attrs?.align)]
        return `<w:p>${jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : ''}${imageRun(n)}</w:p>`
      }
      case 'tableOfContents': {
        const hs = headings(wd.doc, [])
        const title = '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>'
        return title + hs.map((h) => `<w:p><w:pPr><w:ind w:left="${(Math.min(h.level, 6) - 1) * 360}"/><w:spacing w:after="60"/></w:pPr><w:r><w:t xml:space="preserve">${esc(h.text)}</w:t></w:r></w:p>`).join('')
      }
      default:
        return (n.content ?? []).map(block).join('')
    }
  }

  const body = wd.doc.content.map(block).join('')

  // ---- header and footer ----
  const hasHF = (h: HeaderFooter) => !!(h.left || h.center || h.right)
  function hfXml(tag: 'hdr' | 'ftr', h: HeaderFooter): string {
    const piece = (s: string) =>
      s
        .split(/(\{pages?\})/)
        .filter(Boolean)
        .map((t) =>
          t === '{page}' ? '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
          : t === '{pages}' ? '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
          : `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`)
        .join('')
    const style = tag === 'hdr' ? 'Header' : 'Footer'
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}><w:p><w:pPr><w:pStyle w:val="${style}"/><w:tabs><w:tab w:val="clear" w:pos="4680"/><w:tab w:val="clear" w:pos="9360"/><w:tab w:val="center" w:pos="${Math.round(contentTwips / 2)}"/><w:tab w:val="right" w:pos="${contentTwips}"/></w:tabs></w:pPr>` +
      `${piece(h.left)}<w:r><w:tab/></w:r>${piece(h.center)}<w:r><w:tab/></w:r>${piece(h.right)}</w:p></w:${tag}>`
    )
  }
  let hfRefs = ''
  if (hasHF(wd.settings.header)) {
    files['word/header1.xml'] = strToU8(hfXml('hdr', wd.settings.header))
    hfRefs += `<w:headerReference w:type="default" r:id="${rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', 'header1.xml')}"/>`
  }
  if (hasHF(wd.settings.footer)) {
    files['word/footer1.xml'] = strToU8(hfXml('ftr', wd.settings.footer))
    hfRefs += `<w:footerReference w:type="default" r:id="${rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer', 'footer1.xml')}"/>`
  }

  const tw = (inch: number) => Math.round(inch * 1440)
  const landscape = wd.settings.orientation === 'landscape'
  const sect =
    `<w:sectPr>${hfRefs}<w:pgSz w:w="${Math.round(page.w * 15)}" w:h="${Math.round(page.h * 15)}"${landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`

  files['word/document.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`)
  files['word/styles.xml'] = strToU8(stylesXml(wd))
  files['word/numbering.xml'] = strToU8(numberingXml(nums))
  files['word/settings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`)
  const baseRels = [
    ['rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', 'styles.xml'],
    ['rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', 'numbering.xml'],
    ['rId3', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', 'settings.xml'],
  ]
  files['word/_rels/document.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      baseRels.map(([id, t, tg]) => `<Relationship Id="${id}" Type="${t}" Target="${tg}"/>`).join('') +
      rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') +
      '</Relationships>',
  )
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
  )
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(wd.title)}</dc:title><dc:creator>Kwiiva Write</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  )
  files['docProps/app.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kwiiva Write</Application></Properties>')
  const ctExt = [...new Set([...media.values()].map((n) => n.split('.').pop()!))]
  const ctType = (e: string) => (e === 'jpg' ? 'image/jpeg' : `image/${e}`)
  files['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      ctExt.map((e) => `<Default Extension="${e}" ContentType="${ctType(e)}"/>`).join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      (files['word/header1.xml'] ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') +
      (files['word/footer1.xml'] ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
  )
  // [Content_Types].xml must come first in the archive.
  const ordered: Record<string, Uint8Array> = { '[Content_Types].xml': files['[Content_Types].xml'] }
  for (const k of Object.keys(files)) if (k !== '[Content_Types].xml') ordered[k] = files[k]
  return zipSync(ordered, { level: 6 })
}

function stylesXml(wd: WriteDocument): string {
  const font = esc(wd.settings.bodyFont), size = Math.round(wd.settings.bodySize * 2)
  const para = (id: string, name: string, extra: { basedOn?: string; next?: string; ppr?: string; rpr?: string; q?: boolean } = {}) =>
    `<w:style w:type="paragraph" w:styleId="${id}"${id === 'Normal' ? ' w:default="1"' : ''}><w:name w:val="${name}"/>${extra.basedOn ? `<w:basedOn w:val="${extra.basedOn}"/>` : ''}${extra.next ? `<w:next w:val="${extra.next}"/>` : ''}${extra.q ? '<w:qFormat/>' : ''}${extra.ppr ? `<w:pPr>${extra.ppr}</w:pPr>` : ''}${extra.rpr ? `<w:rPr>${extra.rpr}</w:rPr>` : ''}</w:style>`
  const head = (n: number) =>
    para(`Heading${n}`, `heading ${n}`, { basedOn: 'Normal', next: 'Normal', q: true, ppr: `<w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/>`, rpr: `<w:b/><w:bCs/><w:sz w:val="${HEADING_SIZE[n] * 2}"/><w:szCs w:val="${HEADING_SIZE[n] * 2}"/>` })
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="${DEFAULT_SPACE_AFTER * TWIP_PER_PT}" w:line="${Math.round(DEFAULT_LINE_HEIGHT * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    para('Normal', 'Normal', { q: true }) +
    [1, 2, 3, 4, 5, 6].map(head).join('') +
    para('Title', 'Title', { basedOn: 'Normal', next: 'Normal', q: true, ppr: '<w:spacing w:after="80" w:line="240" w:lineRule="auto"/>', rpr: `<w:sz w:val="${TITLE_SIZE * 2}"/><w:szCs w:val="${TITLE_SIZE * 2}"/>` }) +
    para('Subtitle', 'Subtitle', { basedOn: 'Normal', next: 'Normal', q: true, rpr: `<w:color w:val="595959"/><w:sz w:val="${SUBTITLE_SIZE * 2}"/><w:szCs w:val="${SUBTITLE_SIZE * 2}"/>` }) +
    para('Quote', 'Quote', { basedOn: 'Normal', next: 'Normal', q: true, ppr: '<w:ind w:left="720" w:right="720"/>', rpr: '<w:i/><w:iCs/><w:color w:val="404040"/>' }) +
    para('ListParagraph', 'List Paragraph', { basedOn: 'Normal', q: true, ppr: '<w:spacing w:after="0"/><w:contextualSpacing/>' }) +
    para('CodeBlock', 'Code Block', { basedOn: 'Normal', ppr: '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', rpr: '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/>' }) +
    para('TOCHeading', 'TOC Heading', { basedOn: 'Normal', next: 'Normal', ppr: '<w:spacing w:before="240" w:after="120"/>', rpr: '<w:b/><w:sz w:val="28"/>' }) +
    para('Header', 'header', { basedOn: 'Normal', ppr: '<w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>' }) +
    para('Footer', 'footer', { basedOn: 'Normal', ppr: '<w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>' }) +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' +
    '</w:styles>'
  )
}

/** Abstract numbering definitions: 0 bullets, 1 numbers, 2 empty check box, 3 ticked check box. */
function numberingXml(nums: { abstract: number; start: number }[]): string {
  const lvls = (kind: number) =>
    Array.from({ length: 9 }, (_, i) => {
      const left = 720 * (i + 1)
      const fmt = kind === 1 ? ['decimal', 'lowerLetter', 'lowerRoman'][i % 3] : 'bullet'
      const text = kind === 1 ? `%${i + 1}.` : kind === 2 ? '☐' : kind === 3 ? '☑' : ['•', '◦', '▪'][i % 3]
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr>' : ''}</w:lvl>`
    }).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
    [0, 1, 2, 3].map((k) => `<w:abstractNum w:abstractNumId="${k}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(k)}</w:abstractNum>`).join('') +
    nums.map((n, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${n.abstract}"/>${n.start !== 1 ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${n.start}"/></w:lvlOverride>` : ''}</w:num>`).join('') +
    '</w:numbering>'
  )
}
