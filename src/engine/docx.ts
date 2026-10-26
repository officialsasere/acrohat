import { zipSync, strToU8 } from 'fflate'
import type { TextBlock } from './text'

/**
 * Builds a basic Word document from text blocks. It keeps text, paragraph breaks, headings (by size),
 * bold/italic and page breaks; it does not reproduce layout, images or tables.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildDocx(pages: TextBlock[][]): Uint8Array {
  const sizes = pages.flat().map((b) => b.fontSize).sort((a, b) => a - b)
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12
  const paras: string[] = []
  pages.forEach((blocks, pi) => {
    // Reading order: top to bottom, then left to right.
    const ordered = [...blocks].sort((a, b) => b.bbox.top - a.bbox.top || a.bbox.left - b.bbox.left)
    for (const b of ordered) {
      const first = b.runs[0]
      const heading = b.fontSize >= body * 1.35 && b.lines.length <= 3
      const sz = Math.round(b.fontSize * 2)
      const rPr = `<w:rPr>${first.bold || heading ? '<w:b/>' : ''}${first.italic ? '<w:i/>' : ''}<w:sz w:val="${sz}"/></w:rPr>`
      paras.push(`<w:p>${heading ? '<w:pPr><w:keepNext/></w:pPr>' : ''}<w:r>${rPr}<w:t xml:space="preserve">${esc(b.text)}</w:t></w:r></w:p>`)
    }
    if (pi < pages.length - 1) paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
  })
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(doc),
  })
}
