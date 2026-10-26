import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { loadPdfium } from '../src/engine/core'

export async function pdfium() {
  const buf = readFileSync('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')
  return loadPdfium(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
}

export function fontBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`public/fonts/${name}`))
}

/** A one-page PDF with a two-line paragraph and a heading, built with pdf-lib. */
export async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 300])
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  page.drawText('Quarterly Report', { x: 40, y: 250, size: 20, font: bold, color: rgb(0, 0, 0) })
  page.drawText('Revenue grew by ten percent this', { x: 40, y: 220, size: 12, font: helv, color: rgb(0.1, 0.1, 0.1) })
  page.drawText('quarter compared with last year.', { x: 40, y: 205, size: 12, font: helv, color: rgb(0.1, 0.1, 0.1) })
  return doc.save()
}
