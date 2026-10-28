import { parseInput } from '../engine/input'
import type { Cell } from '../engine/model'
import { MAX_COLS, MAX_ROWS, type Rect } from '../engine/types'
import { rectOf } from '../selection'
import { useStore, type Clip } from '../store'
import { canWrite } from './edit'
import { dataRect, setSel } from './nav'

const st = () => useStore.getState()
const mark = () => useStore.setState((s) => ({ file: { ...s.file, dirty: true } }))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const tsvEscape = (t: string) => (/[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)

function tableHtml(g: Rect): string {
  const s = st(), book = s.book, sh = book.activeSheet
  const rows: string[] = []
  for (let r = g.r1; r <= g.r2; r++) {
    const cells: string[] = []
    for (let c = g.c1; c <= g.c2; c++) {
      const style = book.styleOf(sh.id, r, c), f = book.display(sh.id, r, c)
      const css = [style.bold && 'font-weight:bold', style.italic && 'font-style:italic', style.underline && 'text-decoration:underline', style.color && `color:${style.color}`, style.bg && `background:${style.bg}`, style.h && `text-align:${style.h}`].filter(Boolean).join(';')
      cells.push(`<td${css ? ` style="${css}"` : ''}>${esc(f.text)}</td>`)
    }
    rows.push(`<tr>${cells.join('')}</tr>`)
  }
  return `<table>${rows.join('')}</table>`
}

/** Copies (or cuts) the selection: to the system clipboard as text and a table, and internally with formulas and formats. */
export async function copy(cut = false) {
  const s = st(), book = s.book, sh = book.activeSheet
  const g0 = s.sel.ranges[s.sel.ranges.length - 1]
  const g = dataRectForCopy(g0)
  if (cut && !canWrite([g0])) return
  const text = [...Array(g.r2 - g.r1 + 1).keys()].map((i) => [...Array(g.c2 - g.c1 + 1).keys()].map((j) => tsvEscape(book.display(sh.id, g.r1 + i, g.c1 + j).text)).join('\t')).join('\n')
  const clip: Clip = { sheet: sh.id, rect: g, block: book.readBlock(sh.id, g), cut, text }
  useStore.setState({ clip })
  try {
    if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([tableHtml(g)], { type: 'text/html' }) })])
    } else await navigator.clipboard.writeText(text)
  } catch {
    // Older browsers and some webviews: fall back to a hidden text box.
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select()
    try { document.execCommand('copy') } catch { /* nothing more to try */ }
    t.remove()
  }
}
function dataRectForCopy(g: Rect): Rect {
  const area = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)
  return area > 500_000 ? dataRect(g) : g
}

/** Parses a clipboard table: tab-separated text with quoted cells. */
export function parseTsv(text: string, sep = '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cur = '', q = false
  const t = text.replace(/\r\n?/g, '\n')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"' && cur === '') q = true
    else if (ch === sep) { row.push(cur); cur = '' }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

interface HtmlCell { text: string; css: Record<string, string> }
function parseHtmlTable(html: string): HtmlCell[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null
  return [...table.querySelectorAll('tr')].map((tr) => [...tr.children].filter((e) => /^t[dh]$/i.test(e.tagName)).map((td) => {
    const css: Record<string, string> = {}
    const style = (td as HTMLElement).style
    for (const p of ['fontWeight', 'fontStyle', 'textDecoration', 'color', 'backgroundColor', 'textAlign']) { const v = style[p as 'color']; if (v) css[p] = v }
    return { text: (td.textContent ?? '').replace(/\s+/g, ' ').trim(), css }
  }))
}
const cssColor = (v: string | undefined) => { if (!v) return undefined; const c = document.createElement('canvas').getContext('2d')!; c.fillStyle = '#000'; c.fillStyle = v; return c.fillStyle as string }

/** Pastes what is on the clipboard at the cursor: our own copy with formulas, or text and tables from elsewhere. */
export function paste(e: { clipboardData: DataTransfer | null }, mode: PasteMode = 'all') {
  const s = st(), book = s.book, sh = book.activeSheet
  const text = e.clipboardData?.getData('text/plain') ?? ''
  const html = e.clipboardData?.getData('text/html') ?? ''
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const r0 = g.r1, c0 = g.c1
  if (s.painter) return
  if (s.clip && (s.clip.text === text || !text)) return pasteBlock(s.clip, mode)
  if (!text && !html) return
  const grid = html && /<table/i.test(html) ? parseHtmlTable(html) : null
  const rows = parseTsv(text.replace(/\n$/, ''))
  const h = grid?.length === rows.length ? grid : null
  const w = Math.max(...rows.map((r) => r.length))
  const target = { r1: r0, c1: c0, r2: r0 + rows.length - 1, c2: c0 + w - 1 }
  if (!canWrite([target])) return
  book.transaction('Paste', () => {
    rows.forEach((row, i) => row.forEach((t, j) => {
      const r = r0 + i, c = c0 + j
      if (r >= MAX_ROWS || c >= MAX_COLS) return
      book.setInput(sh.id, r, c, t)
      const hc = h?.[i]?.[j]
      if (hc && (mode === 'all' || mode === 'formats')) {
        const patch: Record<string, unknown> = {}
        if (/bold|[7-9]00/.test(hc.css.fontWeight ?? '')) patch.bold = true
        if (hc.css.fontStyle === 'italic') patch.italic = true
        if (/underline/.test(hc.css.textDecoration ?? '')) patch.underline = true
        if (hc.css.color && hc.css.color !== 'rgb(0, 0, 0)') patch.color = cssColor(hc.css.color)
        if (hc.css.backgroundColor && hc.css.backgroundColor !== 'rgba(0, 0, 0, 0)' && hc.css.backgroundColor !== 'transparent') patch.bg = cssColor(hc.css.backgroundColor)
        if (hc.css.textAlign && ['left', 'center', 'right'].includes(hc.css.textAlign)) patch.h = hc.css.textAlign
        if (Object.keys(patch).length) book.setStyle(sh.id, [{ r1: r, c1: c, r2: r, c2: c }], patch)
      }
    }))
  })
  setSel({ ranges: [target], r: r0, c: c0, ar: r0, ac: c0 }, false)
  mark()
}

export type PasteMode = 'all' | 'values' | 'formulas' | 'formats' | 'transpose' | 'values+fmt' | 'widths'

export function pasteBlock(clip: Clip, mode: PasteMode = 'all') {
  const s = st(), book = s.book, sh = book.activeSheet
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  let block = clip.block
  if (mode === 'transpose') block = block[0].map((_, j) => block.map((row) => row[j]))
  const bh = block.length, bw = block[0]?.length ?? 0
  if (!bh || !bw) return
  // A bigger selection is filled by repeating the copied block.
  const selH = g.r2 - g.r1 + 1, selW = g.c2 - g.c1 + 1
  const tilesR = selH >= bh && selH % bh === 0 ? selH / bh : 1, tilesC = selW >= bw && selW % bw === 0 ? selW / bw : 1
  const target: Rect = { r1: g.r1, c1: g.c1, r2: g.r1 + bh * tilesR - 1, c2: g.c1 + bw * tilesC - 1 }
  if (!canWrite([target])) return
  book.transaction('Paste', () => {
    if (mode === 'widths') {
      for (let j = 0; j < bw; j++) { const w = sh.colW.get(clip.rect.c1 + j); book.mapSet(sh.colW, g.c1 + j, w) }
      return
    }
    for (let ti = 0; ti < tilesR; ti++) for (let tj = 0; tj < tilesC; tj++) {
      const r = g.r1 + ti * bh, c = g.c1 + tj * bw
      const what = {
        values: mode !== 'formats' && mode !== 'formulas',
        formulas: mode !== 'values' && mode !== 'formats' && mode !== 'values+fmt',
        formats: mode === 'all' || mode === 'formats' || mode === 'transpose' || mode === 'values+fmt',
      }
      if (mode === 'values' || mode === 'values+fmt') {
        const plain: (Cell | undefined)[][] = block.map((row) => row.map((cell) => (cell ? { ...cell, f: undefined, v: cell.v } : undefined)))
        book.writeBlock(sh.id, r, c, plain, { row: clip.rect.r1, col: clip.rect.c1 }, { values: true, formulas: false, formats: mode === 'values+fmt' })
      } else if (mode === 'formulas') book.writeBlock(sh.id, r, c, block, { row: clip.rect.r1, col: clip.rect.c1 }, { values: true, formulas: true, formats: false })
      else book.writeBlock(sh.id, r, c, block, { row: clip.rect.r1, col: clip.rect.c1 }, what)
    }
    // Cutting moves: the original is emptied.
    if (clip.cut && mode === 'all') {
      const src = { ...clip.rect }
      const overlap = !(target.r2 < src.r1 || target.r1 > src.r2 || target.c2 < src.c1 || target.c1 > src.c2)
      if (!overlap) book.clear(clip.sheet, [src], 'all')
      else book.clear(clip.sheet, [src].map((x) => x), 'all')
    }
  })
  if (clip.cut) useStore.setState({ clip: null })
  setSel({ ranges: [target], r: g.r1, c: g.c1, ar: g.r1, ac: g.c1 }, false)
  mark()
}

/** Copy the cells of the selection from the given cell range into many places (fill, drag). */
export const regionOf = (a: number, b: number, c: number, d: number) => rectOf(a, b, c, d)
export { parseInput }
