import { heapF32, PdfError, withBuf } from './core'
import type { PdfDocument } from './document'
import { addImage } from './annotate'
import { makeSpace } from './search'
import type { DRect } from './space'

const OBJ_IMAGE = 3

export interface ImageObj {
  /** Index in the page's content list; valid until the page changes. */
  index: number
  rect: DRect
  /** True if the image is rotated or skewed, which the move/resize tools can't preserve. */
  transformed: boolean
}

export function listImages(doc: PdfDocument, pageIndex: number): ImageObj[] {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const out: ImageObj[] = []
    const n = m.FPDFPage_CountObjects(page)
    for (let i = 0; i < n; i++) {
      const obj = m.FPDFPage_GetObject(page, i)
      if (m.FPDFPageObj_GetType(obj) !== OBJ_IMAGE) continue
      const [rect, transformed] = withBuf(m, 24 + 16, (p) => {
        m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
        const [l, b, r, t] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
        m.FPDFPageObj_GetMatrix(obj, p + 16)
        const [, mb, mc] = Array.from(heapF32(m).subarray((p + 16) >> 2, (p + 16 + 24) >> 2))
        return [space.rectToDevice(l, b, r, t), Math.abs(mb) > 1e-3 || Math.abs(mc) > 1e-3] as const
      })
      out.push({ index: i, rect, transformed })
    }
    return out
  })
}

function withImage<T>(doc: PdfDocument, pageIndex: number, index: number, fn: (page: number, obj: number) => T): T {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const obj = m.FPDFPage_GetObject(page, index)
    if (!obj || m.FPDFPageObj_GetType(obj) !== OBJ_IMAGE) throw new PdfError('The page changed; select the image again')
    const out = fn(page, obj)
    if (!m.FPDFPage_GenerateContent(page)) throw new PdfError('Could not write the page content')
    return out
  })
}

export function deleteImage(doc: PdfDocument, pageIndex: number, index: number) {
  const m = doc.m
  withImage(doc, pageIndex, index, (page, obj) => {
    m.FPDFPage_RemoveObject(page, obj)
    m.FPDFPageObj_Destroy(obj)
  })
}

/** Moves/resizes an image to a new device-space rectangle. */
export function placeImage(doc: PdfDocument, pageIndex: number, index: number, r: DRect) {
  if (r.w < 4 || r.h < 4) throw new PdfError('The image would be too small')
  const m = doc.m
  const cur = listImages(doc, pageIndex).find((i) => i.index === index)
  if (cur?.transformed) throw new PdfError('Rotated images can be deleted or replaced, but not resized')
  withImage(doc, pageIndex, index, (page, obj) => {
    const pr = makeSpace(doc, page, pageIndex).rectToPage(r)
    withBuf(m, 24, (p) => {
      heapF32(m).set([pr.right - pr.left, 0, 0, pr.top - pr.bottom, pr.left, pr.bottom], p >> 2)
      m.FPDFPageObj_SetMatrix(obj, p)
    })
  })
}

/** Swaps an image for new pixels, keeping its rectangle. */
export function replaceImage(doc: PdfDocument, pageIndex: number, index: number, rgba: Uint8ClampedArray, w: number, h: number) {
  const cur = listImages(doc, pageIndex).find((i) => i.index === index)
  if (!cur) throw new PdfError('The page changed; select the image again')
  addImage(doc, pageIndex, rgba, w, h, cur.rect)
  deleteImage(doc, pageIndex, index)
}
