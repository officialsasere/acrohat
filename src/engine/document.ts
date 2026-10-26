import { alloc, free, heap, lastError, PdfError, type Pdfium } from './core'

const FPDF_ANNOT = 0x01
const FPDF_LCD_TEXT = 0x02

export interface RenderedPage {
  width: number
  height: number
  /** RGBA, row-major. */
  data: Uint8ClampedArray<ArrayBuffer>
}

export interface PageSize {
  width: number
  height: number
}

/** An open PDF document. Owns its WASM memory; call `close()` when done. */
export class PdfDocument {
  private dataPtr: number
  private handle: number
  private closed = false
  private form = 0
  private formInfo = 0

  private constructor(
    readonly m: Pdfium,
    handle: number,
    dataPtr: number,
  ) {
    this.handle = handle
    this.dataPtr = dataPtr
  }

  static open(m: Pdfium, bytes: Uint8Array, password = ''): PdfDocument {
    const ptr = alloc(m, bytes.length)
    heap(m).set(bytes, ptr)
    const handle = m.FPDF_LoadMemDocument(ptr, bytes.length, password)
    if (!handle) {
      const err = lastError(m)
      free(m, ptr)
      throw new PdfError(err)
    }
    return new PdfDocument(m, handle, ptr)
  }

  static create(m: Pdfium): PdfDocument {
    const handle = m.FPDF_CreateNewDocument()
    if (!handle) throw new PdfError('Could not create document')
    return new PdfDocument(m, handle, 0)
  }

  /** Form-fill environment, needed so PDFium paints form widgets (they are skipped by plain rendering). */
  private ensureForm(): number {
    if (this.form) return this.form
    const m = this.m
    // FPDF_FORMFILLINFO, version 1: every callback left null (PDFium checks before calling).
    this.formInfo = alloc(m, 128)
    heap(m).fill(0, this.formInfo, this.formInfo + 128)
    new DataView(heap(m).buffer).setInt32(this.formInfo, 1, true)
    this.form = m.FPDFDOC_InitFormFillEnvironment(this.raw, this.formInfo)
    if (this.form) m.FPDF_SetFormFieldHighlightAlpha(this.form, 0)
    return this.form
  }

  get raw(): number {
    this.assertOpen()
    return this.handle
  }

  get pageCount(): number {
    return this.m.FPDF_GetPageCount(this.raw)
  }

  pageSize(index: number): PageSize {
    return this.withPage(index, (page) => ({
      width: this.m.FPDF_GetPageWidthF(page),
      height: this.m.FPDF_GetPageHeightF(page),
    }))
  }

  /** Opens a page, runs `fn`, and always closes the page again. */
  withPage<T>(index: number, fn: (page: number) => T): T {
    const page = this.m.FPDF_LoadPage(this.raw, index)
    if (!page) throw new PdfError(`Cannot load page ${index + 1}: ${lastError(this.m)}`)
    try {
      return fn(page)
    } finally {
      this.m.FPDF_ClosePage(page)
    }
  }

  /** Renders a page to RGBA pixels at the given scale (1 = 72 dpi). */
  renderPage(index: number, scale: number, opts: { annotations?: boolean } = {}): RenderedPage {
    const { width, height } = this.pageSize(index)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    return this.withPage(index, (page) => {
      const m = this.m
      const bitmap = m.FPDFBitmap_Create(w, h, 0)
      if (!bitmap) throw new PdfError('Out of memory while rendering')
      try {
        m.FPDFBitmap_FillRect(bitmap, 0, 0, w, h, 0xffffffff)
        const flags = (opts.annotations === false ? 0 : FPDF_ANNOT) | FPDF_LCD_TEXT
        m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, w, h, 0, flags)
        const form = opts.annotations === false ? 0 : this.ensureForm()
        if (form) {
          m.FORM_OnAfterLoadPage(page, form)
          m.FPDF_FFLDraw(form, bitmap, page, 0, 0, w, h, 0, flags)
          m.FORM_OnBeforeClosePage(page, form)
        }
        const buf = m.FPDFBitmap_GetBuffer(bitmap)
        const stride = m.FPDFBitmap_GetStride(bitmap)
        const src = heap(m).subarray(buf, buf + stride * h)
        const out = new Uint8ClampedArray(w * h * 4)
        for (let y = 0; y < h; y++) {
          let s = y * stride
          let d = y * w * 4
          for (let x = 0; x < w; x++, s += 4, d += 4) {
            out[d] = src[s + 2] // BGRA -> RGBA
            out[d + 1] = src[s + 1]
            out[d + 2] = src[s]
            out[d + 3] = 255
          }
        }
        return { width: w, height: h, data: out }
      } finally {
        m.FPDFBitmap_Destroy(bitmap)
      }
    })
  }

  /** Serializes the document to PDF bytes. */
  save(): Uint8Array {
    const m = this.m
    const chunks: Uint8Array[] = []
    // FPDF_FILEWRITE { int version; int (*WriteBlock)(FPDF_FILEWRITE*, const void*, unsigned long); }
    const writeBlock = m.pdfium.addFunction((_self: number, data: number, size: number) => {
      chunks.push(heap(m).slice(data, data + size))
      return 1
    }, 'iiii')
    const struct = alloc(m, 8)
    const view = new DataView(heap(m).buffer, struct, 8)
    view.setInt32(0, 1, true)
    view.setInt32(4, writeBlock, true)
    try {
      const ok = m.FPDF_SaveAsCopy(this.raw, struct, 0)
      if (!ok) throw new PdfError('Failed to save the document')
    } finally {
      free(m, struct)
      m.pdfium.removeFunction(writeBlock)
    }
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.length
    }
    return out
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.form) {
      this.m.FPDFDOC_ExitFormFillEnvironment(this.form)
      free(this.m, this.formInfo)
    }
    this.m.FPDF_CloseDocument(this.handle)
    free(this.m, this.dataPtr)
  }

  private assertOpen() {
    if (this.closed) throw new PdfError('Document is closed')
  }
}
