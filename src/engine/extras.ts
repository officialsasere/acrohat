import { alloc, free, heap, heapF32, heapU32, PdfError, readUtf16, withBuf, writeUtf16, type Pdfium } from './core'
import type { PdfDocument } from './document'
import { makeSpace } from './search'
import type { DRect } from './space'

/** Outline (bookmarks), links, blank pages, cropping, flattening and text stamps. */

export interface OutlineItem {
  title: string
  /** Zero-based page, or -1 when the bookmark has no page destination. */
  page: number
  children: OutlineItem[]
}

function utf16(m: Pdfium, size: (p: number) => number, fill: (p: number, n: number) => unknown): string {
  const n = size(0)
  if (n <= 2) return ''
  return withBuf(m, n, (p) => {
    fill(p, n)
    return readUtf16(m, p, n)
  })
}

export function readOutline(doc: PdfDocument): OutlineItem[] {
  const m = doc.m
  const walk = (parent: number, depth: number): OutlineItem[] => {
    const out: OutlineItem[] = []
    let bm = m.FPDFBookmark_GetFirstChild(doc.raw, parent)
    for (let guard = 0; bm && guard < 5000; guard++) {
      const title = utf16(
        m,
        () => m.FPDFBookmark_GetTitle(bm, 0, 0),
        (p, n) => m.FPDFBookmark_GetTitle(bm, p, n),
      )
      let dest = m.FPDFBookmark_GetDest(doc.raw, bm)
      if (!dest) {
        const action = m.FPDFBookmark_GetAction(bm)
        if (action) dest = m.FPDFAction_GetDest(doc.raw, action)
      }
      const page = dest ? m.FPDFDest_GetDestPageIndex(doc.raw, dest) : -1
      out.push({ title: title || '(untitled)', page, children: depth < 12 ? walk(bm, depth + 1) : [] })
      bm = m.FPDFBookmark_GetNextSibling(doc.raw, bm)
    }
    return out
  }
  return walk(0, 0)
}

export interface PageLink {
  rect: DRect
  page?: number
  uri?: string
}

export function readLinks(doc: PdfDocument, pageIndex: number): PageLink[] {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const links: PageLink[] = []
    withBuf(m, 8, (pos) => {
      heapU32(m)[pos >> 2] = 0
      const annotPtr = pos + 4
      while (m.FPDFLink_Enumerate(page, pos, annotPtr)) {
        const link = heapU32(m)[annotPtr >> 2]
        const rect = withBuf(m, 16, (p) => {
          if (!m.FPDFLink_GetAnnotRect(link, p)) return null
          const [l, t, r, b] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
          return space.rectToDevice(l, b, r, t)
        })
        if (!rect) continue
        let dest = m.FPDFLink_GetDest(doc.raw, link)
        const action = m.FPDFLink_GetAction(link)
        let uri: string | undefined
        if (!dest && action) {
          const type = m.FPDFAction_GetType(action)
          if (type === 1) dest = m.FPDFAction_GetDest(doc.raw, action) // GoTo
          else if (type === 3) {
            // URI; PDFium writes 7-bit ASCII
            const need = m.FPDFAction_GetURIPath(doc.raw, action, 0, 0)
            if (need > 1)
              uri = withBuf(m, need, (p) => {
                m.FPDFAction_GetURIPath(doc.raw, action, p, need)
                return String.fromCharCode(...heap(m).subarray(p, p + need - 1))
              })
          }
        }
        const target = dest ? m.FPDFDest_GetDestPageIndex(doc.raw, dest) : -1
        if (target >= 0) links.push({ rect, page: target })
        else if (uri) links.push({ rect, uri })
      }
    })
    return links
  })
}

export function insertBlankPage(doc: PdfDocument, at: number, size?: { width: number; height: number }) {
  // Match the neighbouring page's size by default, which is what people expect.
  const ref = size ?? doc.pageSize(Math.min(Math.max(at - 1, 0), doc.pageCount - 1))
  if (!doc.m.FPDFPage_New(doc.raw, at, ref.width, ref.height)) throw new PdfError('Could not add a page')
  // FPDFPage_New returns an open page handle that must be closed.
  const page = doc.m.FPDF_LoadPage(doc.raw, at)
  if (page) doc.m.FPDF_ClosePage(page)
}

/** Crops a page to a rectangle given in device points. */
export function cropPage(doc: PdfDocument, pageIndex: number, r: DRect) {
  if (r.w < 8 || r.h < 8) throw new PdfError('The crop area is too small')
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const pr = makeSpace(doc, page, pageIndex).rectToPage(r)
    m.FPDFPage_SetCropBox(page, pr.left, pr.bottom, pr.right, pr.top)
  })
}

/** Bakes annotations and form-field appearances into the page content. */
export function flattenPage(doc: PdfDocument, pageIndex: number): boolean {
  return doc.withPage(pageIndex, (page) => doc.m.FPDFPage_Flatten(page, 0) === 1)
}

export interface StampSpec {
  /** May contain {page}, {pages}, {date}, {bates} (zero-padded counter). */
  text: string
  size: number
  color: [number, number, number]
  /** 0-255 */
  alpha: number
  /** Degrees, counter-clockwise. */
  angle: number
  position: 'center' | 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
  margin: number
  batesStart?: number
  batesDigits?: number
}

export function expandTokens(text: string, page: number, pages: number, spec: Pick<StampSpec, 'batesStart' | 'batesDigits'>): string {
  const bates = String((spec.batesStart ?? 1) + page).padStart(spec.batesDigits ?? 6, '0')
  return text
    .replace(/\{pages\}/g, String(pages))
    .replace(/\{page\}/g, String(page + 1))
    .replace(/\{date\}/g, new Date().toLocaleDateString())
    .replace(/\{bates\}/g, bates)
}

/** Draws text (watermark, header/footer, page number, Bates number) on the given pages. */
export function stampText(doc: PdfDocument, pages: number[], spec: StampSpec, fontData: Uint8Array, covered: (cp: number) => boolean) {
  const m = doc.m
  const fp = alloc(m, fontData.length)
  heap(m).set(fontData, fp)
  const font = m.FPDFText_LoadFont(doc.raw, fp, fontData.length, 2, true)
  free(m, fp)
  if (!font) throw new PdfError('Could not load the stamp font')
  const total = doc.pageCount
  for (const idx of pages) {
    const text = [...expandTokens(spec.text, idx, total, spec)].filter((c) => covered(c.codePointAt(0)!)).join('')
    if (!text) continue
    doc.withPage(idx, (page) => {
      const space = makeSpace(doc, page, idx)
      const obj = m.FPDFPageObj_CreateTextObj(doc.raw, font, spec.size)
      const u = writeUtf16(m, text)
      m.FPDFText_SetText(obj, u)
      free(m, u)
      const w = withBuf(m, 16, (p) => {
        m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
        const [l, , r] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
        return r - l
      })
      const h = spec.size
      const W = space.width
      const H = space.height
      const mg = spec.margin
      const [vert, horiz] = spec.position === 'center' ? ['mid', 'center'] : (spec.position.split('-') as [string, string])
      const dx = horiz === 'left' ? mg : horiz === 'right' ? W - mg - w : (W - w) / 2
      const dy = vert === 'top' ? mg + h * 0.8 : vert === 'bottom' ? H - mg : H / 2 + h * 0.3
      // Anchor in device space, then rotate about the text's centre so a diagonal watermark stays centred.
      const rad = (spec.angle * Math.PI) / 180
      const cx = dx + w / 2
      const cy = dy - h * 0.3
      const [ox, oy] = space.toPage(cx, cy)
      const pageRot = m.FPDFPage_GetRotation(page) * 90
      const a = rad - (pageRot * Math.PI) / 180
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      // Text origin relative to its centre, rotated.
      const lx = -w / 2
      const ly = -h * 0.3
      withBuf(m, 24, (p) => {
        heapF32(m).set([cos, sin, -sin, cos, ox + lx * cos - ly * sin, oy + lx * sin + ly * cos], p >> 2)
        m.FPDFPageObj_SetMatrix(obj, p)
      })
      m.FPDFPageObj_SetFillColor(obj, spec.color[0], spec.color[1], spec.color[2], spec.alpha)
      m.FPDFPage_InsertObject(page, obj)
      if (!m.FPDFPage_GenerateContent(page)) throw new PdfError('Could not write the page content')
    })
  }
}
