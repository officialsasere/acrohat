import { beforeAll, describe, expect, it } from 'vitest'
import { PdfDocument } from '../src/engine/document'
import { deletePages, extractPages, importPages, movePages, parseRanges, rotatePages } from '../src/engine/pages'
import { searchPage, selectionRects } from '../src/engine/search'
import { addInk, addMarkup, addNote, addShape, listAnnotations, redact, removeAnnotation } from '../src/engine/annotate'
import { extractBlocks } from '../src/engine/text'
import { fontBytes, pdfium, samplePdf } from './helpers'

let m: Awaited<ReturnType<typeof pdfium>>
beforeAll(async () => {
  m = await pdfium()
})

const threePages = async () => {
  const doc = PdfDocument.open(m, await samplePdf())
  const src = PdfDocument.open(m, await samplePdf())
  importPages(doc, src, 1)
  importPages(doc, src, 2)
  src.close()
  return doc
}

describe('page operations', () => {
  it('imports, rotates, moves, extracts and deletes pages', async () => {
    const doc = await threePages()
    expect(doc.pageCount).toBe(3)
    rotatePages(doc, [1], 90)
    expect(doc.pageSize(1)).toEqual({ width: 300, height: 400 })
    movePages(doc, [1], 0)
    expect(doc.pageSize(0)).toEqual({ width: 300, height: 400 })
    const part = PdfDocument.open(m, extractPages(doc, [0, 2]))
    expect(part.pageCount).toBe(2)
    part.close()
    deletePages(doc, [0])
    expect(doc.pageCount).toBe(2)
    expect(() => deletePages(doc, [0, 1])).toThrow(/at least one page/)
    doc.close()
  })

  it('parses page ranges', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([0, 1, 2, 4, 7, 8])
    expect(() => parseRanges('10', 9)).toThrow(/does not exist/)
    expect(() => parseRanges('x', 9)).toThrow(/Cannot understand/)
  })
})

describe('search', () => {
  it('finds text with device-space rectangles', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const hits = searchPage(doc, 0, 'revenue')
    expect(hits).toHaveLength(1)
    const r = hits[0].rects[0]
    expect(Math.abs(r.x - 40)).toBeLessThan(3) // glyph side bearing
    expect(r.y).toBeGreaterThan(40) // top-left origin: second text line sits below the heading
    expect(r.y).toBeLessThan(120)
    expect(searchPage(doc, 0, 'REVENUE', { matchCase: true })).toHaveLength(0)
    doc.close()
  })
})

describe('annotations', () => {
  it('adds, lists, saves and removes annotations', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const [hit] = searchPage(doc, 0, 'Revenue')
    addMarkup(doc, 0, 'highlight', hit.rects, [255, 235, 59, 120])
    addShape(doc, 0, 'square', { x: 200, y: 100, w: 80, h: 40 }, [220, 0, 0, 255], null, 2)
    addInk(doc, 0, [[10, 10], [30, 25], [60, 12]], [0, 0, 200, 255], 2)
    addNote(doc, 0, [300, 40], 'Check this figure')
    const reopened = PdfDocument.open(m, doc.save())
    const annots = listAnnotations(reopened, 0)
    expect(annots.map((a) => a.subtype).sort((a, b) => a - b)).toEqual([1, 5, 9, 15])
    expect(annots.find((a) => a.subtype === 1)?.contents).toBe('Check this figure')
    removeAnnotation(reopened, 0, annots[0].index)
    expect(listAnnotations(reopened, 0)).toHaveLength(3)
    // The highlight must actually paint something.
    const img = reopened.renderPage(0, 1)
    let yellow = 0
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] < 150) yellow++
    expect(yellow).toBeGreaterThan(100)
    reopened.close()
    doc.close()
  })
})

describe('redaction', () => {
  it('removes the text from the file, not just from view', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    const [hit] = searchPage(doc, 0, 'Revenue')
    const { removed } = redact(doc, 0, hit.rects[0])
    expect(removed).toBeGreaterThan(0)
    const reopened = PdfDocument.open(m, doc.save())
    const text = extractBlocks(reopened, 0).map((b) => b.text).join(' ')
    expect(text).not.toContain('Revenue')
    expect(text).toContain('Quarterly Report')
    expect(searchPage(reopened, 0, 'Revenue')).toHaveLength(0)
    reopened.close()
    doc.close()
  })
})

describe('selection', () => {
  it('selects to the end of a line when the drag overshoots it', async () => {
    const doc = PdfDocument.open(m, await samplePdf())
    // second text line baseline is at y=300-205=95 from the top; drag well past its right end
    const r = selectionRects(doc, 0, [40, 95], [390, 95])
    expect(r.text).toBe('quarter compared with last year.')
    expect(r.rects.length).toBeGreaterThan(0)
    doc.close()
  })
})

describe('forms', () => {
  it('lists fields and fills them, regenerating appearances that render', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const { listFields, fillFields } = await import('../src/engine/forms')
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([300, 300])
    const form = pdf.getForm()
    const name = form.createTextField('full_name')
    name.addToPage(page, { x: 20, y: 240, width: 200, height: 24 })
    const agree = form.createCheckBox('agree')
    agree.addToPage(page, { x: 20, y: 200, width: 18, height: 18 })
    const colour = form.createDropdown('colour')
    colour.addOptions(['Red', 'Green'])
    colour.addToPage(page, { x: 20, y: 150, width: 120, height: 24 })
    const bytes = await pdf.save()

    const fields = await listFields(bytes)
    expect(fields.map((f) => [f.name, f.type]).sort()).toEqual([['agree', 'checkbox'], ['colour', 'dropdown'], ['full_name', 'text']])
    fields.find((f) => f.name === 'full_name')!.widgets[0].rect.forEach((v, i) => expect(Math.abs(v - [20, 240, 220, 264][i]) <= 1).toBe(true))

    const filled = await fillFields(bytes, { full_name: 'Ada Lovelace', agree: true, colour: 'Green' })
    const after = await listFields(filled)
    expect(after.find((f) => f.name === 'full_name')!.value).toBe('Ada Lovelace')
    expect(after.find((f) => f.name === 'agree')!.value).toBe(true)
    expect(after.find((f) => f.name === 'colour')!.value).toBe('Green')

    // The appearance must actually be painted by PDFium, not just stored in the field dictionary.
    const doc = PdfDocument.open(m, filled)
    const img = doc.renderPage(0, 1)
    let dark = 0
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 90) dark++
    expect(dark).toBeGreaterThan(50)
    doc.close()
  })
})

describe('qpdf: protect and optimize', () => {
  const wasm = new URL('../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm', import.meta.url).pathname
  it('encrypts so PDFium needs the password, then decrypts again', async () => {
    const { protect, unprotect } = await import('../src/engine/qpdf')
    const original = await samplePdf()
    const locked = await protect(original, 'secret', 'owner', undefined, wasm)
    expect(() => PdfDocument.open(m, locked)).toThrow(/password/i)
    expect(() => PdfDocument.open(m, locked, 'wrong')).toThrow(/password/i)
    const doc = PdfDocument.open(m, locked, 'secret')
    expect(doc.pageCount).toBe(1)
    doc.close()
    const open = await unprotect(locked, 'secret', wasm)
    const doc2 = PdfDocument.open(m, open)
    expect(doc2.pageCount).toBe(1)
    doc2.close()
  })

  it('optimizes without changing what is rendered', async () => {
    const { optimize } = await import('../src/engine/qpdf')
    const original = await samplePdf()
    const small = await optimize(original, wasm)
    const a = PdfDocument.open(m, original)
    const b = PdfDocument.open(m, small)
    expect(Buffer.from(a.renderPage(0, 1).data).equals(Buffer.from(b.renderPage(0, 1).data))).toBe(true)
    a.close()
    b.close()
  })
})

describe('extras: pages, stamps, flatten, links, outline', () => {
  it('inserts a blank page the size of its neighbour and crops a page', async () => {
    const { insertBlankPage, cropPage } = await import('../src/engine/extras')
    const doc = PdfDocument.open(m, await samplePdf())
    insertBlankPage(doc, 1)
    expect(doc.pageCount).toBe(2)
    expect(doc.pageSize(1)).toEqual({ width: 400, height: 300 })
    cropPage(doc, 0, { x: 20, y: 20, w: 200, h: 100 })
    const size = doc.pageSize(0)
    expect(Math.round(size.width)).toBe(200)
    expect(Math.round(size.height)).toBe(100)
    expect(() => cropPage(doc, 0, { x: 0, y: 0, w: 2, h: 2 })).toThrow(/too small/)
    const reopened = PdfDocument.open(m, doc.save())
    expect(Math.round(reopened.pageSize(0).width)).toBe(200)
    reopened.close()
    doc.close()
  })

  it('stamps page numbers, Bates numbers and a diagonal watermark', async () => {
    const { stampText } = await import('../src/engine/extras')
    const { coverage } = await import('../src/engine/fonts')
    const font = fontBytes('LiberationSans-Regular.ttf')
    const doc = await threePages()
    stampText(doc, [0, 1, 2], { text: 'Page {page} of {pages}', size: 10, color: [0, 0, 0], alpha: 255, angle: 0, position: 'bottom-center', margin: 20 }, font, coverage(font))
    stampText(doc, [0, 1, 2], { text: 'ACME-{bates}', size: 9, color: [0, 0, 0], alpha: 255, angle: 0, position: 'top-right', margin: 16, batesStart: 41, batesDigits: 5 }, font, coverage(font))
    stampText(doc, [0], { text: 'CONFIDENTIAL', size: 60, color: [200, 0, 0], alpha: 90, angle: 45, position: 'center', margin: 0 }, font, coverage(font))
    const re = PdfDocument.open(m, doc.save())
    const text = (i: number) => extractBlocks(re, i).map((b) => b.text).join(' | ')
    expect(text(0)).toContain('Page 1 of 3')
    expect(text(2)).toContain('Page 3 of 3')
    expect(text(1)).toContain('ACME-00042')
    expect(text(0)).toContain('CONFIDENTIAL')
    // Page-number stamp sits near the bottom centre.
    const hit = searchPage(re, 2, 'Page 3 of 3')[0].rects[0]
    expect(hit.y).toBeGreaterThan(250)
    expect(Math.abs(hit.x + hit.w / 2 - 200)).toBeLessThan(8)
    re.close()
    doc.close()
  })

  it('flattens annotations into page content', async () => {
    const { flattenPage } = await import('../src/engine/extras')
    const doc = PdfDocument.open(m, await samplePdf())
    addShape(doc, 0, 'square', { x: 200, y: 100, w: 80, h: 40 }, [220, 0, 0, 255], null, 3)
    expect(listAnnotations(doc, 0)).toHaveLength(1)
    const before = Buffer.from(doc.renderPage(0, 1).data)
    expect(flattenPage(doc, 0)).toBe(true)
    const re = PdfDocument.open(m, doc.save())
    expect(listAnnotations(re, 0)).toHaveLength(0)
    expect(Buffer.from(re.renderPage(0, 1).data).equals(before)).toBe(true) // looks identical, but is now plain content
    re.close()
    doc.close()
  })

  it('reads an outline and internal/external links', async () => {
    const { readOutline, readLinks } = await import('../src/engine/extras')
    const { PDFDocument: PL, PDFName, PDFString, PDFArray, PDFNumber } = await import('pdf-lib')
    const pdf = await PL.create()
    const p1 = pdf.addPage([300, 300])
    const p2 = pdf.addPage([300, 300])
    const ctx = pdf.context
    const outline = ctx.obj({ Type: 'Outlines' })
    const outlineRef = ctx.register(outline)
    const mk = (title: string, page: typeof p1, parent: unknown) =>
      ctx.register(ctx.obj({ Title: PDFString.of(title), Parent: parent as never, Dest: [page.ref, PDFName.of('Fit')] }))
    const a = mk('Intro', p1, outlineRef)
    const b = mk('Chapter 2', p2, outlineRef)
    ctx.lookup(a, (await import('pdf-lib')).PDFDict).set(PDFName.of('Next'), b)
    ctx.lookup(b, (await import('pdf-lib')).PDFDict).set(PDFName.of('Prev'), a)
    outline.set(PDFName.of('First'), a)
    outline.set(PDFName.of('Last'), b)
    outline.set(PDFName.of('Count'), PDFNumber.of(2))
    pdf.catalog.set(PDFName.of('Outlines'), outlineRef)
    const link = (rect: number[], action: object) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], ...action }))
    p1.node.set(PDFName.of('Annots'), ctx.obj([link([20, 20, 120, 60], { A: { S: 'GoTo', D: [p2.ref, PDFName.of('Fit')] } }), link([20, 100, 120, 140], { A: { S: 'URI', URI: PDFString.of('https://example.org/') } })]))
    void PDFArray
    const doc = PdfDocument.open(m, await pdf.save())
    expect(readOutline(doc)).toEqual([
      { title: 'Intro', page: 0, children: [] },
      { title: 'Chapter 2', page: 1, children: [] },
    ])
    const links = readLinks(doc, 0)
    expect(links.find((l) => l.page === 1)).toBeTruthy()
    expect(links.find((l) => l.uri === 'https://example.org/')).toBeTruthy()
    doc.close()
  })
})

describe('properties, sanitizing and DOCX export', () => {
  it('edits properties and removes hidden data', async () => {
    const { readProps, writeProps, sanitize } = await import('../src/engine/meta')
    const original = await samplePdf()
    const withMeta = await writeProps(original, { title: 'Secret plan', author: 'Alice', keywords: 'a, b' })
    expect((await readProps(withMeta)).author).toBe('Alice')
    const { bytes, removed } = await sanitize(withMeta, { metadata: true, javascript: true, attachments: true, comments: true })
    expect(removed).toContain('document properties')
    const after = await readProps(bytes)
    expect(after.author).toBe('')
    expect(after.title).toBe('')
    expect(Buffer.from(bytes).includes('Alice')).toBe(false)
    PdfDocument.open(m, bytes).close()
  })

  it('exports a .docx that is a valid zip with the text in it', async () => {
    const { buildDocx } = await import('../src/engine/docx')
    const { unzipSync, strFromU8 } = await import('fflate')
    const doc = PdfDocument.open(m, await samplePdf())
    const bytes = buildDocx([extractBlocks(doc, 0)])
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml'])
    const xml = strFromU8(files['word/document.xml'])
    expect(xml).toContain('Quarterly Report')
    expect(xml).toContain('Revenue grew by ten percent this quarter compared with last year.')
    expect(xml.indexOf('Quarterly')).toBeLessThan(xml.indexOf('Revenue')) // reading order
    doc.close()
  })
})

describe('digital signatures', () => {
  async function selfSignedP12(password: string, years = 1) {
    const forge = (await import('node-forge')).default
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date(Date.now() - 86_400_000)
    cert.validity.notAfter = new Date(Date.now() + years * 365 * 86_400_000)
    const attrs = [{ name: 'commonName', value: 'Ada Tester' }, { name: 'organizationName', value: 'Kwiiva Paper tests' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })
    return new Uint8Array(Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'))
  }

  it('signs with a certificate, covers the whole file, and the signed PDF still opens', async () => {
    const { signWithCertificate, inspectCertificate, CertificateError } = await import('../src/engine/sign')
    const p12 = await selfSignedP12('pw')
    expect(inspectCertificate(p12, 'pw')).toMatchObject({ commonName: 'Ada Tester', selfSigned: true })
    expect(() => inspectCertificate(p12, 'nope')).toThrow(CertificateError)

    const original = await samplePdf()
    const signed = await signWithCertificate(original, p12, 'pw', { reason: 'Approved', rect: [40, 40, 200, 90] })
    const text = Buffer.from(signed).toString('latin1')
    expect(text).toContain('/Type /Sig')
    expect(text).toContain('/SubFilter /adbe.pkcs7.detached')
    // ByteRange must cover everything except the signature value itself.
    const br = /\/ByteRange \[\s*(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(text)!.slice(1).map(Number)
    expect(br[0]).toBe(0)
    expect(br[2] + br[3]).toBe(signed.length)
    // PDFium recognises the signature.
    const doc = PdfDocument.open(m, signed)
    expect(m.FPDF_GetSignatureCount(doc.raw)).toBe(1)
    expect(extractBlocks(doc, 0).map((b) => b.text).join(' ')).toContain('Quarterly Report')
    doc.close()

    // Tampering with a signed byte must be detectable: the digest of the covered bytes no longer matches.
    const forge = (await import('node-forge')).default
    const digest = (b: Uint8Array) => {
      const covered = Buffer.concat([Buffer.from(b.slice(br[0], br[0] + br[1])), Buffer.from(b.slice(br[2], br[2] + br[3]))])
      return forge.md.sha256.create().update(covered.toString('binary')).digest().toHex()
    }
    const hexSig = text.slice(br[1] + 1, br[2] - 1)
    expect(forge.util.hexToBytes(hexSig.replace(/0+$/, '').padEnd(2, '0')).length).toBeGreaterThan(500) // a real CMS blob
    const tampered = signed.slice()
    tampered[200] ^= 1
    expect(digest(tampered)).not.toBe(digest(signed))
  }, 60_000)

  it('refuses an expired certificate', async () => {
    const { signWithCertificate } = await import('../src/engine/sign')
    const p12 = await selfSignedP12('pw', -1)
    await expect(signWithCertificate(await samplePdf(), p12, 'pw')).rejects.toThrow(/expired/)
  }, 60_000)
})

describe('image objects', () => {
  it('lists, moves, resizes, replaces and deletes an image', async () => {
    const { addImage } = await import('../src/engine/annotate')
    const { listImages, placeImage, replaceImage, deleteImage } = await import('../src/engine/objects')
    const doc = PdfDocument.open(m, await samplePdf())
    const px = (r: number, g: number, b: number) => new Uint8ClampedArray(Array.from({ length: 16 }, () => [r, g, b, 255]).flat())
    addImage(doc, 0, px(255, 0, 0), 4, 4, { x: 100, y: 120, w: 80, h: 60 })
    let [img] = listImages(doc, 0)
    expect(img.rect).toMatchObject({ x: 100, y: 120 })
    expect(Math.round(img.rect.w)).toBe(80)
    placeImage(doc, 0, img.index, { x: 150, y: 140, w: 40, h: 30 })
    ;[img] = listImages(doc, 0)
    expect([Math.round(img.rect.x), Math.round(img.rect.y), Math.round(img.rect.w), Math.round(img.rect.h)]).toEqual([150, 140, 40, 30])
    replaceImage(doc, 0, img.index, px(0, 0, 255), 4, 4)
    ;[img] = listImages(doc, 0)
    expect(Math.round(img.rect.x)).toBe(150)
    const re = PdfDocument.open(m, doc.save())
    const shot = re.renderPage(0, 1)
    const at = (150 + 20 + (140 + 15) * 400) * 4 // centre of the image
    expect([shot.data[at], shot.data[at + 1], shot.data[at + 2]]).toEqual([0, 0, 255])
    deleteImage(re, 0, listImages(re, 0)[0].index)
    expect(listImages(re, 0)).toHaveLength(0)
    expect(() => placeImage(re, 0, 0, { x: 0, y: 0, w: 1, h: 1 })).toThrow()
    re.close()
    doc.close()
  })
})

describe('form creation and comparison', () => {
  it('adds fields that then show up as fillable', async () => {
    const { addField, listFields, fillFields } = await import('../src/engine/forms')
    let bytes = await samplePdf()
    bytes = await addField(bytes, { type: 'text', name: 'email', page: 0, rect: [40, 120, 240, 144] })
    bytes = await addField(bytes, { type: 'dropdown', name: 'size', page: 0, rect: [40, 80, 140, 104], options: ['S', 'M', 'L'] })
    bytes = await addField(bytes, { type: 'checkbox', name: 'ok', page: 0, rect: [40, 50, 58, 68] })
    await expect(addField(bytes, { type: 'text', name: 'email', page: 0, rect: [0, 0, 10, 10] })).rejects.toThrow(/already exists/)
    const fields = await listFields(bytes)
    expect(fields.map((f) => f.name).sort()).toEqual(['email', 'ok', 'size'])
    expect(fields.find((f) => f.name === 'size')!.options).toEqual(['S', 'M', 'L'])
    const filled = await fillFields(bytes, { email: 'a@b.co', size: 'M' })
    expect((await listFields(filled)).find((f) => f.name === 'email')!.value).toBe('a@b.co')
  })

  it('compares two documents by paragraph', async () => {
    const { compareParagraphs } = await import('../src/engine/compare')
    const P = (...t: string[]) => t.map((text, i) => ({ text, page: i }))
    const r = compareParagraphs(P('Intro', 'Price is 10 dollars', 'Terms apply', 'Bye'), P('Intro', 'Price is 12 dollars', 'Terms apply', 'New clause', 'Bye'))
    expect(r.identical).toBe(3)
    expect(r.changes.map((c) => `${c.kind}:${c.text}`).sort()).toEqual(['added:New clause', 'added:Price is 12 dollars', 'removed:Price is 10 dollars'])
    expect(compareParagraphs(P('a', 'b'), P('a', 'b')).changes).toEqual([])
  })
})

describe('pattern redaction', () => {
  it('finds regex matches with geometry and redacts them out of the file', async () => {
    const { stampText } = await import('../src/engine/extras')
    const { coverage } = await import('../src/engine/fonts')
    const { regexMatches } = await import('../src/engine/search')
    const font = fontBytes('LiberationSans-Regular.ttf')
    const doc = PdfDocument.open(m, await samplePdf())
    stampText(doc, [0], { text: 'Contact bob@example.com, SSN 123-45-6789', size: 11, color: [0, 0, 0], alpha: 255, angle: 0, position: 'bottom-left', margin: 30 }, font, coverage(font))
    const re = PdfDocument.open(m, doc.save())
    const ssn = regexMatches(re, 0, /\b\d{3}-\d{2}-\d{4}\b/)
    const mail = regexMatches(re, 0, /[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(ssn.map((x) => x.text)).toEqual(['123-45-6789'])
    expect(mail.map((x) => x.text)).toEqual(['bob@example.com'])
    expect(ssn[0].rects[0].y).toBeGreaterThan(240) // near the bottom
    for (const r of ssn[0].rects) redact(re, 0, r)
    const out = PdfDocument.open(m, re.save())
    const text = extractBlocks(out, 0).map((b) => b.text).join(' ')
    expect(text).not.toContain('123-45-6789')
    expect(text).toContain('Quarterly Report')
    out.close()
    re.close()
    doc.close()
  })
})

describe('signature validation', () => {
  async function p12(password: string) {
    const forge = (await import('node-forge')).default
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '07'
    cert.validity.notBefore = new Date(Date.now() - 86_400_000)
    cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000)
    const attrs = [{ name: 'commonName', value: 'Grace Hopper' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    return new Uint8Array(Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })).getBytes(), 'binary'))
  }

  it('reports valid, modified-after-signing, and appended-after-signing correctly', async () => {
    const { signWithCertificate } = await import('../src/engine/sign')
    const { verifySignatures, countSignatures } = await import('../src/engine/verify')
    const signed = await signWithCertificate(await samplePdf(), await p12('pw'), 'pw', { reason: 'Approved' })

    expect(countSignatures(signed)).toBe(1)
    const [ok] = await verifySignatures(signed)
    expect(ok).toMatchObject({ status: 'valid', signer: 'Grace Hopper', selfSigned: true, coversWholeFile: true, certificateExpired: false })
    expect(ok.reason).toBe('Approved')

    // Change one byte inside the signed range (the header's version digit).
    const tampered = signed.slice()
    expect(String.fromCharCode(tampered[7])).toMatch(/\d/)
    tampered[7] = tampered[7] === 0x37 ? 0x36 : 0x37
    expect((await verifySignatures(tampered))[0]).toMatchObject({ status: 'modified', signer: 'Grace Hopper' })

    // Appending data (what a later save would do) leaves the signature itself valid but flags it.
    const appended = new Uint8Array([...signed, ...Buffer.from('\n%% later change\n')])
    expect((await verifySignatures(appended))[0]).toMatchObject({ status: 'valid', coversWholeFile: false })

    // An unsigned file has nothing to report.
    expect(await verifySignatures(await samplePdf())).toEqual([])
  }, 60_000)
})

describe('PDF/A', () => {
  it('generates a structurally valid ICC profile', async () => {
    const { srgbIccProfile } = await import('../src/engine/icc')
    const p = srgbIccProfile()
    const dv = new DataView(p.buffer)
    expect(dv.getUint32(0)).toBe(p.length) // size field matches
    expect(String.fromCharCode(...p.subarray(36, 40))).toBe('acsp')
    expect(String.fromCharCode(...p.subarray(12, 16))).toBe('mntr')
    expect(String.fromCharCode(...p.subarray(16, 20))).toBe('RGB ')
    const n = dv.getUint32(128)
    expect(n).toBe(9)
    for (let i = 0; i < n; i++) {
      const off = dv.getUint32(132 + i * 12 + 4)
      const len = dv.getUint32(132 + i * 12 + 8)
      expect(off % 4).toBe(0)
      expect(off + len).toBeLessThanOrEqual(p.length)
    }
    // mid-grey sRGB (0.5) linearises to ~0.214
    const curveOff = dv.getUint32(132 + 6 * 12 + 4)
    const mid = dv.getUint16(curveOff + 12 + 512 * 2) / 65535
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.23)
  })

  it('converts a plain PDF so that our checks find nothing wrong, without changing how it looks', async () => {
    const { embedFonts, makePdfA, checkPdfA } = await import('../src/engine/pdfa')
    const original = await samplePdf() // Helvetica, not embedded
    const before = await checkPdfA(original)
    expect(before.passesChecks).toBe(false)
    const msgs = before.issues.map((i) => i.message).join('\n')
    expect(msgs).toMatch(/Fonts are not embedded: .*Helvetica/)
    expect(msgs).toMatch(/No XMP metadata/)
    expect(msgs).toMatch(/No output intent/)

    const doc = PdfDocument.open(m, original)
    const res = await embedFonts(doc, async (f) => fontBytes(f), { flatten: true })
    expect(res.replacedObjects).toBe(3)
    const { bytes } = await makePdfA(doc.save())
    doc.close()

    const after = await checkPdfA(bytes)
    expect(after.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(after.passesChecks).toBe(true)

    // Text is intact and in the same place.
    const a = PdfDocument.open(m, original)
    const b = PdfDocument.open(m, bytes)
    expect(extractBlocks(b, 0).map((x) => x.text)).toEqual(extractBlocks(a, 0).map((x) => x.text))
    const ra = extractBlocks(a, 0)[1].bbox
    const rb = extractBlocks(b, 0)[1].bbox
    expect(Math.abs(ra.left - rb.left)).toBeLessThan(0.5)
    expect(Math.abs(ra.right - rb.right)).toBeLessThan(6) // Liberation matches Helvetica metrics closely
    const imgA = a.renderPage(0, 1)
    const imgB = b.renderPage(0, 1)
    let diff = 0
    for (let i = 0; i < imgA.data.length; i += 4) if (Math.abs(imgA.data[i] - imgB.data[i]) > 100) diff++
    expect(diff / (imgA.width * imgA.height)).toBeLessThan(0.01)
    a.close()
    b.close()
  })

  it('strips scripts, embedded files and unprintable annotations', async () => {
    const { makePdfA, checkPdfA } = await import('../src/engine/pdfa')
    const { PDFDocument: PL, PDFName, PDFString } = await import('pdf-lib')
    const pdf = await PL.create()
    const page = pdf.addPage([200, 200])
    pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }))
    page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 50, 50] }))]))
    const bytes = await pdf.save()
    const before = await checkPdfA(bytes)
    expect(before.issues.map((i) => i.message).join('\n')).toMatch(/open action[\s\S]*appearance/)
    const out = await makePdfA(bytes)
    expect(out.removed.join(' ')).toMatch(/open action/)
    expect((await checkPdfA(out.bytes)).issues.filter((i) => i.severity === 'error')).toEqual([])
  })
})

describe('accessibility', () => {
  it('tags a document with headings, paragraphs and figures, and the checker agrees', async () => {
    const { markContent, buildStructureTree, checkAccessibility, listFigures } = await import('../src/engine/access')
    const { addImage } = await import('../src/engine/annotate')
    const doc = PdfDocument.open(m, await samplePdf())
    const px = new Uint8ClampedArray(Array.from({ length: 16 }, () => [30, 90, 200, 255]).flat())
    addImage(doc, 0, px, 4, 4, { x: 250, y: 120, w: 60, h: 60 })

    const before = await checkAccessibility(doc.save(), [true])
    expect(before.tagged).toBe(false)
    expect(before.issues.map((i) => i.message).join('\n')).toMatch(/not tagged[\s\S]*no title[\s\S]*language/)

    const figs = listFigures(doc)
    expect(figs).toHaveLength(1)
    const structure = markContent(doc, { [figs[0].key]: 'A blue square' })
    expect(structure[0].elems.map((e) => e.type).sort()).toEqual(['Figure', 'H1', 'P'])

    const tagged = await buildStructureTree(doc.save(), structure, { lang: 'en-US', title: 'Quarterly report' })
    doc.close()

    const report = await checkAccessibility(tagged, [true])
    expect(report).toMatchObject({ tagged: true, headings: 1, paragraphs: 1, figures: 1, figuresWithoutAlt: 0 })
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([])

    // PDFium (an independent reader) sees the same tree, with the content tied to it by marked-content ids.
    const re = PdfDocument.open(m, tagged)
    re.withPage(0, (page) => {
      const tree = m.FPDF_StructTree_GetForPage(page)
      expect(tree).toBeTruthy()
      const typeOf = (el: number) =>
        withBufType(el)
      function withBufType(el: number): string {
        const need = m.FPDF_StructElement_GetType(el, 0, 0)
        const buf = m.pdfium.wasmExports.malloc(need)
        m.FPDF_StructElement_GetType(el, buf, need)
        const s = new TextDecoder('utf-16le').decode(m.pdfium.HEAPU8.slice(buf, buf + need - 2))
        m.pdfium.wasmExports.free(buf)
        return s
      }
      const kids: string[] = []
      const visit = (el: number) => {
        kids.push(typeOf(el))
        for (let i = 0; i < m.FPDF_StructElement_CountChildren(el); i++) visit(m.FPDF_StructElement_GetChildAtIndex(el, i))
      }
      for (let i = 0; i < m.FPDF_StructTree_CountChildren(tree); i++) visit(m.FPDF_StructTree_GetChildAtIndex(tree, i))
      m.FPDF_StructTree_Close(tree)
      expect(kids).toEqual(expect.arrayContaining(['Document', 'H1', 'P', 'Figure']))
    })
    // Rendering is unchanged by tagging.
    const plain = PdfDocument.open(m, await samplePdf())
    const a = plain.renderPage(0, 1)
    plain.close()
    const b = re.renderPage(0, 1)
    let diff = 0
    for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 60) diff++
    expect(diff).toBeLessThan(a.width * a.height * 0.01 + 3700) // the added image accounts for the difference
    re.close()
  })

  it('flags scans and images without alternative text', async () => {
    const { checkAccessibility } = await import('../src/engine/access')
    const r = await checkAccessibility(await samplePdf(), [false])
    expect(r.issues.map((i) => i.message).join('\n')).toMatch(/Page 1 has no text/)
  })
})

describe('hyphenated typesetter output', () => {
  it('joins words split by a line-end hyphen mark (U+0002 / soft hyphen)', async () => {
    const { joinLines } = await import('../src/engine/text')
    expect(joinLines([{ text: 'a long expan\u0002' }, { text: 'sion of text' }]).text).toBe('a long expansion of text')
    expect(joinLines([{ text: 'exam­' }, { text: 'ple here' }]).text).toBe('example here')
    expect(joinLines([{ text: 'a self-' }, { text: 'made man' }]).text).toBe('a self-made man') // real hyphen kept
    expect(joinLines([{ text: 'one' }, { text: 'two' }]).text).toBe('one two')
    const j = joinLines([{ text: 'expan\u0002' }, { text: 'sion x' }])
    expect(j.starts).toEqual([0, 5])
  })
})
