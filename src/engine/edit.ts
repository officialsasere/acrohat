import { alloc, free, heap, heapF32, readFloats, withBuf, writeUtf16, type Pdfium } from './core'
import type { PdfDocument } from './document'
import { chooseFont } from './fonts'
import { joinStyled, objectText, readRuns, type TextBlock, type TextRun } from './text'

export interface FontSpec {
  family: 'Sans' | 'Serif' | 'Mono'
  bold: boolean
  italic: boolean
}

export function specFor(run: TextRun): FontSpec {
  return { family: run.mono ? 'Mono' : run.serif ? 'Serif' : 'Sans', bold: run.bold, italic: run.italic }
}

export interface EditResult {
  /** True when the original font could not render the new text and a substitute was embedded. */
  fontSubstituted: boolean
  linesWritten: number
}

export class UnsupportedCharactersError extends Error {
  constructor(readonly chars: string[]) {
    super(`No bundled font can draw: ${chars.join(' ')}`)
  }
}

/** The edit makes the paragraph taller and it would run into other content. Nothing has been changed. */
export class OverflowError extends Error {
  constructor(
    readonly extraLines: number,
    readonly collidesWith: string,
    /** Whether pushing the content below down would fit on the page. */
    readonly canPush: boolean,
  ) {
    super(`This edit adds ${extraLines} line${extraLines === 1 ? '' : 's'} and would overlap ${collidesWith}`)
  }
}

export interface EditOptions {
  /**
   * What to do when the paragraph grows into other content: `ask` (default) refuses with an OverflowError,
   * `push` moves the content below it down to make room, `overlap` goes ahead and lets them overlap.
   */
  overflow?: 'ask' | 'push' | 'overlap'
  /** Loads a bundled font file (e.g. from /fonts) when the original font can't draw the new text. */
  loadFont: (file: string) => Promise<Uint8Array>
  /** Extra room (in points) a single-line block may grow into, to the right of its box. */
  maxRight?: number
}

const fontCache = new WeakMap<PdfDocument, Map<string, number>>()

function loadFallback(doc: PdfDocument, file: string, data: Uint8Array): number {
  let cache = fontCache.get(doc)
  if (!cache) fontCache.set(doc, (cache = new Map()))
  const hit = cache.get(file)
  if (hit) return hit
  const m = doc.m
  const ptr = alloc(m, data.length)
  heap(m).set(data, ptr)
  // FPDF_FONT_TRUETYPE = 2; cid = true gives a Unicode-capable Type0 font.
  const font = m.FPDFText_LoadFont(doc.raw, ptr, data.length, 2, true)
  free(m, ptr)
  if (!font) throw new Error('Could not load the replacement font')
  cache.set(file, font)
  return font
}

function makeTextObj(m: Pdfium, doc: number, font: number, size: number, text: string): number {
  const obj = m.FPDFPageObj_CreateTextObj(doc, font, size)
  if (!obj) return 0
  const u16 = writeUtf16(m, text)
  const ok = m.FPDFText_SetText(obj, u16)
  free(m, u16)
  if (!ok) {
    m.FPDFPageObj_Destroy(obj)
    return 0
  }
  return obj
}

function setMatrix(m: Pdfium, obj: number, mat: number[]) {
  withBuf(m, 24, (p) => {
    heapF32(m).set(mat, p >> 2)
    m.FPDFPageObj_SetMatrix(obj, p)
  })
}

function boundsWidth(m: Pdfium, obj: number): number {
  return withBuf(m, 16, (p) => {
    m.FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)
    const [l, , r] = readFloats(m, p, 4)
    return r - l
  })
}

/** Measures text width in font-size units for one font (no kerning; cached). */
class Measurer {
  private cache = new Map<string, number>()
  constructor(
    private m: Pdfium,
    private doc: number,
    private font: number,
    private size: number,
  ) {}
  width(text: string): number {
    const hit = this.cache.get(text)
    if (hit !== undefined) return hit
    const obj = makeTextObj(this.m, this.doc, this.font, this.size, text)
    let w = 0
    if (obj) {
      w = boundsWidth(this.m, obj)
      this.m.FPDFPageObj_Destroy(obj)
    }
    this.cache.set(text, w)
    return w
  }
  get space(): number {
    return this.width('a a') - this.width('aa') || this.size * 0.28
  }
}

const LATIN1 = /^[\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\n]*$/

/** Runs that look the same share a style: same face, size, colour and matrix. */
const styleKey = (r: TextRun) => `${r.fontName}|${r.bold}|${r.italic}|${r.fontSize}|${r.color.join(',')}|${r.matrix.slice(0, 4).map((v) => v.toFixed(3)).join(',')}`

interface Style {
  key: string
  rep: TextRun
  chars: Set<string>
  fallback?: { file: string; data: Uint8Array }
  font: number
  measurer?: Measurer
  /** Page units per font-size unit along the baseline. */
  scale: number
}

interface Piece {
  style: Style
  text: string
}

/**
 * Replaces the text of a block with `newText`, re-flowing it inside the block's box.
 *
 * Lines the edit doesn't touch keep their original objects. Rewritten lines keep the styles of the text
 * they came from (bold, italic, size, colour), so a bold word stays bold; new text takes the style of the
 * character before it. A font is reused when it can draw the characters, otherwise a similar one is embedded.
 */
export async function editBlock(doc: PdfDocument, block: TextBlock, newText: string, opts: EditOptions, reflowTail = false): Promise<EditResult> {
  const m = doc.m
  const old = joinStyled(block.lines)
  const oldText = old.text
  if (newText === oldText) return { fontSubstituted: false, linesWritten: 0 }

  // Which original lines does the edit touch? (common prefix / suffix of the text)
  let pre = 0
  while (pre < oldText.length && pre < newText.length && oldText[pre] === newText[pre]) pre++
  let suf = 0
  while (suf < oldText.length - pre && suf < newText.length - pre && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++
  const starts = old.starts
  const lineOf = (offset: number) => {
    let i = 0
    while (i + 1 < starts.length && starts[i + 1] <= offset) i++
    return i
  }
  const lines = block.lines
  const firstLine = lineOf(pre)
  const lastLine = lineOf(Math.max(pre, oldText.length - suf - 1))
  const segStartOld = starts[firstLine]
  const segEndOld = lastLine + 1 < lines.length ? starts[lastLine + 1] : oldText.length
  const tailOld = oldText.slice(segEndOld)
  const unchangedTail = !reflowTail && newText.endsWith(tailOld) && newText.length - tailOld.length >= segStartOld
  const segStart = segStartOld
  let segment: string
  let tailStart = lastLine + 1
  if (unchangedTail) {
    segment = newText.slice(segStartOld, newText.length - tailOld.length).replace(/ $/, '')
  } else {
    segment = newText.slice(segStartOld)
    tailStart = lines.length
  }

  // Style of every character in the segment, from the old text it lines up with.
  const delta = newText.length - oldText.length
  const styleAt = (j: number): TextRun => {
    if (j < pre) return old.runOf[j]
    if (j >= newText.length - suf) return old.runOf[j - delta]
    return old.runOf[Math.max(0, Math.min(pre - 1, old.runOf.length - 1))] ?? block.runs[0]
  }

  // Group characters by style; decide, per style, whether its own font can draw them.
  const styles = new Map<string, Style>()
  const seenByFont = new Map<string, Set<string>>()
  for (const r of block.runs) {
    let set = seenByFont.get(r.fontName)
    if (!set) seenByFont.set(r.fontName, (set = new Set()))
    for (const c of r.text) set.add(c)
  }
  const chars: { ch: string; style: Style }[] = []
  for (let j = segStart; j < segStart + segment.length; j++) {
    const run = styleAt(j)
    const key = styleKey(run)
    let st = styles.get(key)
    if (!st) styles.set(key, (st = { key, rep: run, chars: new Set(), font: 0, scale: 1 }))
    st.chars.add(segment[j - segStart])
    chars.push({ ch: segment[j - segStart], style: st })
  }
  for (const st of styles.values()) {
    const r = st.rep
    const reuse = r.embedded ? [...st.chars].every((c) => c === '\n' || seenByFont.get(r.fontName)?.has(c)) : [...st.chars].every((c) => LATIN1.test(c))
    if (!reuse) {
      const choice = await chooseFont(specFor(r), [...st.chars].join(''), opts.loadFont)
      if (!choice.font) throw new UnsupportedCharactersError(choice.missing)
      st.fallback = choice.font
    }
  }

  const outcome = doc.withPage(block.pageIndex, (page): EditResult | 'reflow-tail' => {
    const first = block.runs[0]
    const textPage = m.FPDFText_LoadPage(page)
    try {
      if (objectText(m, m.FPDFPage_GetObject(page, first.objIndex), textPage) !== first.text) {
        throw new Error('The page changed since the text was read; reload the page and try again')
      }
    } finally {
      m.FPDFText_ClosePage(textPage)
    }

    for (const st of styles.values()) {
      const obj = m.FPDFPage_GetObject(page, st.rep.objIndex)
      st.font = st.fallback ? loadFallback(doc, st.fallback.file, st.fallback.data) : m.FPDFTextObj_GetFont(obj)
      if (!st.font) throw new Error('The original font is unavailable for this text object')
      st.measurer = new Measurer(m, doc.raw, st.font, st.rep.fontSize)
      st.scale = Math.hypot(st.rep.matrix[0], st.rep.matrix[1]) || 1
    }

    // Split into words made of styled pieces, then wrap greedily.
    type Word = { pieces: Piece[]; width: number; spaceBefore: { style: Style; width: number } | null; hardBreak: boolean }
    const words: Word[] = []
    let cur: Word | null = null
    let pendingSpace: Style | null = null
    let hard = false
    for (const { ch, style } of chars) {
      if (ch === '\n') {
        hard = true
        cur = null
        pendingSpace = null
        continue
      }
      if (ch === ' ') {
        cur = null
        pendingSpace = style
        continue
      }
      if (!cur) {
        cur = { pieces: [], width: 0, spaceBefore: pendingSpace ? { style: pendingSpace, width: pendingSpace.measurer!.space * pendingSpace.scale } : null, hardBreak: hard }
        words.push(cur)
        pendingSpace = null
        hard = false
      }
      const last = cur.pieces[cur.pieces.length - 1]
      if (last && last.style === style) last.text += ch
      else cur.pieces.push({ style, text: ch })
    }
    for (const w of words) w.width = w.pieces.reduce((n, p) => n + p.style.measurer!.width(p.text) * p.style.scale, 0)

    const blockWidth = block.bbox.right - block.bbox.left
    const slack = block.lines.length === 1 ? Math.max(0, (opts.maxRight ?? block.bbox.right) - block.bbox.right) : 0
    const maxWidth = blockWidth + slack + 1
    const laid: { items: { style: Style; text: string; x: number }[] }[] = []
    let line: { items: { style: Style; text: string; x: number }[] } | null = null
    let x = 0
    const add = (style: Style, text: string, atX: number) => {
      const lastItem = line!.items[line!.items.length - 1]
      if (lastItem && lastItem.style === style) lastItem.text += text
      else line!.items.push({ style, text, x: atX })
    }
    for (const w of words) {
      const sp = w.spaceBefore?.width ?? 0
      if (!line || w.hardBreak || (line.items.length && x + sp + w.width > maxWidth)) {
        line = { items: [] }
        laid.push(line)
        x = 0
      } else if (w.spaceBefore) {
        add(w.spaceBefore.style, ' ', x)
        x += sp
      }
      for (const p of w.pieces) {
        add(p.style, p.text, x)
        x += p.style.measurer!.width(p.text) * p.style.scale
      }
    }

    // Lines below the edit were kept, but the rewritten part needs a different number of lines: reflow them too.
    if (tailStart < lines.length && laid.length !== tailStart - firstLine) return 'reflow-tail'

    // Does the rewritten paragraph grow, and if so does it run into anything?
    const newLineCount = firstLine + laid.length + (lines.length - tailStart)
    const growth = newLineCount - lines.length
    let pushBy = 0
    let chain: number[] = []
    if (growth > 0) {
      const upright = Math.abs(block.runs[0].matrix[1]) < 1e-3 && Math.abs(block.runs[0].matrix[2]) < 1e-3
      const extra = growth * block.lineHeight
      const oldBottom = block.bbox.bottom
      const col = { left: block.bbox.left - block.fontSize, right: block.bbox.right + block.fontSize }
      const doomedSet = new Set(lines.slice(firstLine, tailStart).flatMap((l) => l.runs).map((r) => r.objIndex))
      type Obj = { index: number; left: number; bottom: number; right: number; top: number }
      const others: Obj[] = []
      const count = m.FPDFPage_CountObjects(page)
      for (let i = 0; i < count; i++) {
        if (doomedSet.has(i)) continue
        const o = m.FPDFPage_GetObject(page, i)
        const [l, b, r, t] = withBuf(m, 16, (p) => {
          m.FPDFPageObj_GetBounds(o, p, p + 4, p + 8, p + 12)
          return readFloats(m, p, 4)
        })
        others.push({ index: i, left: l, bottom: b, right: r, top: t })
      }
      // Lines below the edit that we keep belong to this paragraph and move with it; they are not obstacles.
      const keptBelow = new Set(lines.slice(tailStart).flatMap((l) => l.runs).map((r) => r.objIndex))
      const below = others.filter((o) => !keptBelow.has(o.index) && o.top <= oldBottom + 1 && o.right > col.left && o.left < col.right).sort((a, b) => b.top - a.top)
      const hit = below.find((o) => o.top > oldBottom - extra - 1 && o.bottom < oldBottom - 0.5)
      if (hit && upright) {
        // The contiguous stack of content under the paragraph, stopping at the first big gap (e.g. before a footer).
        const stack: Obj[] = []
        let edge = oldBottom
        for (const o of below) {
          if (edge - o.top > block.lineHeight * 3) break
          stack.push(o)
          edge = Math.min(edge, o.bottom)
        }
        const beyond = below.find((o) => !stack.includes(o))
        const floor = beyond ? beyond.top : 18
        const room = edge - floor
        const canPush = room >= extra + 1
        const snippet = (() => {
          const t = readRuns(m, page).find((r) => r.objIndex === hit.index)?.text
          return t ? `“${t.length > 40 ? t.slice(0, 40) + '…' : t}”` : 'other content on the page'
        })()
        const mode = opts.overflow ?? 'ask'
        if (mode === 'ask') throw new OverflowError(growth, snippet, canPush)
        if (mode === 'push') {
          if (!canPush) throw new OverflowError(growth, snippet, false)
          pushBy = extra
          chain = stack.map((o) => o.index)
        }
      } else if (hit && (opts.overflow ?? 'ask') === 'ask') {
        throw new OverflowError(growth, 'other content on the page', false)
      }
    }

    // Geometry of the first rewritten line comes from the line it replaces.
    const anchorLine = lines[Math.min(firstLine, lines.length - 1)]
    const anchor = anchorLine.runs[0]
    const [a, b, c, d] = anchor.matrix
    const downScale = Math.hypot(c, d) || 1
    const dx = (-c / downScale) * block.lineHeight
    const dy = (-d / downScale) * block.lineHeight
    const along = Math.hypot(a, b) || 1
    const ux = a / along
    const uy = b / along
    const x0 = Math.min(...anchorLine.runs.map((r) => r.matrix[4]))
    const y0 = anchor.matrix[5]

    for (const idx of chain) m.FPDFPageObj_Transform(m.FPDFPage_GetObject(page, idx), 1, 0, 0, 1, 0, -pushBy)
    // Lines kept below the paragraph move down with it, too.
    if (pushBy) for (const l of lines.slice(tailStart)) for (const r of l.runs) m.FPDFPageObj_Transform(m.FPDFPage_GetObject(page, r.objIndex), 1, 0, 0, 1, 0, -pushBy)

    const created: number[] = []
    laid.forEach((ln, k) => {
      for (const it of ln.items) {
        if (!it.text.trim() && !ln.items.some((o) => o.text.trim())) continue
        const st = it.style
        const obj = makeTextObj(m, doc.raw, st.font, st.rep.fontSize, it.text)
        if (!obj) throw new Error('Could not create text')
        const [ma, mb, mc, md] = st.rep.matrix
        setMatrix(m, obj, [ma, mb, mc, md, x0 + dx * k + ux * it.x, y0 + dy * k + uy * it.x])
        m.FPDFPageObj_SetFillColor(obj, st.rep.color[0], st.rep.color[1], st.rep.color[2], st.rep.color[3])
        m.FPDFPage_InsertObject(page, obj)
        created.push(obj)
      }
    })

    // Remove the superseded original objects (highest index first so indices stay valid).
    const doomed = lines
      .slice(firstLine, tailStart)
      .flatMap((l) => l.runs)
      .map((r) => r.objIndex)
      .sort((p, q) => q - p)
    for (const idx of doomed) {
      const obj = m.FPDFPage_GetObject(page, idx)
      if (obj) {
        m.FPDFPage_RemoveObject(page, obj)
        m.FPDFPageObj_Destroy(obj)
      }
    }
    if (!m.FPDFPage_GenerateContent(page)) throw new Error('Could not write the page content')
    return { fontSubstituted: [...styles.values()].some((st) => st.fallback), linesWritten: created.length }
  })
  return outcome === 'reflow-tail' ? editBlock(doc, block, newText, opts, true) : outcome
}

/** Re-reads runs for a page; handy after an edit to confirm the stored text. */
export function pageText(doc: PdfDocument, pageIndex: number): string[] {
  return doc.withPage(pageIndex, (page) => readRuns(doc.m, page).map((r) => r.text))
}
