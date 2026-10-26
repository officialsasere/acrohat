import { alloc, free, heap, heapF32, writeUtf16, withBuf, PdfError } from './core'
import type { PdfDocument } from './document'
import { makeSpace } from './search'

export interface OcrWord {
  text: string
  /** Device points, top-left origin. */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Adds recognized words as an invisible text layer (render mode 3) so a scanned page becomes
 * searchable, selectable and editable. Each word is scaled horizontally to cover its scanned box.
 */
export function addOcrLayer(doc: PdfDocument, pageIndex: number, words: OcrWord[], fontData: Uint8Array, covered: (cp: number) => boolean): number {
  const m = doc.m
  return doc.withPage(pageIndex, (page) => {
    const space = makeSpace(doc, page, pageIndex)
    const fp = alloc(m, fontData.length)
    heap(m).set(fontData, fp)
    const font = m.FPDFText_LoadFont(doc.raw, fp, fontData.length, 2, true)
    free(m, fp)
    if (!font) throw new PdfError('Could not load the OCR font')
    let added = 0
    for (const word of words) {
      const text = [...word.text].filter((c) => covered(c.codePointAt(0)!)).join('')
      if (!text || word.w <= 0 || word.h <= 0) continue
      const size = word.h * 0.8
      const obj = m.FPDFPageObj_CreateTextObj(doc.raw, font, size)
      const u = writeUtf16(m, text)
      m.FPDFText_SetText(obj, u)
      free(m, u)
      const natural = withBuf(m, 16, (p) => {
        m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
        const [l, , r] = Array.from(heapF32(m).subarray(p >> 2, (p >> 2) + 4))
        return r - l
      })
      const sx = natural > 0 ? word.w / natural : 1
      // Baseline sits roughly 20% of the box height above its bottom edge.
      const [px, py] = space.toPage(word.x, word.y + word.h * 0.8)
      withBuf(m, 24, (p) => {
        heapF32(m).set([sx, 0, 0, 1, px, py], p >> 2)
        m.FPDFPageObj_SetMatrix(obj, p)
      })
      m.FPDFTextObj_SetTextRenderMode(obj, 3)
      m.FPDFPage_InsertObject(page, obj)
      added++
    }
    if (!m.FPDFPage_GenerateContent(page)) throw new PdfError('Could not write the page content')
    return added
  })
}
