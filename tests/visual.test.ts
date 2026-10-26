import { it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { PdfDocument } from '../src/engine/document'
import { extractBlocks } from '../src/engine/text'
import { editBlock } from '../src/engine/edit'
import { fontBytes, pdfium, samplePdf } from './helpers'

const loadFont = async (f: string) => fontBytes(f)
it('renders before/after', async () => {
  const m = await pdfium()
  const doc = PdfDocument.open(m, await samplePdf())
  let [head] = extractBlocks(doc, 0)
  await editBlock(doc, head, 'Quarterly Report ★ Żółć', { loadFont, maxRight: 364 })
  const para = extractBlocks(doc, 0).find((b) => b.text.startsWith('Revenue'))!
  await editBlock(doc, para, para.text.replace('ten', 'twelve and a half').replace('last year', 'the same period in the previous year'), { loadFont, maxRight: 364 })
  const img = doc.renderPage(0, 2)
  const rgb = Buffer.alloc(img.width * img.height * 3)
  for (let i = 0, j = 0; i < img.data.length; i += 4) { rgb[j++] = img.data[i]; rgb[j++] = img.data[i+1]; rgb[j++] = img.data[i+2] }
  writeFileSync('/private/tmp/claude-502/-Users-noted-Codes-acrohat/a38adc2a-cb66-4035-b01d-b1676e0b26b2/scratchpad/out.ppm', Buffer.concat([Buffer.from(`P6 ${img.width} ${img.height} 255\n`), rgb]))
})
