import { heapU32, readFloats, readUtf16, withBuf, type Pdfium } from './core'
import type { PdfDocument } from './document'

export const OBJ_TEXT = 1

export type Matrix = [number, number, number, number, number, number]
export type Rect = { left: number; bottom: number; right: number; top: number }

/** One PDF text object (a run of glyphs drawn with a single font, size and color). */
export interface TextRun {
  /** Index of the object in the page's content list. Valid until the page is modified. */
  objIndex: number
  text: string
  bbox: Rect
  fontSize: number
  fontName: string
  embedded: boolean
  bold: boolean
  italic: boolean
  serif: boolean
  mono: boolean
  color: [number, number, number, number]
  matrix: Matrix
}

export interface TextLine {
  text: string
  bbox: Rect
  baseline: number
  runs: TextRun[]
  /** The line's text in pieces, each tied to the run (and so the style) it came from; `text` is their concatenation. */
  segs: { text: string; run: TextRun }[]
}

/** A paragraph-like group of lines; the unit the user edits. */
export interface TextBlock {
  id: string
  pageIndex: number
  text: string
  bbox: Rect
  lines: TextLine[]
  fontSize: number
  lineHeight: number
  runs: TextRun[]
}

function readU32s(m: Pdfium, ptr: number, n: number): number[] {
  return Array.from(heapU32(m).subarray(ptr >> 2, (ptr >> 2) + n))
}

export function objectText(m: Pdfium, obj: number, textPage: number): string {
  const need = m.FPDFTextObj_GetText(obj, textPage, 0, 0)
  if (need <= 2) return ''
  return withBuf(m, need, (buf) => {
    m.FPDFTextObj_GetText(obj, textPage, buf, need)
    return readUtf16(m, buf, need)
  })
}

function fontInfo(m: Pdfium, font: number) {
  const name = withBuf(m, 256, (buf) => {
    const n = m.FPDFFont_GetBaseFontName(font, buf, 256)
    return n > 1 ? m.pdfium.UTF8ToString(buf) : ''
  })
  const flags = m.FPDFFont_GetFlags(font)
  const weight = m.FPDFFont_GetWeight(font)
  const embedded = !!m.FPDFFont_GetIsEmbedded(font)
  const lower = name.toLowerCase()
  // PDF font descriptor flags: 1 FixedPitch, 2 Serif, 64 Italic, 262144 ForceBold
  const bold = weight >= 600 || (flags & 0x40000) !== 0 || /bold|black|heavy/.test(lower)
  const italic = (flags & 0x40) !== 0 || /italic|oblique/.test(lower)
  const mono = (flags & 1) !== 0 || /courier|mono|consolas/.test(lower)
  const serif = (flags & 2) !== 0 || /times|serif|georgia|garamond|palatino|minion/.test(lower)
  return { name: name.replace(/^[A-Z]{6}\+/, ''), embedded, bold, italic, mono, serif }
}

/** Reads every top-level text object on a loaded page. */
export function readRuns(m: Pdfium, page: number): TextRun[] {
  const textPage = m.FPDFText_LoadPage(page)
  const runs: TextRun[] = []
  try {
    const count = m.FPDFPage_CountObjects(page)
    for (let i = 0; i < count; i++) {
      const obj = m.FPDFPage_GetObject(page, i)
      if (m.FPDFPageObj_GetType(obj) !== OBJ_TEXT) continue
      const text = objectText(m, obj, textPage)
      if (!text.trim()) continue
      const bbox = withBuf(m, 16, (p) => {
        m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
        const [l, b, r, t] = readFloats(m, p, 4)
        return { left: l, bottom: b, right: r, top: t }
      })
      const matrix = withBuf(m, 24, (p) => {
        m.FPDFPageObj_GetMatrix(obj, p)
        return readFloats(m, p, 6) as Matrix
      })
      const fontSize = withBuf(m, 4, (p) => {
        m.FPDFTextObj_GetFontSize(obj, p)
        return readFloats(m, p, 1)[0]
      })
      const color = withBuf(m, 16, (p) => {
        m.FPDFPageObj_GetFillColor(obj, p, p + 4, p + 8, p + 12)
        return readU32s(m, p, 4) as [number, number, number, number]
      })
      const font = m.FPDFTextObj_GetFont(obj)
      const info = font ? fontInfo(m, font) : { name: '', embedded: false, bold: false, italic: false, mono: false, serif: false }
      runs.push({
        objIndex: i,
        text,
        bbox,
        fontSize,
        matrix,
        color,
        fontName: info.name,
        embedded: info.embedded,
        bold: info.bold,
        italic: info.italic,
        serif: info.serif,
        mono: info.mono,
      })
    }
  } finally {
    m.FPDFText_ClosePage(textPage)
  }
  return runs
}

/** Effective on-page size of a run (font size scaled by its matrix). */
export function effectiveSize(r: TextRun): number {
  const s = Math.hypot(r.matrix[2], r.matrix[3])
  return r.fontSize * (s || 1)
}

function mergeRect(a: Rect, b: Rect): Rect {
  return {
    left: Math.min(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
  }
}

/** Groups runs into lines (same baseline, close together), left to right. */
function buildLines(runs: TextRun[]): TextLine[] {
  const sorted = [...runs].sort((a, b) => b.matrix[5] - a.matrix[5] || a.bbox.left - b.bbox.left)
  const lines: TextLine[] = []
  for (const run of sorted) {
    const size = effectiveSize(run)
    const target = lines.find((ln) => {
      if (Math.abs(ln.baseline - run.matrix[5]) > size * 0.25) return false
      const last = ln.runs[ln.runs.length - 1]
      const gap = run.bbox.left - last.bbox.right
      return gap < size * 1.2 && gap > -size * 0.5
    })
    if (target) {
      const last = target.runs[target.runs.length - 1]
      const gap = run.bbox.left - last.bbox.right
      const needsSpace = gap > size * 0.15 && !last.text.endsWith(' ') && !run.text.startsWith(' ')
      if (needsSpace) target.segs.push({ text: ' ', run: last })
      // PDFium adds a generated space to the end of a word that is followed by a gap, and the next run often
      // starts with its own space: keep just one.
      const piece = !needsSpace && target.text.endsWith(' ') ? run.text.replace(/^ +/, '') : run.text
      target.segs.push({ text: piece, run })
      target.text += (needsSpace ? ' ' : '') + piece
      target.runs.push(run)
      target.bbox = mergeRect(target.bbox, run.bbox)
    } else {
      lines.push({ text: run.text, bbox: { ...run.bbox }, baseline: run.matrix[5], runs: [run], segs: [{ text: run.text, run }] })
    }
  }
  return lines
}

/** The style that dominates a line (by characters), used to notice headings next to body text. */
function lineBold(line: TextLine): boolean {
  let bold = 0
  let total = 0
  for (const r of line.runs) {
    total += r.text.length
    if (r.bold) bold += r.text.length
  }
  return total > 0 && bold / total > 0.6
}

/**
 * Groups lines into paragraphs. A new paragraph starts at: a larger-than-usual vertical gap, a font size or
 * bold/regular change, a first-line indent, or after a line that stops well short of the column's right edge.
 */
export function buildBlocks(pageIndex: number, runs: TextRun[]): TextBlock[] {
  const lines = buildLines(runs).sort((a, b) => b.baseline - a.baseline || a.bbox.left - b.bbox.left)

  // The page's normal line spacing (median gap between consecutive lines of the same size and column).
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const size = effectiveSize(lines[i].runs[0])
    const dy = lines[i - 1].baseline - lines[i].baseline
    const overlap = lines[i].bbox.left < lines[i - 1].bbox.right && lines[i].bbox.right > lines[i - 1].bbox.left
    if (overlap && Math.abs(effectiveSize(lines[i - 1].runs[0]) - size) < size * 0.1 && dy > size * 0.9 && dy < size * 2) gaps.push(dy / size)
  }
  gaps.sort((a, b) => a - b)
  const leading = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1.2

  const blocks: TextLine[][] = []
  for (const line of lines) {
    const size = effectiveSize(line.runs[0])
    const home = blocks.find((blk) => {
      const prev = blk[blk.length - 1]
      const prevSize = effectiveSize(prev.runs[0])
      if (Math.abs(prevSize - size) > size * 0.12) return false
      const dy = prev.baseline - line.baseline
      if (dy < size * 0.9 || dy > size * 2.0) return false
      if (dy / size > leading * 1.28) return false // extra space between paragraphs
      // Same column: left edges within an indent, and horizontally overlapping.
      const overlaps = line.bbox.left < prev.bbox.right && line.bbox.right > prev.bbox.left
      if (!overlaps || Math.abs(line.bbox.left - blk[0].bbox.left) > size * 3) return false
      if (lineBold(prev) !== lineBold(line)) return false // heading vs body text
      const bodyLeft = blk.length > 1 ? blk[1].bbox.left : blk[0].bbox.left
      if (blk.length > 1 && line.bbox.left > bodyLeft + size * 0.8) return false // a first-line indent starts a paragraph
      // A line that stops well short of the column edge ends its paragraph.
      const colRight = Math.max(...lines.filter((l) => Math.abs(l.bbox.left - bodyLeft) < size * 3 && Math.abs(effectiveSize(l.runs[0]) - size) < size * 0.12).map((l) => l.bbox.right))
      if (prev.bbox.right < colRight - size * 3) return false
      return true
    })
    if (home) home.push(line)
    else blocks.push([line])
  }
  return blocks.map((lns, i) => {
    const allRuns = lns.flatMap((l) => l.runs)
    const bbox = lns.reduce((acc, l) => mergeRect(acc, l.bbox), lns[0].bbox)
    const size = effectiveSize(lns[0].runs[0])
    const lineHeight = lns.length > 1 ? (lns[0].baseline - lns[lns.length - 1].baseline) / (lns.length - 1) : size * 1.2
    return {
      id: `p${pageIndex}-b${i}`,
      pageIndex,
      text: joinLines(lns).text,
      bbox,
      lines: lns,
      fontSize: size,
      lineHeight,
      runs: allRuns,
    }
  })
}

/** Hyphenation marks at the end of a line: typesetters often encode them as U+0002 or U+00AD. */
const SOFT_HYPHEN = /[\u0002\u00ad]$/

/**
 * Joins wrapped lines into flowing text and returns each line's start offset so edits can be mapped back.
 * A hyphenation mark at a line end is dropped and the word is glued back together ("expan-" + "sion").
 */
export function joinLines(lns: { text: string }[]): { text: string; starts: number[] } {
  let out = ''
  const starts: number[] = []
  let glue = false
  for (const ln of lns) {
    if (out && !glue && !/-$/.test(out) && !out.endsWith(' ')) out += ' '
    starts.push(out.length)
    const soft = SOFT_HYPHEN.test(ln.text)
    out += soft ? ln.text.slice(0, -1) : ln.text
    glue = soft
  }
  return { text: out, starts }
}

/** Like `joinLines`, but also says which run (style) every character of the joined text came from. */
export function joinStyled(lns: TextLine[]): { text: string; starts: number[]; runOf: TextRun[] } {
  let out = ''
  const runOf: TextRun[] = []
  const starts: number[] = []
  let glue = false
  let lastRun = lns[0]?.runs[0]
  const push = (t: string, run: TextRun) => {
    out += t
    for (let i = 0; i < t.length; i++) runOf.push(run)
  }
  for (const ln of lns) {
    if (out && !glue && !/-$/.test(out) && !out.endsWith(' ')) push(' ', lastRun)
    starts.push(out.length)
    const soft = SOFT_HYPHEN.test(ln.text)
    let remaining = soft ? ln.text.length - 1 : ln.text.length
    for (const seg of ln.segs) {
      if (remaining <= 0) break
      const t = seg.text.slice(0, remaining)
      push(t, seg.run)
      remaining -= t.length
      lastRun = seg.run
    }
    glue = soft
  }
  return { text: out, starts, runOf }
}

export function extractBlocks(doc: PdfDocument, pageIndex: number): TextBlock[] {
  return doc.withPage(pageIndex, (page) => buildBlocks(pageIndex, readRuns(doc.m, page)))
}

