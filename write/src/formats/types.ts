/** A document is stored as ProseMirror JSON (what the editor uses) plus page settings. */
export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}
export interface PMDoc extends PMNode {
  type: 'doc'
  content: PMNode[]
}

export type PageSizeName = 'letter' | 'a4' | 'a5' | 'legal' | 'a3'
/** Header or footer text in three zones. `{page}` and `{pages}` are replaced by the page number and count. */
export interface HeaderFooter {
  left: string
  center: string
  right: string
}
export interface PageSettings {
  size: PageSizeName
  orientation: 'portrait' | 'landscape'
  /** Margins in inches. */
  margins: { top: number; right: number; bottom: number; left: number }
  header: HeaderFooter
  footer: HeaderFooter
  /** Font name and size (pt) of normal text. */
  bodyFont: string
  bodySize: number
}

export const PAGE_SIZES: Record<PageSizeName, { label: string; w: number; h: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
  a4: { label: 'A4 (21 × 29.7 cm)', w: 8.2677, h: 11.6929 },
  a5: { label: 'A5 (14.8 × 21 cm)', w: 5.8268, h: 8.2677 },
  legal: { label: 'Legal (8.5 × 14 in)', w: 8.5, h: 14 },
  a3: { label: 'A3 (29.7 × 42 cm)', w: 11.6929, h: 16.5354 },
}

export const EMPTY_HF: HeaderFooter = { left: '', center: '', right: '' }
export const DEFAULT_SETTINGS: PageSettings = {
  size: 'letter',
  orientation: 'portrait',
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
  header: { ...EMPTY_HF },
  footer: { ...EMPTY_HF },
  bodyFont: 'Calibri',
  bodySize: 11,
}

export interface WriteDocument {
  title: string
  doc: PMDoc
  settings: PageSettings
}

export function emptyDoc(): PMDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** Page width and height in CSS pixels (96 per inch), honouring orientation. */
export function pagePx(s: PageSettings) {
  const { w, h } = PAGE_SIZES[s.size]
  const [pw, ph] = s.orientation === 'landscape' ? [h, w] : [w, h]
  return { w: Math.round(pw * 96), h: Math.round(ph * 96) }
}
