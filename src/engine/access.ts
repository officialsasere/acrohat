import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from 'pdf-lib'
import type { PdfDocument } from './document'
import { extractBlocks } from './text'
import { listImages } from './objects'

/** Accessibility: automatic tagging (structure tree, reading order, figure alt text) and a checker. */

export type StructType = 'H1' | 'H2' | 'H3' | 'P' | 'Figure'

export interface StructElem {
  type: StructType
  /** Marked-content ids on this page that belong to the element. */
  mcids: number[]
  alt?: string
}

export interface PageStructure {
  page: number
  elems: StructElem[]
}

export interface FigureRef {
  key: string
  page: number
}

/** Images on every page, in the order they'll be tagged, so the UI can ask for alternative text. */
export function listFigures(doc: PdfDocument): { key: string; page: number; rect: { x: number; y: number; w: number; h: number } }[] {
  const out: { key: string; page: number; rect: { x: number; y: number; w: number; h: number } }[] = []
  for (let p = 0; p < doc.pageCount; p++) listImages(doc, p).forEach((im, n) => out.push({ key: `${p}-${n}`, page: p, rect: im.rect }))
  return out
}

/** Step 1 (PDFium): wrap every piece of content in marked-content, returning the intended structure. */
export function markContent(doc: PdfDocument, alts: Record<string, string> = {}): PageStructure[] {
  const m = doc.m
  const pages: PageStructure[] = []

  // Body size: the font size carrying the most text; headings are clearly larger and short.
  const weight = new Map<number, number>()
  const all = Array.from({ length: doc.pageCount }, (_, i) => extractBlocks(doc, i))
  for (const blocks of all) for (const b of blocks) weight.set(Math.round(b.fontSize * 2) / 2, (weight.get(Math.round(b.fontSize * 2) / 2) ?? 0) + b.text.length)
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12
  const headingSizes = [...new Set(all.flat().filter((b) => b.fontSize >= body * 1.15 && b.lines.length <= 3).map((b) => Math.round(b.fontSize * 2) / 2))].sort((a, b) => b - a)

  for (let p = 0; p < doc.pageCount; p++) {
    const blocks = all[p].sort((a, b) => b.bbox.top - a.bbox.top || a.bbox.left - b.bbox.left)
    const elems: StructElem[] = []
    doc.withPage(p, (page) => {
      let next = 0
      const tagged = new Set<number>()
      const tag = (obj: number, name: string): number => {
        const mark = m.FPDFPageObj_AddMark(obj, name)
        const id = next++
        m.FPDFPageObjMark_SetIntParam(doc.raw, obj, mark, 'MCID', id)
        return id
      }
      const objectAt = (i: number) => m.FPDFPage_GetObject(page, i)

      // Merge text blocks and figures into one reading order (top to bottom, left to right).
      type Item = { top: number; left: number; run: () => void }
      const items: Item[] = []
      for (const b of blocks) {
        const size = Math.round(b.fontSize * 2) / 2
        const level = headingSizes.indexOf(size)
        const type: StructType = level >= 0 && b.fontSize >= body * 1.15 && b.lines.length <= 3 ? (['H1', 'H2', 'H3'][Math.min(level, 2)] as StructType) : 'P'
        items.push({
          top: b.bbox.top,
          left: b.bbox.left,
          run: () => {
            const mcids = b.runs.map((r) => {
              tagged.add(r.objIndex)
              return tag(objectAt(r.objIndex), type)
            })
            elems.push({ type, mcids })
          },
        })
      }
      const imgs = listImages(doc, p)
      imgs.forEach((im, n) => {
        items.push({
          // listImages gives device coordinates (top-left origin); convert to a comparable "top" value.
          top: doc.pageSize(p).height - im.rect.y,
          left: im.rect.x,
          run: () => {
            tagged.add(im.index)
            elems.push({ type: 'Figure', mcids: [tag(objectAt(im.index), 'Figure')], alt: alts[`${p}-${n}`] ?? '' })
          },
        })
      })
      items.sort((a, b) => b.top - a.top || a.left - b.left).forEach((it) => it.run())

      // Everything else (rules, backgrounds, stray text) is an artifact, not content.
      const count = m.FPDFPage_CountObjects(page)
      for (let i = 0; i < count; i++) {
        if (tagged.has(i)) continue
        const obj = objectAt(i)
        m.FPDFPageObj_AddMark(obj, 'Artifact')
      }
      if (!m.FPDFPage_GenerateContent(page)) throw new Error('Could not write the page content')
    })
    pages.push({ page: p, elems })
  }
  return pages
}

/** Step 2 (pdf-lib): build the structure tree that the marked content refers to. */
export async function buildStructureTree(bytes: Uint8Array, structure: PageStructure[], o: { lang: string; title: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const ctx = doc.context
  const pages = doc.getPages()
  const rootRef = ctx.nextRef()
  const docElemRef = ctx.nextRef()
  const docKids: PDFRef[] = []
  const parentTreeNums: (PDFObject)[] = []

  for (const ps of structure) {
    const pageRef = pages[ps.page].ref
    const byMcid: PDFRef[] = []
    for (const el of ps.elems) {
      const dict: Record<string, unknown> = {
        Type: 'StructElem',
        S: el.type,
        P: docElemRef,
        Pg: pageRef,
        K: el.mcids.length === 1 ? el.mcids[0] : el.mcids,
      }
      if (el.type === 'Figure') dict.Alt = PDFString.of(el.alt ?? '')
      const ref = ctx.register(ctx.obj(dict as never))
      docKids.push(ref)
      for (const id of el.mcids) byMcid[id] = ref
    }
    pages[ps.page].node.set(PDFName.of('StructParents'), PDFNumber.of(ps.page))
    pages[ps.page].node.set(PDFName.of('Tabs'), PDFName.of('S'))
    parentTreeNums.push(PDFNumber.of(ps.page), ctx.obj(byMcid.map((r) => r ?? null) as never))
  }

  ctx.assign(docElemRef, ctx.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: docKids }))
  const parentTree = ctx.register(ctx.obj({ Nums: parentTreeNums as never }))
  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: [docElemRef], ParentTree: parentTree, ParentTreeNextKey: structure.length }))

  const cat = doc.catalog
  cat.set(PDFName.of('StructTreeRoot'), rootRef)
  cat.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }))
  cat.set(PDFName.of('Lang'), PDFString.of(o.lang))
  cat.set(PDFName.of('ViewerPreferences'), ctx.obj({ DisplayDocTitle: true }))
  if (o.title) doc.setTitle(o.title)
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/* -------------------------------------------------------------------------------------------- */

export interface A11yIssue {
  severity: 'error' | 'warning'
  message: string
}

export interface A11yReport {
  tagged: boolean
  headings: number
  paragraphs: number
  figures: number
  figuresWithoutAlt: number
  issues: A11yIssue[]
}

/** Checks a file for the most common accessibility problems. `textPerPage[i]` is false for pages with no text. */
export async function checkAccessibility(bytes: Uint8Array, textPerPage: boolean[]): Promise<A11yReport> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const cat = doc.catalog
  const issues: A11yIssue[] = []
  const err = (message: string) => issues.push({ severity: 'error', message })
  const warn = (message: string) => issues.push({ severity: 'warning', message })

  const root = cat.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict)
  const marked = cat.lookupMaybe(PDFName.of('MarkInfo'), PDFDict)?.get(PDFName.of('Marked'))?.toString() === 'true'
  const tagged = !!root && marked
  let headings = 0
  let paragraphs = 0
  let figures = 0
  let noAlt = 0
  const levels: number[] = []
  const walk = (node: PDFObject | undefined, depth: number) => {
    if (!node || depth > 60) return
    const d = node instanceof PDFRef ? doc.context.lookup(node) : node
    if (d instanceof PDFArray) {
      for (let i = 0; i < d.size(); i++) walk(d.get(i), depth + 1)
      return
    }
    if (!(d instanceof PDFDict)) return
    const s = d.get(PDFName.of('S'))?.toString().slice(1)
    if (s) {
      if (/^H[1-6]?$/.test(s)) {
        headings++
        levels.push(Number(s.slice(1)) || 1)
      } else if (s === 'P') paragraphs++
      else if (s === 'Figure') {
        figures++
        const alt = d.get(PDFName.of('Alt'))
        const altText = alt instanceof PDFString || alt instanceof PDFHexString ? alt.decodeText().trim() : ''
        if (!altText) noAlt++
      }
    }
    walk(d.get(PDFName.of('K')), depth + 1)
  }
  if (root) walk(root.get(PDFName.of('K')), 0)

  if (!tagged) err('The document is not tagged, so screen readers cannot follow its structure or reading order.')
  if (!doc.getTitle()?.trim()) err('The document has no title.')
  else if (cat.lookupMaybe(PDFName.of('ViewerPreferences'), PDFDict)?.get(PDFName.of('DisplayDocTitle'))?.toString() !== 'true') warn('The window title bar does not show the document title (DisplayDocTitle).')
  const lang = cat.get(PDFName.of('Lang'))
  if (!(lang instanceof PDFString) || !lang.decodeText().trim()) err('No document language is set.')
  textPerPage.forEach((has, i) => {
    if (!has) err(`Page ${i + 1} has no text (it is probably a scan). Run text recognition first.`)
  })
  if (tagged && noAlt) err(`${noAlt} image${noAlt > 1 ? 's' : ''} have no alternative text.`)
  if (tagged && figures === 0 && headings === 0 && paragraphs === 0) warn('The structure tree is empty.')
  if (tagged && headings === 0 && textPerPage.length > 1) warn('No headings are tagged; long documents are easier to navigate with them.')
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      warn(`Heading levels skip from H${levels[i - 1]} to H${levels[i]}.`)
      break
    }
  }
  const form = cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  if (form) {
    let missing = 0
    for (const f of doc.getForm().getFields()) if (!f.acroField.dict.has(PDFName.of('TU'))) missing++
    if (missing) warn(`${missing} form field${missing > 1 ? 's have' : ' has'} no tooltip/label (/TU) for screen readers.`)
  }
  return { tagged, headings, paragraphs, figures, figuresWithoutAlt: noAlt, issues }
}
