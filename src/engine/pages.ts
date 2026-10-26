import { alloc, free, heap, PdfError } from './core'
import { PdfDocument } from './document'

/** Page-level operations. Indices are zero-based. */

export function deletePages(doc: PdfDocument, indices: number[]) {
  const unique = [...new Set(indices)].sort((a, b) => b - a)
  if (unique.length >= doc.pageCount) throw new PdfError('A PDF must keep at least one page')
  for (const i of unique) doc.m.FPDFPage_Delete(doc.raw, i)
}

export function rotatePages(doc: PdfDocument, indices: number[], degrees: 90 | 180 | 270) {
  for (const i of indices) {
    doc.withPage(i, (page) => {
      const cur = doc.m.FPDFPage_GetRotation(page)
      doc.m.FPDFPage_SetRotation(page, (cur + degrees / 90) % 4)
    })
  }
}

/** Moves the given pages so they start at `dest` (index in the document after the move). */
export function movePages(doc: PdfDocument, indices: number[], dest: number) {
  const m = doc.m
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const ptr = alloc(m, sorted.length * 4)
  new DataView(heap(m).buffer).setInt32(ptr, 0, true)
  const dv = new DataView(heap(m).buffer)
  sorted.forEach((v, i) => dv.setInt32(ptr + i * 4, v, true))
  const ok = m.FPDF_MovePages(doc.raw, ptr, sorted.length, dest)
  free(m, ptr)
  if (!ok) throw new PdfError('Could not reorder pages')
}

function rangeString(indices: number[]): string {
  return indices.map((i) => i + 1).join(',')
}

/** Copies pages from `src` into `dest` at position `at`. With no `pages`, copies all of them. */
export function importPages(dest: PdfDocument, src: PdfDocument, at: number, pages?: number[]) {
  const ok = dest.m.FPDF_ImportPages(dest.raw, src.raw, pages ? rangeString(pages) : '', at)
  if (!ok) throw new PdfError('Could not import pages')
}

/** Builds a new PDF holding only the given pages of `doc`. */
export function extractPages(doc: PdfDocument, pages: number[]): Uint8Array {
  const out = PdfDocument.create(doc.m)
  try {
    importPages(out, doc, 0, pages)
    return out.save()
  } finally {
    out.close()
  }
}

/** Parses "1-3, 5, 8-" style ranges into zero-based indices (1-based input, `total` pages). */
export function parseRanges(input: string, total: number): number[] {
  const out: number[] = []
  for (const part of input.split(',').map((s) => s.trim()).filter(Boolean)) {
    const mt = /^(\d*)\s*-\s*(\d*)$/.exec(part)
    if (mt) {
      const from = mt[1] ? Number(mt[1]) : 1
      const to = mt[2] ? Number(mt[2]) : total
      if (from < 1 || to > total || from > to) throw new PdfError(`Invalid range "${part}" (document has ${total} pages)`)
      for (let i = from; i <= to; i++) out.push(i - 1)
    } else if (/^\d+$/.test(part)) {
      const n = Number(part)
      if (n < 1 || n > total) throw new PdfError(`Page ${n} does not exist (document has ${total} pages)`)
      out.push(n - 1)
    } else {
      throw new PdfError(`Cannot understand "${part}"`)
    }
  }
  return out
}
