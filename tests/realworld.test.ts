import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { PdfDocument } from '../src/engine/document'
import { extractBlocks } from '../src/engine/text'
import { editBlock } from '../src/engine/edit'
import { buildDocx } from '../src/engine/docx'
import { embedFonts, makePdfA, checkPdfA } from '../src/engine/pdfa'
import { signWithCertificate } from '../src/engine/sign'
import { verifySignatures } from '../src/engine/verify'
import { markContent, buildStructureTree, checkAccessibility } from '../src/engine/access'
import { optimize } from '../src/engine/qpdf'
import { fontBytes, pdfium } from './helpers'

/**
 * Runs the whole edit → convert → sign pipeline over PDFs that ship with the operating system,
 * i.e. files we did not generate ourselves. Skipped for any file that isn't on this machine.
 * Results are also written to $REALWORLD_REPORT (JSON) when set.
 */
const FILES = [
  '/usr/share/doc/bash/article.pdf',
  '/usr/share/doc/bash/bashref.pdf',
  '/usr/share/doc/bash/rose94.pdf',
  '/System/Library/ProductDocuments/ProductGuides/ENERGY STAR.pdf',
  '/Applications/Xcode.app/Contents/Resources/Acknowledgments.pdf',
  '/Applications/Xcode.app/Contents/Resources/en.lproj/License.pdf',
]

const wasm = new URL('../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm', import.meta.url).pathname
const loadFont = async (f: string) => fontBytes(f)
const results: Record<string, Record<string, string>> = {}

function dark(img: { data: Uint8ClampedArray }) {
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 200) n++
  return n
}

describe.each(FILES.filter(existsSync))('real-world: %s', (file) => {
  it('edits, converts and signs', async () => {
    const r: Record<string, string> = (results[file] = {})
    const step = async (name: string, fn: () => Promise<string | void>) => {
      const t0 = performance.now()
      try {
        r[name] = ((await fn()) || 'ok') + ` (${Math.round(performance.now() - t0)} ms)`
      } catch (e) {
        r[name] = 'FAIL: ' + (e as Error).message.slice(0, 160)
      }
    }
    const m = await pdfium()
    const bytes = new Uint8Array(readFileSync(file))
    let doc!: PdfDocument
    await step('open+render', async () => {
      doc = PdfDocument.open(m, bytes)
      const mid = Math.floor(doc.pageCount / 2)
      const a = doc.renderPage(0, 1)
      const b = doc.renderPage(mid, 1)
      if (!dark(a) && !dark(b)) throw new Error('first and middle pages render blank')
      return `${doc.pageCount} pages`
    })
    expect(doc, `could not open: ${r['open+render']}`).toBeTruthy()

    // Find a text paragraph to edit.
    let pageWithText = -1
    for (let i = 0; i < Math.min(doc.pageCount, 12) && pageWithText < 0; i++) if (extractBlocks(doc, i).some((b) => b.text.length > 40)) pageWithText = i

    await step('extract text', async () => {
      if (pageWithText < 0) return 'no text layer found (image-only or vector)'
      const blocks = extractBlocks(doc, pageWithText)
      return `${blocks.length} blocks on page ${pageWithText + 1}`
    })

    if (pageWithText >= 0) {
      await step('edit paragraph', async () => {
        const blocks = extractBlocks(doc, pageWithText)
        const target = blocks.filter((b) => b.text.length > 40 && b.lines.length <= 12).sort((a, b) => b.text.length - a.text.length)[0] ?? blocks[0]
        const marker = ' EDITED-OK'
        const res = await editBlock(doc, target, target.text.replace(/\s+$/, '') + marker, { loadFont, maxRight: doc.pageSize(pageWithText).width - 36 })
        const re = PdfDocument.open(m, doc.save())
        try {
          const found = extractBlocks(re, pageWithText).map((b) => b.text).join(' ')
          if (!found.includes('EDITED-OK')) throw new Error('edited text not found after save and reopen')
          if (!dark(re.renderPage(pageWithText, 1))) throw new Error('page renders blank after the edit')
          return res.fontSubstituted ? 'ok (substitute font)' : 'ok'
        } finally {
          re.close()
        }
      })
    }

    await step('→ DOCX', async () => {
      const pages = Array.from({ length: Math.min(doc.pageCount, 30) }, (_, i) => extractBlocks(doc, i))
      const out = buildDocx(pages)
      const n = pages.flat().length
      if (out[0] !== 0x50 || out[1] !== 0x4b) throw new Error('not a zip')
      return `${n} paragraphs`
    })
    await step('→ PNG', async () => {
      const img = doc.renderPage(0, 2)
      if (img.width < 100) throw new Error('tiny render')
      return `${img.width}x${img.height}`
    })
    await step('reduce size', async () => {
      const out = await optimize(doc.save(), wasm)
      const re = PdfDocument.open(m, out)
      const same = re.pageCount === doc.pageCount
      re.close()
      if (!same) throw new Error('page count changed')
      return `${Math.round(doc.save().length / 1024)} KB → ${Math.round(out.length / 1024)} KB`
    })

    await step('→ PDF/A', async () => {
      const copy = PdfDocument.open(m, doc.save())
      try {
        const res = await embedFonts(copy, loadFont, { flatten: true })
        const out = await makePdfA(copy.save())
        const rep = await checkPdfA(out.bytes)
        const errs = rep.issues.filter((i) => i.severity === 'error').map((i) => i.message)
        PdfDocument.open(m, out.bytes).close()
        if (errs.length) throw new Error(errs.join(' | '))
        return `passes own checks, ${res.replacedObjects} runs re-set`
      } finally {
        copy.close()
      }
    })

    await step('→ accessible (tagged)', async () => {
      const copy = PdfDocument.open(m, doc.save())
      try {
        const structure = markContent(copy)
        const tagged = await buildStructureTree(copy.save(), structure, { lang: 'en-US', title: 'Test' })
        PdfDocument.open(m, tagged).close()
        const rep = await checkAccessibility(tagged, Array.from({ length: Math.min(copy.pageCount, 30) }, () => true))
        return `${rep.headings} headings, ${rep.paragraphs} paragraphs, ${rep.figures} figures`
      } finally {
        copy.close()
      }
    })

    await step('sign + validate', async () => {
      const p12 = new Uint8Array(readFileSync('tests/fixtures/test-cert.p12'))
      const signed = await signWithCertificate(doc.save(), p12, 'pw', { reason: 'test' })
      const [v] = await verifySignatures(signed)
      if (v?.status !== 'valid' || !v.coversWholeFile) throw new Error(`validation says ${v?.status}`)
      const re = PdfDocument.open(m, signed)
      const pages = re.pageCount
      re.close()
      if (pages !== doc.pageCount) throw new Error('page count changed')
      const t = signed.slice()
      t[7] = t[7] === 0x37 ? 0x36 : 0x37
      if ((await verifySignatures(t))[0]?.status === 'valid') throw new Error('tampering not detected')
      return 'valid; tampering detected'
    })
    doc.close()
    expect(Object.values(r).filter((v) => v.startsWith('FAIL')), JSON.stringify(r, null, 1)).toEqual([])
  }, 300_000)

})

describe('report', () => {
  it('writes the results table', () => {
    if (process.env.REALWORLD_REPORT) writeFileSync(process.env.REALWORLD_REPORT, JSON.stringify(results, null, 2))
  })
})
