import { PDFDocument } from 'pdf-lib'
import type { Deck } from '../model'

/** A PDF with one page per slide (hidden slides left out). Each page holds a picture of the slide; for a PDF with selectable text use Print → Save as PDF. */
export async function writePdf(deck: Deck): Promise<Uint8Array> {
  const { renderAllPng } = await import('../lib/raster')
  const pngs = await renderAllPng(deck, Math.min(2400, Math.round(deck.w * 2.5)), true)
  const pdf = await PDFDocument.create()
  pdf.setTitle(deck.title); pdf.setProducer('Kwiiva Present'); pdf.setCreator('Kwiiva Present')
  for (let i = 0; i < pngs.length; i++) {
    const img = await pdf.embedPng(pngs[i])
    const page = pdf.addPage([deck.w, deck.h])
    page.drawImage(img, { x: 0, y: 0, width: deck.w, height: deck.h })
  }
  return pdf.save()
}
