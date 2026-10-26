/// <reference lib="webworker" />
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import { loadPdfium, PdfError, readUtf16, withBuf, type Pdfium } from './core'
import { PdfDocument } from './document'
import { editBlock, OverflowError, UnsupportedCharactersError } from './edit'
import { addImage, addInk, addMarkup, addNote, addShape, addText, listAnnotations, redact, removeAnnotation, type RGBA } from './annotate'
import { deletePages, extractPages, importPages, movePages, rotatePages } from './pages'
import { cropPage, flattenPage, insertBlankPage, readLinks, readOutline, stampText, type StampSpec } from './extras'
import { readProps, sanitize, writeProps, type DocProps, type SanitizeOptions } from './meta'
import { buildDocx } from './docx'
import { compareParagraphs } from './compare'
import { deleteImage, listImages, placeImage, replaceImage } from './objects'
import { inspectCertificate, signWithCertificate, type SignOptions } from './sign'
import { checkAccessibility, buildStructureTree, listFigures, markContent } from './access'
import { checkPdfA, embedFonts, makePdfA } from './pdfa'
import { countSignatures, verifySignatures } from './verify'
import { addOcrLayer, type OcrWord } from './ocr'
import { coverage } from './fonts'
import { optimize, protect, type Permissions } from './qpdf'
import { regexMatches, searchPage, selectionRects, makeSpace } from './search'
import type { DRect } from './space'
import { extractBlocks, type TextBlock } from './text'
import { addField, fillFields, listFields, type NewField } from './forms'
import type { BlockInfo, DocInfo, FieldInfo } from './protocol'

let pdfium: Promise<Pdfium> | null = null
let pdfiumInstance: Pdfium | null = null
const pdfiumSync = (): Pdfium => pdfiumInstance!
const getPdfium = () =>
  (pdfium ??= fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then(loadPdfium)
    .then((m) => (pdfiumInstance = m)))

interface Session {
  doc: PdfDocument
  rev: number
  undo: Uint8Array[]
  redo: Uint8Array[]
  blocks: Map<string, TextBlock>
  blocksRev: number
  /** Signatures found in the file as it was opened. */
  signed: number
  original: Uint8Array
}

const sessions = new Map<string, Session>()
const fontCache = new Map<string, Promise<Uint8Array>>()
/** Absolute URL of the app root; set by the page because a worker's own URL says nothing about it. */
let baseUrl = ''
const MAX_UNDO = 25

function loadFont(file: string): Promise<Uint8Array> {
  let p = fontCache.get(file)
  if (!p) {
    p = fetch(`${baseUrl}fonts/${file}`).then(async (r) => {
      const bytes = new Uint8Array(await r.arrayBuffer())
      // A static host may answer a missing file with its HTML fallback page, so check the TrueType signature too.
      const sig = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
      if (!r.ok || (sig !== 0x00010000 && sig !== 0x74727565)) {
        fontCache.delete(file)
        throw new Error(`Missing bundled font ${file}`)
      }
      return bytes
    })
    fontCache.set(file, p)
  }
  return p
}

function session(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new PdfError('Document is not open')
  return s
}

function info(s: Session): DocInfo {
  const sizes = Array.from({ length: s.doc.pageCount }, (_, i) => s.doc.pageSize(i))
  return { pageCount: sizes.length, sizes, rev: s.rev, canUndo: s.undo.length > 0, canRedo: s.redo.length > 0 }
}

/** Runs a mutation with an undo snapshot taken first. */
function mutate<T>(s: Session, fn: () => T): T {
  const snap = s.doc.save()
  const out = fn()
  s.undo.push(snap)
  if (s.undo.length > MAX_UNDO) s.undo.shift()
  s.redo.length = 0
  s.rev++
  return out
}

function restore(s: Session, bytes: Uint8Array, m: Pdfium) {
  s.doc.close()
  s.doc = PdfDocument.open(m, bytes)
  s.rev++
}

const handlers = {
  init(a: { base: string }) {
    baseUrl = a.base
  },

  async open(a: { id: string; bytes: Uint8Array; password?: string }): Promise<DocInfo> {
    const m = await getPdfium()
    const doc = PdfDocument.open(m, a.bytes, a.password ?? '')
    sessions.set(a.id, { doc, rev: 0, undo: [], redo: [], blocks: new Map(), blocksRev: -1, signed: countSignatures(a.bytes), original: a.bytes })
    return info(session(a.id))
  },

  async create(a: { id: string }): Promise<DocInfo> {
    const m = await getPdfium()
    const doc = PdfDocument.create(m)
    m.FPDFPage_New(doc.raw, 0, 612, 792)
    sessions.set(a.id, { doc, rev: 0, undo: [], redo: [], blocks: new Map(), blocksRev: -1, signed: 0, original: new Uint8Array() })
    return info(session(a.id))
  },

  close(a: { id: string }) {
    sessions.get(a.id)?.doc.close()
    sessions.delete(a.id)
  },

  info: (a: { id: string }) => info(session(a.id)),

  render(a: { id: string; page: number; scale: number }) {
    const img = session(a.id).doc.renderPage(a.page, a.scale)
    return { value: img, transfer: [img.data.buffer] }
  },

  blocks(a: { id: string; page: number }): BlockInfo[] {
    const s = session(a.id)
    if (s.blocksRev !== s.rev) {
      s.blocks.clear()
      s.blocksRev = s.rev
    }
    const blocks = extractBlocks(s.doc, a.page)
    return s.doc.withPage(a.page, (page) => {
      const space = makeSpace(s.doc, page, a.page)
      return blocks.map((b) => {
        s.blocks.set(b.id, b)
        return {
          id: b.id,
          text: b.text,
          rect: space.rectToDevice(b.bbox.left, b.bbox.bottom, b.bbox.right, b.bbox.top),
          fontSize: b.fontSize,
          fontName: b.runs[0].fontName,
          lines: b.lines.length,
          color: b.runs[0].color,
        }
      })
    })
  },

  async editBlock(a: { id: string; blockId: string; text: string; overflow?: 'ask' | 'push' | 'overlap' }) {
    const s = session(a.id)
    const m = await getPdfium()
    const block = s.blocks.get(a.blockId)
    if (!block || s.blocksRev !== s.rev) throw new PdfError('The page changed; reselect the text and try again')
    const size = s.doc.pageSize(block.pageIndex)
    const snap = s.doc.save()
    try {
      const res = await editBlock(s.doc, block, a.text, { loadFont, maxRight: size.width - 36, overflow: a.overflow })
      s.undo.push(snap)
      if (s.undo.length > MAX_UNDO) s.undo.shift()
      s.redo.length = 0
      s.rev++
      return res
    } catch (e) {
      // These two are refused before anything is written, so the document is untouched.
      if (e instanceof UnsupportedCharactersError) throw Object.assign(new Error(e.message), { name: 'UnsupportedCharacters' })
      if (e instanceof OverflowError) throw Object.assign(new Error(e.message), { name: 'Overflow', data: { extraLines: e.extraLines, collidesWith: e.collidesWith, canPush: e.canPush } })
      // Anything else may have left the page half-modified: put the document back.
      restore(s, snap, m)
      s.rev--
      throw e
    }
  },

  save: (a: { id: string }) => {
    const bytes = session(a.id).doc.save()
    return { value: bytes, transfer: [bytes.buffer] }
  },

  async undo(a: { id: string }): Promise<DocInfo> {
    const s = session(a.id)
    const prev = s.undo.pop()
    if (!prev) return info(s)
    s.redo.push(s.doc.save())
    restore(s, prev, await getPdfium())
    return info(s)
  },

  async redo(a: { id: string }): Promise<DocInfo> {
    const s = session(a.id)
    const next = s.redo.pop()
    if (!next) return info(s)
    s.undo.push(s.doc.save())
    restore(s, next, await getPdfium())
    return info(s)
  },

  deletePages(a: { id: string; pages: number[] }) {
    const s = session(a.id)
    mutate(s, () => deletePages(s.doc, a.pages))
    return info(s)
  },
  rotatePages(a: { id: string; pages: number[]; degrees: 90 | 180 | 270 }) {
    const s = session(a.id)
    mutate(s, () => rotatePages(s.doc, a.pages, a.degrees))
    return info(s)
  },
  movePages(a: { id: string; pages: number[]; dest: number }) {
    const s = session(a.id)
    mutate(s, () => movePages(s.doc, a.pages, a.dest))
    return info(s)
  },
  async insertPdf(a: { id: string; bytes: Uint8Array; at: number; pages?: number[] }) {
    const s = session(a.id)
    const m = await getPdfium()
    const src = PdfDocument.open(m, a.bytes)
    try {
      mutate(s, () => importPages(s.doc, src, a.at, a.pages))
    } finally {
      src.close()
    }
    return info(s)
  },
  extract(a: { id: string; pages: number[] }) {
    const bytes = extractPages(session(a.id).doc, a.pages)
    return { value: bytes, transfer: [bytes.buffer] }
  },

  search(a: { id: string; query: string; matchCase?: boolean }) {
    const s = session(a.id)
    const out = []
    for (let i = 0; i < s.doc.pageCount; i++) out.push(...searchPage(s.doc, i, a.query, { matchCase: a.matchCase }))
    return out
  },
  selection(a: { id: string; page: number; from: [number, number]; to: [number, number] }) {
    return selectionRects(session(a.id).doc, a.page, a.from, a.to)
  },

  markup(a: { id: string; page: number; kind: 'highlight' | 'underline' | 'strikeout'; rects: DRect[]; color: RGBA; note?: string }) {
    const s = session(a.id)
    mutate(s, () => addMarkup(s.doc, a.page, a.kind, a.rects, a.color, a.note))
    return info(s)
  },
  shape(a: { id: string; page: number; kind: 'square' | 'circle'; rect: DRect; stroke: RGBA; fill: RGBA | null; width: number }) {
    const s = session(a.id)
    mutate(s, () => addShape(s.doc, a.page, a.kind, a.rect, a.stroke, a.fill, a.width))
    return info(s)
  },
  ink(a: { id: string; page: number; points: [number, number][]; color: RGBA; width: number }) {
    const s = session(a.id)
    mutate(s, () => addInk(s.doc, a.page, a.points, a.color, a.width))
    return info(s)
  },
  note(a: { id: string; page: number; at: [number, number]; text: string }) {
    const s = session(a.id)
    mutate(s, () => addNote(s.doc, a.page, a.at, a.text))
    return info(s)
  },
  annotations: (a: { id: string; page: number }) => listAnnotations(session(a.id).doc, a.page),
  removeAnnotation(a: { id: string; page: number; index: number }) {
    const s = session(a.id)
    mutate(s, () => removeAnnotation(s.doc, a.page, a.index))
    return info(s)
  },
  redact(a: { id: string; page: number; rect: DRect }) {
    const s = session(a.id)
    const res = mutate(s, () => redact(s.doc, a.page, a.rect))
    return { ...info(s), removed: res.removed }
  },
  image(a: { id: string; page: number; rgba: Uint8ClampedArray; w: number; h: number; rect: DRect }) {
    const s = session(a.id)
    mutate(s, () => addImage(s.doc, a.page, a.rgba, a.w, a.h, a.rect))
    return info(s)
  },
  async formFields(a: { id: string }): Promise<FieldInfo[]> {
    const s = session(a.id)
    const fields = await listFields(s.doc.save())
    return fields.map((f) => ({
      ...f,
      widgets: f.widgets.map((w) => ({
        page: w.page,
        option: w.option,
        // PageSpace is only valid while its page is open, so convert inside withPage.
        rect: s.doc.withPage(w.page, (p) => makeSpace(s.doc, p, w.page).rectToDevice(w.rect[0], w.rect[1], w.rect[2], w.rect[3])),
      })),
    }))
  },

  async fillForm(a: { id: string; values: Record<string, string | boolean> }): Promise<DocInfo> {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    const after = await fillFields(before, a.values)
    s.undo.push(before)
    if (s.undo.length > MAX_UNDO) s.undo.shift()
    s.redo.length = 0
    restore(s, after, m)
    return info(s)
  },

  exportText(a: { id: string }): string {
    const s = session(a.id)
    const m = pdfiumSync()
    const out: string[] = []
    for (let i = 0; i < s.doc.pageCount; i++) {
      out.push(
        s.doc.withPage(i, (page) => {
          const tp = m.FPDFText_LoadPage(page)
          try {
            const n = m.FPDFText_CountChars(tp)
            if (n <= 0) return ''
            return withBuf(m, (n + 1) * 2, (buf) => {
              m.FPDFText_GetText(tp, 0, n, buf)
              return readUtf16(m, buf, (n + 1) * 2).replace(/\r\n/g, '\n')
            })
          } finally {
            m.FPDFText_ClosePage(tp)
          }
        }),
      )
    }
    return out.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n')
  },

  /** Encrypts a copy for download; the open document stays editable and unencrypted. */
  async protect(a: { id: string; user: string; owner?: string; perms?: Permissions }) {
    const bytes = await protect(session(a.id).doc.save(), a.user, a.owner || a.user, a.perms)
    return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] }
  },

  async optimize(a: { id: string }) {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    const after = await optimize(before)
    // Keep whichever is smaller; optimizing an already-tight file can make it bigger.
    if (after.length < before.length) {
      s.undo.push(before)
      s.redo.length = 0
      restore(s, after, m)
    }
    return { ...info(s), before: before.length, after: Math.min(before.length, after.length) }
  },

  async fromImages(a: { id: string; images: { rgba: Uint8ClampedArray; w: number; h: number }[] }): Promise<DocInfo> {
    const m = await getPdfium()
    const doc = PdfDocument.create(m)
    a.images.forEach((img, i) => {
      // 1 px = 1 pt, shrunk so the longest side fits within A3.
      const k = Math.min(1, 1190 / Math.max(img.w, img.h))
      const w = img.w * k
      const h = img.h * k
      m.FPDFPage_New(doc.raw, i, w, h)
      addImage(doc, i, img.rgba, img.w, img.h, { x: 0, y: 0, w, h })
    })
    sessions.set(a.id, { doc, rev: 0, undo: [], redo: [], blocks: new Map(), blocksRev: -1, signed: 0, original: new Uint8Array() })
    return info(session(a.id))
  },

  async ocrLayer(a: { id: string; page: number; words: OcrWord[] }) {
    const s = session(a.id)
    const font = await loadFont('LiberationSans-Regular.ttf')
    const covered = coverage(font)
    const added = mutate(s, () => addOcrLayer(s.doc, a.page, a.words, font, covered))
    return { ...info(s), added }
  },

  outline: (a: { id: string }) => readOutline(session(a.id).doc),
  links: (a: { id: string; page: number }) => readLinks(session(a.id).doc, a.page),

  insertBlank(a: { id: string; at: number }) {
    const s = session(a.id)
    mutate(s, () => insertBlankPage(s.doc, a.at))
    return info(s)
  },
  crop(a: { id: string; pages: number[]; rect: DRect }) {
    const s = session(a.id)
    mutate(s, () => a.pages.forEach((p) => cropPage(s.doc, p, a.rect)))
    return info(s)
  },
  flatten(a: { id: string; pages?: number[] }) {
    const s = session(a.id)
    const pages = a.pages ?? Array.from({ length: s.doc.pageCount }, (_, i) => i)
    mutate(s, () => pages.forEach((p) => flattenPage(s.doc, p)))
    return info(s)
  },
  async stamp(a: { id: string; pages: number[]; spec: StampSpec }) {
    const s = session(a.id)
    const font = await loadFont('LiberationSans-Regular.ttf')
    mutate(s, () => stampText(s.doc, a.pages, a.spec, font, coverage(font)))
    return info(s)
  },

  props: (a: { id: string }) => readProps(session(a.id).doc.save()),
  async setProps(a: { id: string; props: Partial<DocProps> }) {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    const after = await writeProps(before, a.props)
    s.undo.push(before)
    s.redo.length = 0
    restore(s, after, m)
    return info(s)
  },
  async sanitize(a: { id: string; options: SanitizeOptions }) {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    const res = await sanitize(before, a.options)
    s.undo.push(before)
    s.redo.length = 0
    restore(s, res.bytes, m)
    return { ...info(s), removed: res.removed }
  },

  exportDocx(a: { id: string }) {
    const s = session(a.id)
    const pages = Array.from({ length: s.doc.pageCount }, (_, i) => extractBlocks(s.doc, i))
    const bytes = buildDocx(pages)
    return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] }
  },

  images: (a: { id: string; page: number }) => listImages(session(a.id).doc, a.page),
  imagePlace(a: { id: string; page: number; index: number; rect: DRect }) {
    const s = session(a.id)
    mutate(s, () => placeImage(s.doc, a.page, a.index, a.rect))
    return info(s)
  },
  imageDelete(a: { id: string; page: number; index: number }) {
    const s = session(a.id)
    mutate(s, () => deleteImage(s.doc, a.page, a.index))
    return info(s)
  },
  imageReplace(a: { id: string; page: number; index: number; rgba: Uint8ClampedArray; w: number; h: number }) {
    const s = session(a.id)
    mutate(s, () => replaceImage(s.doc, a.page, a.index, a.rgba, a.w, a.h))
    return info(s)
  },

  async addField(a: { id: string; field: Omit<NewField, 'rect'> & { rect: DRect } }) {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    const pr = s.doc.withPage(a.field.page, (p) => makeSpace(s.doc, p, a.field.page).rectToPage(a.field.rect))
    const after = await addField(before, { ...a.field, rect: [pr.left, pr.bottom, pr.right, pr.top] })
    s.undo.push(before)
    s.redo.length = 0
    restore(s, after, m)
    return info(s)
  },

  compare(a: { a: string; b: string }) {
    const paras = (id: string) => {
      const s = session(id)
      return Array.from({ length: s.doc.pageCount }, (_, i) => extractBlocks(s.doc, i).sort((x, y) => y.bbox.top - x.bbox.top || x.bbox.left - y.bbox.left).map((b) => ({ text: b.text, page: i }))).flat()
    }
    return compareParagraphs(paras(a.a), paras(a.b))
  },

  certInfo(a: { p12: Uint8Array; password: string }) {
    const c = inspectCertificate(a.p12, a.password)
    return { ...c, validFrom: c.validFrom.toISOString(), validTo: c.validTo.toISOString() }
  },
  /** Signs a copy for download. The open document is untouched, since re-saving would break the signature. */
  async signCertificate(a: { id: string; p12: Uint8Array; password: string; rect?: DRect; page?: number; reason?: string; location?: string; visible?: boolean }) {
    const s = session(a.id)
    const page = a.page ?? 0
    let rect: SignOptions['rect']
    if (a.rect) {
      const pr = s.doc.withPage(page, (p) => makeSpace(s.doc, p, page).rectToPage(a.rect!))
      rect = [pr.left, pr.bottom, pr.right, pr.top]
    }
    let source = s.doc.save()
    if (a.visible && a.rect) {
      // Draw the human-readable stamp on a scratch copy, then sign that copy.
      const m = await getPdfium()
      const who = inspectCertificate(a.p12, a.password).commonName
      const font = await loadFont('LiberationSans-Regular.ttf')
      const tmp = PdfDocument.open(m, source)
      try {
        const lines = [`Digitally signed by ${who}`, `Date: ${new Date().toLocaleString()}`, ...(a.reason ? [`Reason: ${a.reason}`] : [])]
        addText(tmp, page, [a.rect.x + 4, a.rect.y + 11], lines.join('\n'), font, 'LiberationSans-Regular', 9, [20, 30, 90, 255])
        source = tmp.save()
      } finally {
        tmp.close()
      }
    }
    const bytes = await signWithCertificate(source, a.p12, a.password, { reason: a.reason, location: a.location, rect, pageIndex: page })
    return { value: bytes, transfer: [bytes.buffer as ArrayBuffer] }
  },

  redactMatches(a: { id: string; patterns: { source: string; flags: string }[]; dryRun?: boolean }) {
    const s = session(a.id)
    const found: { page: number; text: string; rects: DRect[] }[] = []
    for (let i = 0; i < s.doc.pageCount; i++)
      for (const p of a.patterns)
        for (const mt of regexMatches(s.doc, i, new RegExp(p.source, p.flags))) found.push({ page: i, ...mt })
    if (!a.dryRun && found.length) {
      mutate(s, () => {
        // Redacting changes object indices, but redact() works from geometry so order doesn't matter.
        for (const f of found) for (const r of f.rects) redact(s.doc, f.page, r)
      })
    }
    return { ...info(s), found: found.map((f) => ({ page: f.page, text: f.text })) }
  },

  /** Validates signatures in the file exactly as it was opened (later edits would change the bytes). */
  async signatures(a: { id: string }) {
    const s = session(a.id)
    return s.signed ? verifySignatures(s.original) : []
  },

  pdfaCheck: async (a: { id: string }) => checkPdfA(session(a.id).doc.save()),
  async pdfaConvert(a: { id: string; flatten: boolean }) {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    try {
      const fonts = await embedFonts(s.doc, loadFont, { flatten: a.flatten })
      const out = await makePdfA(s.doc.save())
      s.undo.push(before)
      s.redo.length = 0
      restore(s, out.bytes, m)
      const report = await checkPdfA(out.bytes)
      return { ...info(s), report, removed: out.removed, fonts }
    } catch (e) {
      restore(s, before, m)
      s.rev--
      throw e
    }
  },

  async a11yCheck(a: { id: string }) {
    const s = session(a.id)
    const textPerPage = Array.from({ length: s.doc.pageCount }, (_, i) => extractBlocks(s.doc, i).length > 0)
    return checkAccessibility(s.doc.save(), textPerPage)
  },
  a11yFigures: (a: { id: string }) => listFigures(session(a.id).doc),
  async a11yTag(a: { id: string; lang: string; title: string; alts: Record<string, string> }) {
    const s = session(a.id)
    const m = await getPdfium()
    const before = s.doc.save()
    try {
      const structure = markContent(s.doc, a.alts)
      const tagged = await buildStructureTree(s.doc.save(), structure, { lang: a.lang, title: a.title })
      s.undo.push(before)
      s.redo.length = 0
      restore(s, tagged, m)
      return info(s)
    } catch (e) {
      restore(s, before, m)
      s.rev--
      throw e
    }
  },

  async text(a: { id: string; page: number; at: [number, number]; text: string; size: number; color: RGBA }) {
    const s = session(a.id)
    const file = /[^\u0000-ɏ‐-⃿]/.test(a.text) ? 'DejaVuSans.ttf' : 'LiberationSans-Regular.ttf'
    const data = await loadFont(file)
    mutate(s, () => addText(s.doc, a.page, a.at, a.text, data, file, a.size, a.color))
    return info(s)
  },
}

export type Handlers = typeof handlers

self.onmessage = async (e: MessageEvent<{ reqId: number; method: keyof Handlers; args: never }>) => {
  const { reqId, method, args } = e.data
  if (reqId === 0) {
    handlers[method](args)
    return
  }
  try {
    const out = await (handlers[method] as (a: never) => unknown)(args)
    const wrapped = out && typeof out === 'object' && 'transfer' in out && 'value' in out ? (out as { value: unknown; transfer: Transferable[] }) : { value: out, transfer: [] }
    self.postMessage({ reqId, ok: true, result: wrapped.value }, wrapped.transfer)
  } catch (err) {
    const e = err as Error
    self.postMessage({ reqId, ok: false, error: e.message || String(err), name: e.name, data: (err as { data?: unknown }).data })
  }
}
