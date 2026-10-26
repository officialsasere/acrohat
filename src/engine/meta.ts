import { PDFDict, PDFDocument, PDFName, PDFArray } from 'pdf-lib'

/** Document properties and sanitizing, via pdf-lib. */

export interface DocProps {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
}

export async function readProps(bytes: Uint8Array): Promise<DocProps> {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  return {
    title: d.getTitle() ?? '',
    author: d.getAuthor() ?? '',
    subject: d.getSubject() ?? '',
    keywords: d.getKeywords() ?? '',
    creator: d.getCreator() ?? '',
    producer: d.getProducer() ?? '',
  }
}

export async function writeProps(bytes: Uint8Array, p: Partial<DocProps>): Promise<Uint8Array> {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  if (p.title !== undefined) d.setTitle(p.title)
  if (p.author !== undefined) d.setAuthor(p.author)
  if (p.subject !== undefined) d.setSubject(p.subject)
  if (p.keywords !== undefined) d.setKeywords(p.keywords.split(',').map((k) => k.trim()).filter(Boolean))
  if (p.creator !== undefined) d.setCreator(p.creator)
  if (p.producer !== undefined) d.setProducer(p.producer)
  return d.save({ updateFieldAppearances: false })
}

export interface SanitizeOptions {
  metadata: boolean
  javascript: boolean
  attachments: boolean
  comments: boolean
}

/** Removes hidden information before sharing a file. Returns the new bytes and what was removed. */
export async function sanitize(bytes: Uint8Array, o: SanitizeOptions): Promise<{ bytes: Uint8Array; removed: string[] }> {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const removed: string[] = []
  const cat = d.catalog
  if (o.metadata) {
    const info = d.context.trailerInfo.Info
    if (info) {
      d.context.trailerInfo.Info = undefined
      removed.push('document properties')
    }
    if (cat.has(PDFName.of('Metadata'))) {
      cat.delete(PDFName.of('Metadata'))
      removed.push('XMP metadata')
    }
    if (cat.has(PDFName.of('PieceInfo'))) {
      cat.delete(PDFName.of('PieceInfo'))
      removed.push('application data')
    }
  }
  if (o.javascript) {
    for (const key of ['OpenAction', 'AA']) {
      if (cat.has(PDFName.of(key))) {
        cat.delete(PDFName.of(key))
        removed.push('open actions')
      }
    }
    const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict)
    if (names?.has(PDFName.of('JavaScript'))) {
      names.delete(PDFName.of('JavaScript'))
      removed.push('document JavaScript')
    }
    for (const page of d.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      for (let i = 0; i < (annots?.size() ?? 0); i++) {
        const a = annots!.lookupMaybe(i, PDFDict)
        if (a?.has(PDFName.of('AA'))) {
          a.delete(PDFName.of('AA'))
          if (!removed.includes('field scripts')) removed.push('field scripts')
        }
      }
    }
  }
  if (o.attachments) {
    const names = cat.lookupMaybe(PDFName.of('Names'), PDFDict)
    if (names?.has(PDFName.of('EmbeddedFiles'))) {
      names.delete(PDFName.of('EmbeddedFiles'))
      removed.push('embedded files')
    }
  }
  if (o.comments) {
    let n = 0
    for (const page of d.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
      if (!annots) continue
      const keep: ReturnType<PDFArray['get']>[] = []
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookupMaybe(i, PDFDict)
        const sub = a?.get(PDFName.of('Subtype'))?.toString()
        if (sub === '/Widget' || sub === '/Link') keep.push(annots.get(i))
        else n++
      }
      page.node.set(PDFName.of('Annots'), d.context.obj(keep))
    }
    if (n) removed.push(`${n} comment${n > 1 ? 's' : ''}/markup`)
  }
  return { bytes: await d.save({ updateFieldAppearances: false }), removed }
}
