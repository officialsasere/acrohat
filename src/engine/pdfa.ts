import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from 'pdf-lib'
import { alloc, free, heap, heapF32, withBuf, writeUtf16 } from './core'
import type { PdfDocument } from './document'
import { chooseFont } from './fonts'
import { srgbIccProfile } from './icc'
import { flattenPage } from './extras'
import { readRuns, OBJ_TEXT } from './text'

/** PDF/A-2b conversion and a checker for the common ways files fail it. */

export interface Issue {
  severity: 'error' | 'warning'
  message: string
}

export interface PdfAReport {
  /** True when none of Kwiiva Paper's checks found an error. This is not an official certification. */
  passesChecks: boolean
  issues: Issue[]
}

/* -------------------------------------------------------------------------------------------- */
/* Step 1 (PDFium): make every font embedded.                                                  */
/* -------------------------------------------------------------------------------------------- */

export interface FontStepResult {
  replacedObjects: number
  rasterizedRuns: number
  flattenedPages: number
  warnings: string[]
}

/** Replaces a text object with a picture of it, in the same place. Used for glyphs that have no text equivalent. */
function rasterizeRun(doc: PdfDocument, pageIndex: number, objIndex: number) {
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const old = m.FPDFPage_GetObject(page, objIndex)
    const [l, b, r, t] = withBuf(m, 16, (p) => {
      m.FPDFPageObj_GetBounds(old, p, p + 4, p + 8, p + 12)
      return Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
    })
    const bmp = m.FPDFTextObj_GetRenderedBitmap(doc.raw, page, old, 4)
    if (!bmp) throw new Error('Could not render a glyph to an image')
    try {
      const img = m.FPDFPageObj_NewImageObj(doc.raw)
      m.FPDFImageObj_SetBitmap(0, 0, img, bmp)
      withBuf(m, 24, (p) => {
        heapF32(m).set([r - l, 0, 0, t - b, l, b], p >> 2)
        m.FPDFPageObj_SetMatrix(img, p)
      })
      m.FPDFPage_InsertObjectAtIndex(page, img, objIndex)
      m.FPDFPage_RemoveObject(page, old)
      m.FPDFPageObj_Destroy(old)
      m.FPDFPage_GenerateContent(page)
    } finally {
      m.FPDFBitmap_Destroy(bmp)
    }
  })
}

/**
 * Re-draws text set in non-embedded fonts (Helvetica, Times, Courier, Arial…) with the metric-compatible
 * Liberation fonts, which are embedded. Layout is preserved because the metrics match.
 */
export async function embedFonts(doc: PdfDocument, load: (file: string) => Promise<Uint8Array>, opts: { flatten: boolean }): Promise<FontStepResult> {
  const m = doc.m
  const res: FontStepResult = { replacedObjects: 0, rasterizedRuns: 0, flattenedPages: 0, warnings: [] }
  const cache = new Map<string, number>()
  const fontFor = async (file: string): Promise<number> => {
    const hit = cache.get(file)
    if (hit) return hit
    const data = await load(file)
    const p = alloc(m, data.length)
    heap(m).set(data, p)
    const f = m.FPDFText_LoadFont(doc.raw, p, data.length, 2, true)
    free(m, p)
    cache.set(file, f)
    return f
  }

  for (let i = 0; i < doc.pageCount; i++) {
    if (opts.flatten && flattenPage(doc, i)) res.flattenedPages++
    const runs = doc.withPage(i, (page) => readRuns(m, page))
    const todo = runs.filter((r) => !r.embedded).sort((a, b) => b.objIndex - a.objIndex)
    for (const run of todo) {
      const spec = { family: (run.mono ? 'Mono' : run.serif ? 'Serif' : 'Sans') as 'Mono' | 'Serif' | 'Sans', bold: run.bold, italic: run.italic }
      // Typesetters encode line-end hyphens as U+0002/U+00AD; draw them as a plain hyphen.
      let text = run.text.replace(/[\u0002\u00ad]/g, '-').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      let choice = await chooseFont(spec, text, load)
      if (!choice.font && choice.missing.length) {
        // Draw what we can rather than leaving a non-embedded font behind.
        const bad = new Set(choice.missing)
        text = [...text].filter((c) => !bad.has(c)).join('')
        const names = [...bad].map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ')
        if (!text.trim()) {
          // Nothing drawable is left (e.g. pieces of a large brace built from a symbol font): keep how it looks as a picture.
          rasterizeRun(doc, i, run.objIndex)
          res.rasterizedRuns++
          res.warnings.push(`Page ${i + 1}: glyphs ${names} can't be expressed as text, so they were kept as a small image`)
          continue
        }
        res.warnings.push(`Page ${i + 1}: dropped characters with no glyph in the replacement fonts: ${names}`)
        choice = await chooseFont(spec, text, load)
      }
      if (!choice.font) {
        res.warnings.push(`Page ${i + 1}: could not embed a font for "${text.slice(0, 20)}"`)
        continue
      }
      const font = await fontFor(choice.font.file)
      doc.withPage(i, (page) => {
        const old = m.FPDFPage_GetObject(page, run.objIndex)
        const obj = m.FPDFPageObj_CreateTextObj(doc.raw, font, run.fontSize)
        const u = writeUtf16(m, text)
        m.FPDFText_SetText(obj, u)
        free(m, u)
        withBuf(m, 24, (p) => {
          heapF32(m).set(run.matrix, p >> 2)
          m.FPDFPageObj_SetMatrix(obj, p)
        })
        m.FPDFPageObj_SetFillColor(obj, run.color[0], run.color[1], run.color[2], run.color[3])
        const mode = m.FPDFTextObj_GetTextRenderMode(old)
        if (mode > 0) m.FPDFTextObj_SetTextRenderMode(obj, mode)
        m.FPDFPage_InsertObjectAtIndex(page, obj, run.objIndex)
        m.FPDFPage_RemoveObject(page, old)
        m.FPDFPageObj_Destroy(old)
        m.FPDFPage_GenerateContent(page)
      })
      res.replacedObjects++
    }
  }
  return res
}

/* -------------------------------------------------------------------------------------------- */
/* Step 2 (pdf-lib): metadata, output intent, remove forbidden features.                        */
/* -------------------------------------------------------------------------------------------- */

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildXmp(o: { title: string; author: string; keywords: string; created: Date; modified: Date; part: 1 | 2 | 3; conformance: 'A' | 'B' | 'U' }): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z')
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>${o.part}</pdfaid:part>
   <pdfaid:conformance>${o.conformance}</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(o.title)}</rdf:li></rdf:Alt></dc:title>${o.author ? `\n   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(o.author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>Kwiiva Paper</xmp:CreatorTool>
   <xmp:CreateDate>${iso(o.created)}</xmp:CreateDate>
   <xmp:ModifyDate>${iso(o.modified)}</xmp:ModifyDate>
   <xmp:MetadataDate>${iso(o.modified)}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>Kwiiva Paper</pdf:Producer>${o.keywords ? `\n   <pdf:Keywords>${xmlEsc(o.keywords)}</pdf:Keywords>` : ''}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** Text of a page's content streams (decoded), for finding which resources it actually uses. */
function pageContent(page: ReturnType<PDFDocument['getPages']>[number]): string {
  const contents = page.node.Contents()
  const parts: (PDFObject | undefined)[] = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i)) : contents ? [contents] : []
  return parts.map((p) => (p instanceof PDFRawStream ? safeDecode(p) : p instanceof PDFStream ? new TextDecoder('latin1').decode(p.getContents()) : '')).join('\n')
}

function safeDecode(s: PDFRawStream): string {
  try {
    return new TextDecoder('latin1').decode(decodePDFRawStream(s).decode())
  } catch {
    return ''
  }
}

/** Removes entries from each page's /Font resources that the page's own content never selects with Tf. */
function pruneUnusedFonts(doc: PDFDocument): number {
  let removed = 0
  for (const page of doc.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (!fonts) continue
    const content = pageContent(page)
    // A page whose content paints a form XObject may rely on inherited resources; leave those pages alone.
    if (/\/[^\s/]+\s+Do\b/.test(content)) continue
    const used = new Set([...content.matchAll(/\/([^\s/[\]<>()%]+)\s+-?[\d.]+\s+Tf/g)].map((m) => m[1]))
    for (const key of fonts.keys()) {
      if (!used.has(key.decodeText())) {
        fonts.delete(key)
        removed++
      }
    }
  }
  return removed
}

/** Every indirect object reachable from the document's roots. */
function reachable(doc: PDFDocument): Set<string> {
  const seen = new Set<string>()
  const ctx = doc.context
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean) as PDFObject[]
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue
      seen.add(o.tag)
      const target = ctx.lookup(o)
      if (target) stack.push(target)
    } else if (o instanceof PDFDict) for (const v of o.values()) stack.push(v)
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) stack.push(o.get(i))
    else if (o instanceof PDFStream || o instanceof PDFRawStream) for (const v of o.dict.values()) stack.push(v)
  }
  return seen
}

/** Deletes objects nothing points to (left behind by edits), which also removes orphaned fonts. */
function collectGarbage(doc: PDFDocument) {
  const keep = reachable(doc)
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!keep.has(ref.tag)) doc.context.delete(ref)
}

export async function makePdfA(bytes: Uint8Array): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const ctx = doc.context
  const cat = doc.catalog
  const removed: string[] = []

  // Features PDF/A forbids.
  for (const key of ['OpenAction', 'AA', 'Collection']) {
    if (cat.has(PDFName.of(key))) {
      cat.delete(PDFName.of(key))
      removed.push(key === 'OpenAction' ? 'open action' : key === 'AA' ? 'document actions' : 'portfolio')
    }
  }
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict)
  for (const key of ['JavaScript', 'EmbeddedFiles', 'AlternatePresentations']) {
    if (names?.has(PDFName.of(key))) {
      names.delete(PDFName.of(key))
      removed.push(key === 'JavaScript' ? 'JavaScript' : key === 'EmbeddedFiles' ? 'embedded files' : 'presentations')
    }
  }
  const form = cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  form?.delete(PDFName.of('NeedAppearances'))

  // Annotations: must print, must not hide, must have an appearance (links excepted).
  let droppedAnnots = 0
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    const keep: PDFObject[] = []
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict)
      if (!a) continue
      const sub = a.get(PDFName.of('Subtype'))?.toString()
      a.delete(PDFName.of('AA'))
      const act = a.lookupMaybe(PDFName.of('A'), PDFDict)
      if (act && ['/JavaScript', '/Launch', '/Sound', '/Movie', '/ResetForm', '/ImportData'].includes(act.get(PDFName.of('S'))?.toString() ?? '')) a.delete(PDFName.of('A'))
      if (sub !== '/Link' && sub !== '/Popup' && !a.has(PDFName.of('AP'))) {
        droppedAnnots++
        continue
      }
      const flags = a.get(PDFName.of('F')) instanceof PDFNumber ? (a.get(PDFName.of('F')) as PDFNumber).asNumber() : 0
      if (sub !== '/Popup') a.set(PDFName.of('F'), PDFNumber.of((flags | 4) & ~(1 | 2 | 32)))
      keep.push(annots.get(i))
    }
    page.node.set(PDFName.of('Annots'), ctx.obj(keep))
  }
  if (droppedAnnots) removed.push(`${droppedAnnots} annotation${droppedAnnots > 1 ? 's' : ''} without an appearance`)

  // Info dictionary and XMP must agree.
  const created = doc.getCreationDate() ?? new Date()
  const modified = new Date()
  const title = doc.getTitle() ?? ''
  const author = doc.getAuthor() ?? ''
  const keywords = doc.getKeywords() ?? ''
  doc.setCreationDate(created)
  doc.setModificationDate(modified)
  doc.setProducer('Kwiiva Paper')
  doc.setCreator('Kwiiva Paper')
  if (!title) doc.setTitle('Untitled')
  const xmp = buildXmp({ title: doc.getTitle() ?? 'Untitled', author, keywords, created, modified, part: 2, conformance: 'B' })
  const meta = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })
  cat.set(PDFName.of('Metadata'), ctx.register(meta))

  // Output intent with an embedded sRGB profile.
  const icc = ctx.stream(srgbIccProfile(), { N: 3, Alternate: 'DeviceRGB' })
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: ctx.register(icc),
  })
  cat.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]))

  // Fonts that old text used to reference are still declared in the page resources; drop declarations nothing uses.
  const pruned = pruneUnusedFonts(doc)
  if (pruned) removed.push(`${pruned} unused font declaration${pruned > 1 ? 's' : ''}`)
  collectGarbage(doc)

  // A file identifier is required.
  if (!ctx.trailerInfo.ID) {
    const id = PDFHexString.fromText(crypto.randomUUID().replace(/-/g, '').slice(0, 16))
    ctx.trailerInfo.ID = ctx.obj([id, id])
  }
  // Object streams are allowed in PDF/A-2, but keep the cross-reference table plain for widest tool support.
  return { bytes: await doc.save({ useObjectStreams: false, updateFieldAppearances: false }), removed }
}

/* -------------------------------------------------------------------------------------------- */
/* Checker                                                                                      */
/* -------------------------------------------------------------------------------------------- */

function streamText(s: PDFObject | undefined): string {
  if (s instanceof PDFRawStream) {
    try {
      return new TextDecoder().decode(decodePDFRawStream(s).decode())
    } catch {
      return ''
    }
  }
  if (s instanceof PDFStream) return new TextDecoder().decode(s.getContents())
  return ''
}

function fontEmbedded(font: PDFDict): boolean {
  const sub = font.get(PDFName.of('Subtype'))?.toString()
  if (sub === '/Type3') return true
  let f = font
  if (sub === '/Type0') {
    const desc = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict)
    if (!desc) return false
    f = desc
  }
  const fd = f.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  return !!fd && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.has(PDFName.of(k)))
}

export async function checkPdfA(bytes: Uint8Array): Promise<PdfAReport> {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ severity: 'error', message })
  const warn = (message: string) => issues.push({ severity: 'warning', message })
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const ctx = doc.context
  const cat = doc.catalog

  if (ctx.trailerInfo.Encrypt) err('The file is encrypted (PDF/A forbids encryption).')
  if (!ctx.trailerInfo.ID) err('The file has no identifier (trailer /ID).')

  // XMP identification
  const meta = cat.lookup(PDFName.of('Metadata'))
  const xmp = streamText(meta)
  if (!xmp) err('No XMP metadata stream.')
  else {
    const part = /<pdfaid:part>\s*(\d)/.exec(xmp)?.[1] ?? /pdfaid:part="(\d)"/.exec(xmp)?.[1]
    if (!part) err('The XMP metadata does not declare a PDF/A part (pdfaid:part).')
    if (!/pdfaid:conformance/.test(xmp)) err('The XMP metadata does not declare a conformance level.')
    const t = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)</.exec(xmp)?.[1]
    if (t !== undefined && doc.getTitle() !== undefined && t.trim() !== (doc.getTitle() ?? '').trim()) warn('The document title differs between the Info dictionary and the XMP metadata.')
  }

  // Output intent
  const intents = cat.lookupMaybe(PDFName.of('OutputIntents'), PDFArray)
  const oi = intents?.lookupMaybe(0, PDFDict)
  if (!oi) err('No output intent (an embedded colour profile is required).')
  else if (!oi.has(PDFName.of('DestOutputProfile'))) err('The output intent has no embedded ICC profile.')

  // Forbidden features
  if (cat.has(PDFName.of('OpenAction'))) err('The document has an open action.')
  if (cat.has(PDFName.of('AA'))) err('The document has additional actions (possibly scripts).')
  const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict)
  if (names?.has(PDFName.of('JavaScript'))) err('The document contains JavaScript.')
  if (names?.has(PDFName.of('EmbeddedFiles'))) err('The document has embedded files (not allowed in PDF/A-2b).')
  if (cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('NeedAppearances'))) warn('The form is flagged NeedAppearances; field appearances may not be stored.')

  // Fonts, annotations, filters, scanning every object once.
  const bad = new Set<string>()
  let lzw = false
  const live = reachable(doc)
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!live.has(ref.tag)) continue // orphaned objects are not part of the document
    const dict = obj instanceof PDFStream || obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined
    if (!dict) continue
    const type = dict.get(PDFName.of('Type'))?.toString()
    if (type === '/Font' && !fontEmbedded(dict)) {
      const sub = dict.get(PDFName.of('Subtype'))?.toString()
      if (sub !== '/CIDFontType0' && sub !== '/CIDFontType2') bad.add(String(dict.get(PDFName.of('BaseFont'))?.toString().slice(1) ?? 'unnamed font'))
    }
    const filter = dict.get(PDFName.of('Filter'))
    const names = filter instanceof PDFArray ? Array.from({ length: filter.size() }, (_, i) => filter.get(i)?.toString()) : [filter?.toString()]
    if (names.includes('/LZWDecode')) lzw = true
    if (dict.get(PDFName.of('Subtype'))?.toString() === '/Widget' && !dict.has(PDFName.of('AP'))) err('A form field has no appearance stream.')
  }
  if (bad.size) err(`Fonts are not embedded: ${[...bad].join(', ')}.`)
  if (lzw) err('The file uses LZW compression, which PDF/A forbids.')
  for (const [i, page] of doc.getPages().entries()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    for (let k = 0; k < (annots?.size() ?? 0); k++) {
      const a = annots!.lookupMaybe(k, PDFDict)
      const sub = a?.get(PDFName.of('Subtype'))?.toString()
      if (!a || sub === '/Link' || sub === '/Popup') continue
      if (!a.has(PDFName.of('AP'))) err(`Page ${i + 1}: an annotation has no appearance stream.`)
      const f = a.get(PDFName.of('F')) instanceof PDFNumber ? (a.get(PDFName.of('F')) as PDFNumber).asNumber() : 0
      if (!(f & 4)) warn(`Page ${i + 1}: an annotation is not flagged to print.`)
      if (f & (2 | 32)) err(`Page ${i + 1}: an annotation is hidden.`)
    }
  }

  // This checker does not parse page content, so say what it cannot see.
  warn('Not checked: device colour spaces used in page content (CMYK/Gray need matching intents), glyph-level font checks, structure and tagging rules. For official compliance, validate with veraPDF.')
  return { passesChecks: !issues.some((i) => i.severity === 'error'), issues }
}

export { OBJ_TEXT }
