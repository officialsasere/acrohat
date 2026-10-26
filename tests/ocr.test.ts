import { beforeAll, describe, expect, it } from 'vitest'
import { createWorker } from 'tesseract.js'
import { writeFileSync } from 'node:fs'
import { PdfDocument } from '../src/engine/document'
import { addOcrLayer } from '../src/engine/ocr'
import { coverage } from '../src/engine/fonts'
import { addImage } from '../src/engine/annotate'
import { extractBlocks } from '../src/engine/text'
import { searchPage } from '../src/engine/search'
import { wordsOf } from '../src/lib/ocr'
import { fontBytes, pdfium, samplePdf } from './helpers'

let m: Awaited<ReturnType<typeof pdfium>>
beforeAll(async () => {
  m = await pdfium()
})

/** Renders a text PDF to pixels and wraps those pixels in an image-only PDF, i.e. a "scan". */
async function scanOf(bytes: Uint8Array) {
  const src = PdfDocument.open(m, bytes)
  const scale = 3
  const img = src.renderPage(0, scale)
  src.close()
  const doc = PdfDocument.create(m)
  m.FPDFPage_New(doc.raw, 0, 400, 300)
  addImage(doc, 0, img.data, img.width, img.height, { x: 0, y: 0, w: 400, h: 300 })
  return { scan: doc, scale, img }
}

describe('OCR', () => {
  it('turns a scanned page into searchable, editable text', async () => {
    const { scan, scale, img } = await scanOf(await samplePdf())
    expect(extractBlocks(scan, 0)).toHaveLength(0) // truly image-only
    writeFileSync('tests/fixtures/scanned.pdf', scan.save()) // reused by the browser OCR test

    const worker = await createWorker('eng', 1, {
      langPath: new URL('../node_modules/@tesseract.js-data/eng/4.0.0_best_int', import.meta.url).pathname,
      gzip: true,
      cachePath: '/tmp/acrohat-tess-cache',
    })
    // tesseract.js accepts raw encoded images; hand it a PNG made from the RGBA pixels.
    const { PNG } = await import('pngjs')
    const png = new PNG({ width: img.width, height: img.height })
    png.data = Buffer.from(img.data)
    const { data } = await worker.recognize(PNG.sync.write(png), {}, { blocks: true })
    await worker.terminate()

    const words = wordsOf(data as never).map((w) => ({ text: w.text, x: w.x / scale, y: w.y / scale, w: w.w / scale, h: w.h / scale }))
    expect(words.length).toBeGreaterThan(8)

    const font = fontBytes('LiberationSans-Regular.ttf')
    const added = addOcrLayer(scan, 0, words, font, coverage(font))
    expect(added).toBeGreaterThan(8)

    const reopened = PdfDocument.open(m, scan.save())
    expect(searchPage(reopened, 0, 'Revenue')).toHaveLength(1)
    const hit = searchPage(reopened, 0, 'Revenue')[0].rects[0]
    expect(hit.x).toBeGreaterThan(30)
    expect(hit.x).toBeLessThan(60) // lands over the scanned word (x≈40pt)
    expect(hit.y).toBeGreaterThan(60)
    expect(hit.y).toBeLessThan(110)
    expect(extractBlocks(reopened, 0).map((b) => b.text).join(' ')).toMatch(/Quarterly/i)
    // The invisible layer must not change what the page looks like.
    const after = reopened.renderPage(0, scale)
    let diff = 0
    for (let i = 0; i < after.data.length; i += 4) if (Math.abs(after.data[i] - img.data[i]) > 8) diff++
    expect(diff).toBe(0)
    reopened.close()
    scan.close()
  }, 120_000)
})
