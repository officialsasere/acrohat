import { alloc, free, heap, heapF32, PdfError, withBuf, writeUtf16, type Pdfium } from './core'
import type { PdfDocument } from './document'
import { makeSpace } from './search'
import type { DRect } from './space'
import { OBJ_TEXT } from './text'

// FPDF_ANNOTATION_SUBTYPE values
export const ANNOT = {
  text: 1,
  square: 5,
  circle: 6,
  highlight: 9,
  underline: 10,
  strikeout: 12,
  ink: 15,
} as const

export type RGBA = [number, number, number, number]

function setRect(m: Pdfium, annot: number, r: { left: number; bottom: number; right: number; top: number }) {
  withBuf(m, 16, (p) => {
    // FS_RECTF is { left, top, right, bottom }
    heapF32(m).set([r.left, r.top, r.right, r.bottom], p >> 2)
    m.FPDFAnnot_SetRect(annot, p)
  })
}

function setColor(m: Pdfium, annot: number, kind: 0 | 1, c: RGBA) {
  m.FPDFAnnot_SetColor(annot, kind, c[0], c[1], c[2], c[3])
}

function setString(m: Pdfium, annot: number, key: string, value: string) {
  const p = writeUtf16(m, value)
  m.FPDFAnnot_SetStringValue(annot, key, p)
  free(m, p)
}

function newAnnot(m: Pdfium, page: number, subtype: number): number {
  const a = m.FPDFPage_CreateAnnot(page, subtype)
  if (!a) throw new PdfError('Could not create the annotation')
  return a
}

/** Highlight / underline / strikeout over text rectangles (device points). */
export function addMarkup(doc: PdfDocument, pageIndex: number, kind: 'highlight' | 'underline' | 'strikeout', rects: DRect[], color: RGBA, note?: string) {
  if (!rects.length) return
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const annot = newAnnot(m, page, ANNOT[kind])
    try {
      const pr = rects.map((r) => space.rectToPage(r))
      for (const r of pr) {
        withBuf(m, 32, (p) => {
          // Quad order used by Acrobat: top-left, top-right, bottom-left, bottom-right.
          heapF32(m).set([r.left, r.top, r.right, r.top, r.left, r.bottom, r.right, r.bottom], p >> 2)
          m.FPDFAnnot_AppendAttachmentPoints(annot, p)
        })
      }
      setRect(m, annot, {
        left: Math.min(...pr.map((r) => r.left)),
        bottom: Math.min(...pr.map((r) => r.bottom)),
        right: Math.max(...pr.map((r) => r.right)),
        top: Math.max(...pr.map((r) => r.top)),
      })
      setColor(m, annot, 0, color)
      if (note) setString(m, annot, 'Contents', note)
    } finally {
      m.FPDFPage_CloseAnnot(annot)
    }
  })
}

export function addShape(doc: PdfDocument, pageIndex: number, kind: 'square' | 'circle', r: DRect, stroke: RGBA, fill: RGBA | null, width: number) {
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const annot = newAnnot(m, page, ANNOT[kind])
    try {
      setRect(m, annot, space.rectToPage(r))
      setColor(m, annot, 0, stroke)
      if (fill) setColor(m, annot, 1, fill)
      withBuf(m, 12, (p) => {
        heapF32(m).set([0, 0, width], p >> 2)
        m.FPDFAnnot_SetBorder(annot, 0, 0, width)
      })
    } finally {
      m.FPDFPage_CloseAnnot(annot)
    }
  })
}

/** Freehand stroke from device-point samples. */
export function addInk(doc: PdfDocument, pageIndex: number, points: [number, number][], color: RGBA, width: number) {
  if (points.length < 2) return
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const pagePts = points.map(([x, y]) => space.toPage(x, y))
    const annot = newAnnot(m, page, ANNOT.ink)
    try {
      const xs = pagePts.map((p) => p[0])
      const ys = pagePts.map((p) => p[1])
      const pad = width
      setRect(m, annot, { left: Math.min(...xs) - pad, right: Math.max(...xs) + pad, bottom: Math.min(...ys) - pad, top: Math.max(...ys) + pad })
      setColor(m, annot, 0, color)
      m.FPDFAnnot_SetBorder(annot, 0, 0, width)
      withBuf(m, pagePts.length * 8, (p) => {
        heapF32(m).set(pagePts.flat(), p >> 2)
        m.FPDFAnnot_AddInkStroke(annot, p, pagePts.length)
      })
    } finally {
      m.FPDFPage_CloseAnnot(annot)
    }
  })
}

/** A sticky note: a small icon with a comment attached. */
export function addNote(doc: PdfDocument, pageIndex: number, at: [number, number], text: string, color: RGBA = [255, 214, 0, 255]) {
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const [x, y] = space.toPage(at[0], at[1])
    const annot = newAnnot(m, page, ANNOT.text)
    try {
      setRect(m, annot, { left: x, right: x + 20, top: y, bottom: y - 20 })
      setColor(m, annot, 0, color)
      setString(m, annot, 'Contents', text)
      setString(m, annot, 'T', 'Acrohat')
    } finally {
      m.FPDFPage_CloseAnnot(annot)
    }
  })
}

export interface AnnotInfo {
  index: number
  subtype: number
  rect: DRect
  contents: string
}

export function listAnnotations(doc: PdfDocument, pageIndex: number): AnnotInfo[] {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const out: AnnotInfo[] = []
    const n = m.FPDFPage_GetAnnotCount(page)
    for (let i = 0; i < n; i++) {
      const a = m.FPDFPage_GetAnnot(page, i)
      try {
        const subtype = m.FPDFAnnot_GetSubtype(a)
        if (subtype === 16 /* popup */ || subtype === 2 /* link */) continue
        const rect = withBuf(m, 16, (p) => {
          m.FPDFAnnot_GetRect(a, p)
          const [l, t, r, b] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
          return space.rectToDevice(l, b, r, t)
        })
        const contents = withBuf(m, 2048, (buf) => {
          m.FPDFAnnot_GetStringValue(a, 'Contents', buf, 2048)
          const u16 = new Uint16Array(heap(m).buffer.slice(buf, buf + 2046))
          let end = u16.indexOf(0)
          if (end < 0) end = u16.length
          return String.fromCharCode(...u16.subarray(0, end))
        })
        out.push({ index: i, subtype, rect, contents })
      } finally {
        m.FPDFPage_CloseAnnot(a)
      }
    }
    return out
  })
}

export function removeAnnotation(doc: PdfDocument, pageIndex: number, index: number) {
  doc.withPage(pageIndex, (page) => {
    if (!doc.m.FPDFPage_RemoveAnnot(page, index)) throw new PdfError('Could not remove the annotation')
  })
}

/**
 * Permanently redacts a device-space rectangle: every text object touching it is deleted from the
 * page content (not merely covered), images touching it are removed, and a black box is drawn.
 */
export function redact(doc: PdfDocument, pageIndex: number, r: DRect): { removed: number } {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const pr = space.rectToPage(r)
    let removed = 0
    for (let i = m.FPDFPage_CountObjects(page) - 1; i >= 0; i--) {
      const obj = m.FPDFPage_GetObject(page, i)
      const type = m.FPDFPageObj_GetType(obj)
      if (type !== OBJ_TEXT && type !== 3) continue
      const hit = withBuf(m, 16, (p) => {
        m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
        const [l, b, rr, t] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
        return l < pr.right && rr > pr.left && b < pr.top && t > pr.bottom
      })
      if (hit) {
        m.FPDFPage_RemoveObject(page, obj)
        m.FPDFPageObj_Destroy(obj)
        removed++
      }
    }
    // Annotations under the box (comments, highlights) are removed too.
    for (let i = m.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) {
      const a = m.FPDFPage_GetAnnot(page, i)
      const hit = withBuf(m, 16, (p) => {
        m.FPDFAnnot_GetRect(a, p)
        const [l, t, rr, b] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
        return l < pr.right && rr > pr.left && b < pr.top && t > pr.bottom
      })
      m.FPDFPage_CloseAnnot(a)
      if (hit) {
        m.FPDFPage_RemoveAnnot(page, i)
        removed++
      }
    }
    const box = m.FPDFPageObj_CreateNewRect(pr.left, pr.bottom, pr.right - pr.left, pr.top - pr.bottom)
    m.FPDFPageObj_SetFillColor(box, 0, 0, 0, 255)
    m.FPDFPath_SetDrawMode(box, 1, false)
    m.FPDFPage_InsertObject(page, box)
    if (!m.FPDFPage_GenerateContent(page)) throw new PdfError('Could not write the page content')
    return { removed }
  })
}

/** Places an RGBA image (e.g. a signature) into the page at a device-space rectangle. */
export function addImage(doc: PdfDocument, pageIndex: number, rgba: Uint8ClampedArray, w: number, h: number, r: DRect) {
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const pr = space.rectToPage(r)
    // BGRA, 4 bytes per pixel
    const bmp = m.FPDFBitmap_Create(w, h, 1)
    if (!bmp) throw new PdfError('Out of memory')
    try {
      const buf = m.FPDFBitmap_GetBuffer(bmp)
      const stride = m.FPDFBitmap_GetStride(bmp)
      const heapU8 = heap(m)
      for (let y = 0; y < h; y++) {
        let s = y * w * 4
        let d = buf + y * stride
        for (let x = 0; x < w; x++, s += 4, d += 4) {
          heapU8[d] = rgba[s + 2]
          heapU8[d + 1] = rgba[s + 1]
          heapU8[d + 2] = rgba[s]
          heapU8[d + 3] = rgba[s + 3]
        }
      }
      const img = m.FPDFPageObj_NewImageObj(doc.raw)
      if (!m.FPDFImageObj_SetBitmap(0, 0, img, bmp)) throw new PdfError('Could not place the image')
      // Image objects are drawn into the unit square, so the matrix carries size and position.
      withBuf(m, 24, (p) => {
        heapF32(m).set([pr.right - pr.left, 0, 0, pr.top - pr.bottom, pr.left, pr.bottom], p >> 2)
        m.FPDFPageObj_SetMatrix(img, p)
      })
      m.FPDFPage_InsertObject(page, img)
      if (!m.FPDFPage_GenerateContent(page)) throw new PdfError('Could not write the page content')
    } finally {
      m.FPDFBitmap_Destroy(bmp)
    }
  })
}

/** Adds new text at a device-space point using a bundled font. */
export function addText(doc: PdfDocument, pageIndex: number, at: [number, number], text: string, fontData: Uint8Array, fontKey: string, size: number, color: RGBA) {
  const m = doc.m
  doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const [x, y] = space.toPage(at[0], at[1])
    const fp = alloc(m, fontData.length)
    heap(m).set(fontData, fp)
    const font = m.FPDFText_LoadFont(doc.raw, fp, fontData.length, 2, true)
    free(m, fp)
    if (!font) throw new PdfError(`Could not load font ${fontKey}`)
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (!line) return
      const obj = m.FPDFPageObj_CreateTextObj(doc.raw, font, size)
      const u = writeUtf16(m, line)
      m.FPDFText_SetText(obj, u)
      free(m, u)
      withBuf(m, 24, (p) => {
        heapF32(m).set([1, 0, 0, 1, x, y - i * size * 1.2], p >> 2)
        m.FPDFPageObj_SetMatrix(obj, p)
      })
      m.FPDFPageObj_SetFillColor(obj, color[0], color[1], color[2], color[3])
      m.FPDFPage_InsertObject(page, obj)
    })
    if (!m.FPDFPage_GenerateContent(page)) throw new PdfError('Could not write the page content')
  })
}
