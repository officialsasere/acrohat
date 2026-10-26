import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium'

export type Pdfium = WrappedPdfiumModule

let instance: Promise<Pdfium> | null = null

/** Loads PDFium once. `wasmBinary` is the raw pdfium.wasm (worker fetches it, tests read it from disk). */
export function loadPdfium(wasmBinary: ArrayBuffer): Promise<Pdfium> {
  instance ??= init({ wasmBinary }).then((m) => {
    m.FPDF_InitLibrary()
    return m
  })
  return instance
}

export function alloc(m: Pdfium, size: number): number {
  return m.pdfium.wasmExports.malloc(size)
}

export function free(m: Pdfium, ptr: number) {
  if (ptr) m.pdfium.wasmExports.free(ptr)
}

export function heap(m: Pdfium): Uint8Array {
  // HEAPU8 is re-created when wasm memory grows, so always read it fresh.
  return (m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8
}

export function heapF32(m: Pdfium): Float32Array {
  return (m.pdfium as unknown as { HEAPF32: Float32Array }).HEAPF32
}

export function heapU32(m: Pdfium): Uint32Array {
  return (m.pdfium as unknown as { HEAPU32: Uint32Array }).HEAPU32
}

/** Runs `fn` with a scratch buffer of `size` bytes that is freed afterwards. */
export function withBuf<T>(m: Pdfium, size: number, fn: (ptr: number) => T): T {
  const ptr = alloc(m, size)
  try {
    return fn(ptr)
  } finally {
    free(m, ptr)
  }
}

export function readFloats(m: Pdfium, ptr: number, n: number): number[] {
  const f = heapF32(m)
  return Array.from(f.subarray(ptr >> 2, (ptr >> 2) + n))
}

/** Reads a UTF-16LE string out of a buffer of `byteLen` bytes (PDFium convention), trimming the NUL. */
export function readUtf16(m: Pdfium, ptr: number, byteLen: number): string {
  const bytes = heap(m).subarray(ptr, ptr + byteLen)
  const view = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (byteLen & ~1)))
  let end = view.length
  while (end > 0 && view[end - 1] === 0) end--
  return String.fromCharCode(...view.subarray(0, end))
}

export function writeUtf16(m: Pdfium, s: string): number {
  const ptr = alloc(m, (s.length + 1) * 2)
  const u16 = new Uint16Array(heap(m).buffer, ptr, s.length + 1)
  for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i)
  u16[s.length] = 0
  return ptr
}

export class PdfError extends Error {}

const ERRORS: Record<number, string> = {
  1: 'Unknown error',
  2: 'File not found or could not be opened',
  3: 'File is not a valid PDF or is corrupted',
  4: 'Password required or incorrect password',
  5: 'Unsupported security scheme',
  6: 'Page not found or content error',
}

export function lastError(m: Pdfium): string {
  return ERRORS[m.FPDF_GetLastError()] ?? 'Unknown error'
}
