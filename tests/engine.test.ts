import { beforeAll, describe, expect, it } from 'vitest'
import { PdfDocument } from '../src/engine/document'
import { extractBlocks } from '../src/engine/text'
import { editBlock, OverflowError, pageText, UnsupportedCharactersError } from '../src/engine/edit'
import { fontBytes, pdfium, samplePdf } from './helpers'

const loadFont = async (f: string) => fontBytes(f)
let m: Awaited<ReturnType<typeof pdfium>>
beforeAll(async () => {
  m = await pdfium()
})

describe('document', () => {
  it('opens, counts pages, renders and saves', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    expect(doc.pageCount).toBe(1)
    expect(doc.pageSize(0)).toEqual({ width: 400, height: 300 })
    const img = doc.renderPage(0, 1)
    expect(img.width).toBe(400)
    expect([...img.data].some((v, i) => i % 4 === 0 && v < 100)).toBe(true) // some dark pixels
    const saved = doc.save()
    expect(new TextDecoder().decode(saved.slice(0, 5))).toBe('%PDF-')
    doc.close()
  })

  it('rejects garbage', () => {
    expect(() => PdfDocument.open(m, new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('text extraction', () => {
  it('finds a heading and a two-line paragraph', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const blocks = extractBlocks(doc, 0)
    expect(blocks.map((b) => b.text)).toEqual([
      'Quarterly Report',
      'Revenue grew by ten percent this quarter compared with last year.',
    ])
    expect(blocks[1].lines).toHaveLength(2)
    doc.close()
  })
})

describe('text editing', () => {
  it('edits one word and leaves the rest intact', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const [, para] = extractBlocks(doc, 0)
    await editBlock(doc, para, para.text.replace('ten', 'twelve'), { loadFont, maxRight: 364 })
    const reopened = PdfDocument.open(m, doc.save())
    const texts = pageText(reopened, 0).join(' | ')
    expect(texts).toContain('Quarterly Report')
    expect(texts.replace(/ \| /g, ' ')).toContain('twelve')
    reopened.close()
    doc.close()
  })

  it('substitutes a font for characters the original cannot draw', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const [head] = extractBlocks(doc, 0)
    const res = await editBlock(doc, head, 'Quarterly Report ★ Żółć', { loadFont, maxRight: 364 })
    expect(res.fontSubstituted).toBe(true)
    const reopened = PdfDocument.open(m, doc.save())
    const text = pageText(reopened, 0).join(' ')
    expect(text).toContain('Żółć')
    reopened.close()
    doc.close()
  })
})

describe('unsupported characters', () => {
  it('refuses text no bundled font can draw instead of writing tofu', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const [head] = extractBlocks(doc, 0)
    await expect(editBlock(doc, head, 'Report 漢字', { loadFont })).rejects.toBeInstanceOf(UnsupportedCharactersError)
    doc.close()
  })
})

describe('style-preserving edits', () => {
  async function mixedPdf() {
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([400, 300])
    const reg = await pdf.embedFont(StandardFonts.TimesRoman)
    const bold = await pdf.embedFont(StandardFonts.TimesRomanBold)
    const ital = await pdf.embedFont(StandardFonts.TimesRomanItalic)
    // One paragraph of two lines, with a bold word and an italic word, left-aligned at x=40.
    const seg = (y: number, parts: [string, typeof reg][]) => {
      let x = 40
      for (const [t, f] of parts) {
        page.drawText(t, { x, y, size: 12, font: f, color: rgb(0, 0, 0) })
        x += f.widthOfTextAtSize(t, 12)
      }
    }
    seg(220, [['The quick ', reg], ['brown', bold], [' fox jumps over the ', reg], ['lazy', ital], [' dog and', reg]])
    seg(205, [['keeps running through the green forest.', reg]])
    return pdf.save()
  }
  const faces = (runs: { text: string; bold: boolean; italic: boolean }[], word: string) => runs.find((r) => r.text.includes(word))

  it('keeps bold and italic words bold and italic after typing into the paragraph', async () => {
    const doc = PdfDocument.open(m, await mixedPdf())
    const [block] = extractBlocks(doc, 0)
    expect(block.lines).toHaveLength(2)
    await editBlock(doc, block, block.text.replace('forest.', 'forest, and then it rests.'), { loadFont, maxRight: 364 })
    const re = PdfDocument.open(m, doc.save())
    const [after] = extractBlocks(re, 0)
    expect(after.text).toContain('rests.')
    expect(faces(after.runs, 'brown')).toMatchObject({ bold: true })
    expect(faces(after.runs, 'lazy')).toMatchObject({ italic: true })
    expect(faces(after.runs, 'quick')).toMatchObject({ bold: false, italic: false })
    expect(faces(after.runs, 'rests')).toMatchObject({ bold: false, italic: false }) // new text takes its neighbour's style
    re.close()
    doc.close()
  })

  it('re-flows across the styled words when you edit before them', async () => {
    const doc = PdfDocument.open(m, await mixedPdf())
    const [block] = extractBlocks(doc, 0)
    await editBlock(doc, block, block.text.replace('The quick', 'The very, very quick'), { loadFont, maxRight: 364 })
    const re = PdfDocument.open(m, doc.save())
    const [after] = extractBlocks(re, 0)
    expect(after.text).toContain('The very, very quick brown fox jumps over the lazy dog and keeps running')
    expect(faces(after.runs, 'brown')).toMatchObject({ bold: true })
    expect(faces(after.runs, 'lazy')).toMatchObject({ italic: true })
    // Every word stays inside the original column.
    expect(after.bbox.right).toBeLessThanOrEqual(block.bbox.right + 2)
    re.close()
    doc.close()
  })

  it('does not restyle anything when the edit is typed into a bold word', async () => {
    const doc = PdfDocument.open(m, await mixedPdf())
    const [block] = extractBlocks(doc, 0)
    await editBlock(doc, block, block.text.replace('brown', 'browner'), { loadFont, maxRight: 364 })
    const re = PdfDocument.open(m, doc.save())
    const [after] = extractBlocks(re, 0)
    expect(faces(after.runs, 'browner')).toMatchObject({ bold: true })
    expect(faces(after.runs, 'quick')).toMatchObject({ bold: false })
    re.close()
    doc.close()
  })
})

describe('paragraph growth', () => {
  /** Two stacked paragraphs with a tight gap, and a footer far below. */
  async function stacked(footerY = 40, lift = 0) {
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([300, 300])
    const f = await pdf.embedFont(StandardFonts.Helvetica)
    const para = (y: number, lines: string[]) => lines.forEach((t, i) => page.drawText(t, { x: 30, y: y - i * 14, size: 11, font: f }))
    para(260 - lift, ['First paragraph line one here', 'and a second line of it.'])
    para(218 - lift, ['Second paragraph starts here and', 'also has two lines of text.'])
    page.drawText('Page 1 footer', { x: 100, y: footerY, size: 9, font: f })
    return pdf.save()
  }
  const grow = (t: string) => t + ' It now has quite a lot more words so that it must wrap onto a third line.'
  const topOf = (doc: PdfDocument, start: string) => extractBlocks(doc, 0).find((b) => b.text.startsWith(start))!.bbox.top

  it('refuses by default when the paragraph would run into the one below, and changes nothing', async () => {
    const doc = PdfDocument.open(m, await stacked())
    const [first, second] = extractBlocks(doc, 0).sort((a, b) => b.bbox.top - a.bbox.top)
    expect(second.text).toMatch(/^Second/)
    const before = Buffer.from(doc.save())
    const err = await editBlock(doc, first, grow(first.text), { loadFont, maxRight: 270 }).catch((e) => e)
    expect(err).toBeInstanceOf(OverflowError)
    expect(err.extraLines).toBeGreaterThanOrEqual(1)
    expect(err.collidesWith).toContain('Second paragraph')
    expect(err.canPush).toBe(true)
    expect(Buffer.from(doc.save()).equals(before)).toBe(true) // untouched
    doc.close()
  })

  it('pushes the content below down when asked, leaving the far footer where it is', async () => {
    const doc = PdfDocument.open(m, await stacked())
    const [first] = extractBlocks(doc, 0).sort((a, b) => b.bbox.top - a.bbox.top)
    const secondTop = topOf(doc, 'Second')
    const footerTop = topOf(doc, 'Page 1')
    await editBlock(doc, first, grow(first.text), { loadFont, maxRight: 270, overflow: 'push' })
    const re = PdfDocument.open(m, doc.save())
    const blocks = extractBlocks(re, 0).sort((a, b) => b.bbox.top - a.bbox.top)
    const [p1, p2] = blocks
    expect(p1.lines.length).toBeGreaterThanOrEqual(3)
    expect(topOf(re, 'Second')).toBeLessThan(secondTop - 10) // moved down by about a line
    expect(topOf(re, 'Page 1')).toBeCloseTo(footerTop, 1) // footer untouched
    expect(p1.bbox.bottom).toBeGreaterThan(p2.bbox.top - 1) // no overlap between the two paragraphs
    expect(p2.text).toBe('Second paragraph starts here and also has two lines of text.')
    re.close()
    doc.close()
  })

  it('refuses to push when there is no room before the next content', async () => {
    // Everything sits at the bottom of the page: the stack under the first paragraph already touches the margin.
    const doc = PdfDocument.open(m, await stacked(26, 180))
    const [first] = extractBlocks(doc, 0).sort((a, b) => b.bbox.top - a.bbox.top)
    const err = await editBlock(doc, first, grow(first.text), { loadFont, maxRight: 270, overflow: 'push' }).catch((e) => e)
    expect(err).toBeInstanceOf(OverflowError)
    expect(err.canPush).toBe(false)
    doc.close()
  })

  it('lets the user overlap on purpose', async () => {
    const doc = PdfDocument.open(m, await stacked())
    const [first] = extractBlocks(doc, 0).sort((a, b) => b.bbox.top - a.bbox.top)
    const secondTop = topOf(doc, 'Second')
    await editBlock(doc, first, grow(first.text), { loadFont, maxRight: 270, overflow: 'overlap' })
    expect(topOf(doc, 'Second')).toBeCloseTo(secondTop, 1)
    doc.close()
  })

  it('does not interfere when the paragraph stays the same size or shrinks', async () => {
    const doc = PdfDocument.open(m, await stacked())
    const [first] = extractBlocks(doc, 0).sort((a, b) => b.bbox.top - a.bbox.top)
    await editBlock(doc, first, first.text.replace('one here', 'ONE'), { loadFont, maxRight: 270 })
    doc.close()
  })
})
