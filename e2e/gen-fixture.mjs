import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync } from 'node:fs'

const doc = await PDFDocument.create()
const helv = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)
for (let i = 1; i <= 3; i++) {
  const p = doc.addPage([612, 792])
  p.drawText(`Annual Report — Page ${i}`, { x: 72, y: 700, size: 24, font: bold })
  const lines = ['Revenue grew by ten percent this', 'quarter compared with last year, driven', 'by strong demand across all regions.']
  lines.forEach((l, k) => p.drawText(l, { x: 72, y: 650 - k * 16, size: 12, font: helv, color: rgb(0.1, 0.1, 0.1) }))
}
writeFileSync(new URL('../tests/fixtures/sample.pdf', import.meta.url), await doc.save())

// A one-page fillable form.
const form = await PDFDocument.create()
const fp = form.addPage([400, 300])
const f = await form.embedFont(StandardFonts.Helvetica)
fp.drawText('Registration form', { x: 40, y: 250, size: 18, font: f })
fp.drawText('Name', { x: 40, y: 215, size: 11, font: f })
const fm = form.getForm()
fm.createTextField('name').addToPage(fp, { x: 90, y: 205, width: 220, height: 24 })
fp.drawText('Subscribe', { x: 60, y: 175, size: 11, font: f })
fm.createCheckBox('subscribe').addToPage(fp, { x: 40, y: 172, width: 14, height: 14 })
writeFileSync(new URL('../tests/fixtures/form.pdf', import.meta.url), await form.save())

// A document with bookmarks and links.
import { PDFName, PDFString, PDFNumber } from 'pdf-lib'
{
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = [1, 2, 3].map((n) => {
    const p = pdf.addPage([400, 300])
    p.drawText(`Chapter ${n}`, { x: 40, y: 240, size: 22, font })
    return p
  })
  pages[0].drawText('Jump to chapter 3', { x: 40, y: 190, size: 12, font, color: rgb(0, 0, 0.8) })
  const ctx = pdf.context
  const outline = ctx.obj({ Type: 'Outlines' })
  const outlineRef = ctx.register(outline)
  const items = pages.map((pg, i) => ctx.register(ctx.obj({ Title: PDFString.of(`Chapter ${i + 1}`), Parent: outlineRef, Dest: [pg.ref, PDFName.of('Fit')] })))
  items.forEach((ref, i) => {
    const d = ctx.lookup(ref)
    if (i > 0) d.set(PDFName.of('Prev'), items[i - 1])
    if (i < items.length - 1) d.set(PDFName.of('Next'), items[i + 1])
  })
  outline.set(PDFName.of('First'), items[0])
  outline.set(PDFName.of('Last'), items[2])
  outline.set(PDFName.of('Count'), PDFNumber.of(3))
  pdf.catalog.set(PDFName.of('Outlines'), outlineRef)
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 185, 160, 205], Border: [0, 0, 0], A: { S: 'GoTo', D: [pages[2].ref, PDFName.of('Fit')] } }))
  pages[0].node.set(PDFName.of('Annots'), ctx.obj([link]))
  writeFileSync(new URL('../tests/fixtures/outline.pdf', import.meta.url), await pdf.save())
}

// A self-signed certificate (password "pw") and a small PNG for image tests.
import forge from 'node-forge'
import { PNG } from 'pngjs'
{
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 5 * 365 * 86_400_000)
  const attrs = [{ name: 'commonName', value: 'Test Signer' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { algorithm: '3des' })
  writeFileSync(new URL('../tests/fixtures/test-cert.p12', import.meta.url), Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'))
  const png = new PNG({ width: 40, height: 30 })
  for (let i = 0; i < png.data.length; i += 4) png.data.set([200, 30, 30, 255], i)
  writeFileSync(new URL('../tests/fixtures/red.png', import.meta.url), PNG.sync.write(png))
}

// Two tightly stacked paragraphs and a footer, for the "paragraph grows" tests.
{
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([300, 300])
  const f = await pdf.embedFont(StandardFonts.Helvetica)
  const para = (y, lines) => lines.forEach((t, i) => page.drawText(t, { x: 30, y: y - i * 14, size: 11, font: f }))
  para(260, ['First paragraph line one here', 'and a second line of it.'])
  para(218, ['Second paragraph starts here and', 'also has two lines of text.'])
  page.drawText('Page 1 footer', { x: 100, y: 40, size: 9, font: f })
  writeFileSync(new URL('../tests/fixtures/stacked.pdf', import.meta.url), await pdf.save())
}
