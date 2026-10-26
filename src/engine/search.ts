import { heap, withBuf, writeUtf16, free, type Pdfium } from './core'
import type { PdfDocument } from './document'
import { PageSpace, type DRect } from './space'

export interface SearchHit {
  page: number
  rects: DRect[]
}

export function makeSpace(doc: PdfDocument, page: number, pageIndex: number): PageSpace {
  const { width, height } = doc.pageSize(pageIndex)
  return new PageSpace(doc.m, page, width, height)
}

function rectsFor(m: Pdfium, textPage: number, start: number, count: number, space: PageSpace): DRect[] {
  const n = m.FPDFText_CountRects(textPage, start, count)
  const rects: DRect[] = []
  for (let i = 0; i < n; i++) {
    withBuf(m, 32, (p) => {
      m.FPDFText_GetRect(textPage, i, p, p + 8, p + 16, p + 24)
      const dv = new DataView(heap(m).buffer)
      const left = dv.getFloat64(p, true)
      const top = dv.getFloat64(p + 8, true)
      const right = dv.getFloat64(p + 16, true)
      const bottom = dv.getFloat64(p + 24, true)
      rects.push(space.rectToDevice(left, bottom, right, top))
    })
  }
  return rects
}

/** Finds all occurrences of `query` (case-insensitive) on one page. */
export function searchPage(doc: PdfDocument, pageIndex: number, query: string, opts: { matchCase?: boolean; wholeWord?: boolean } = {}): SearchHit[] {
  if (!query) return []
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const textPage = m.FPDFText_LoadPage(page)
    const q = writeUtf16(m, query)
    const hits: SearchHit[] = []
    try {
      const flags = (opts.matchCase ? 1 : 0) | (opts.wholeWord ? 2 : 0)
      const find = m.FPDFText_FindStart(textPage, q, flags, 0)
      while (m.FPDFText_FindNext(find)) {
        const start = m.FPDFText_GetSchResultIndex(find)
        const count = m.FPDFText_GetSchCount(find)
        hits.push({ page: pageIndex, rects: rectsFor(m, textPage, start, count, space) })
      }
      m.FPDFText_FindClose(find)
    } finally {
      free(m, q)
      m.FPDFText_ClosePage(textPage)
    }
    return hits
  })
}

/** Text of a device-space rectangle (for copy and for building highlights). */
export function textInRect(doc: PdfDocument, pageIndex: number, r: DRect): string {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const pr = space.rectToPage(r)
    const textPage = m.FPDFText_LoadPage(page)
    try {
      const need = m.FPDFText_GetBoundedText(textPage, pr.left, pr.top, pr.right, pr.bottom, 0, 0)
      if (need <= 0) return ''
      return withBuf(m, (need + 1) * 2, (buf) => {
        m.FPDFText_GetBoundedText(textPage, pr.left, pr.top, pr.right, pr.bottom, buf, need)
        const u16 = new Uint16Array(heap(m).buffer.slice(buf, buf + need * 2))
        return String.fromCharCode(...u16)
      })
    } finally {
      m.FPDFText_ClosePage(textPage)
    }
  })
}

/** Selection geometry between two device points: the text rectangles covered by dragging from a to b. */
export function selectionRects(doc: PdfDocument, pageIndex: number, a: [number, number], b: [number, number]): { rects: DRect[]; text: string } {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const textPage = m.FPDFText_LoadPage(page)
    try {
      const [ax, ay] = space.toPage(a[0], a[1])
      const [bx, by] = space.toPage(b[0], b[1])
      // Dragging past the end of a line should still select to its last character, so widen the
      // horizontal tolerance step by step while keeping the vertical one tight.
      const charAt = (x: number, y: number) => {
        for (const xTol of [6, 40, 400]) {
          const i = m.FPDFText_GetCharIndexAtPos(textPage, x, y, xTol, 6)
          if (i >= 0) return i
        }
        return -1
      }
      const i0 = charAt(ax, ay)
      const i1 = charAt(bx, by)
      if (i0 < 0 || i1 < 0) return { rects: [], text: '' }
      const start = Math.min(i0, i1)
      const count = Math.abs(i1 - i0) + 1
      const rects = rectsFor(m, textPage, start, count, space)
      const need = m.FPDFText_GetText(textPage, start, count, 0)
      const text = withBuf(m, (count + 1) * 2, (buf) => {
        m.FPDFText_GetText(textPage, start, count, buf)
        const u16 = new Uint16Array(heap(m).buffer.slice(buf, buf + count * 2))
        return String.fromCharCode(...u16)
      })
      void need
      return { rects, text }
    } finally {
      m.FPDFText_ClosePage(textPage)
    }
  })
}

/** Finds regular-expression matches in a page's text; returns device rectangles per match. */
export function regexMatches(doc: PdfDocument, pageIndex: number, re: RegExp): { text: string; rects: DRect[] }[] {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const textPage = m.FPDFText_LoadPage(page)
    try {
      const n = m.FPDFText_CountChars(textPage)
      if (n <= 0) return []
      // Character indices and string indices can differ (surrogate pairs), so index by UTF-16 unit of what PDFium returned.
      const text = withBuf(m, (n + 1) * 2, (buf) => {
        m.FPDFText_GetText(textPage, 0, n, buf)
        const u16 = new Uint16Array(heap(m).buffer.slice(buf, buf + n * 2))
        return String.fromCharCode(...u16)
      })
      const out: { text: string; rects: DRect[] }[] = []
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      for (const mt of text.matchAll(g)) {
        if (!mt[0].trim()) continue
        out.push({ text: mt[0], rects: rectsFor(m, textPage, mt.index!, mt[0].length, space) })
      }
      return out
    } finally {
      m.FPDFText_ClosePage(textPage)
    }
  })
}
