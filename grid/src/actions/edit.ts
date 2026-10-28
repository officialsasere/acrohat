import { cellName, rangeText } from '../engine/address'
import { editStringOf } from '../engine/input'
import type { Sheet } from '../engine/model'
import { checkInput, validationAt } from '../engine/validation'
import { MAX_COLS, key, type Rect } from '../engine/types'
import { layoutOf } from '../geometry'
import { inSel, rectOf, single } from '../selection'
import { useStore, type Edit } from '../store'
import { dataRect, gridApi, move, setSel } from './nav'

const st = () => useStore.getState()

/** Is the cell protected from changes? Only matters when the sheet is protected. */
export function isLocked(sheet: Sheet, r: number, c: number): boolean {
  if (!sheet.protected) return false
  const style = st().book.styles.get(sheet.cells.get(key(r, c))?.s ?? 0)
  return style.locked !== false
}
/** Refuses (with a message) to change protected cells. */
export function canWrite(rects: Rect[]): boolean {
  const sh = st().book.activeSheet
  if (!sh.protected) return true
  for (const g of rects) {
    const d = dataRect(g)
    for (let r = d.r1; r <= d.r2; r++) for (let c = d.c1; c <= d.c2; c++) if (isLocked(sh, r, c)) { st().toast('error', 'This sheet is protected. Unprotect it (Data → Protect sheet) to change locked cells.'); return false }
  }
  return true
}

export function startEdit(o: { text?: string; mode?: 'type' | 'edit'; origin?: 'cell' | 'bar'; caret?: number } = {}) {
  const s = st()
  if (s.edit) return
  const book = s.book, sh = book.activeSheet
  const m = sh.merges.find((x) => s.sel.r >= x.r1 && s.sel.r <= x.r2 && s.sel.c >= x.c1 && s.sel.c <= x.c2)
  const r = m ? m.r1 : s.sel.r, c = m ? m.c1 : s.sel.c
  if (!canWrite([{ r1: r, c1: c, r2: r, c2: c }])) return
  const cell = book.getCell(sh.id, r, c)
  const text = o.text ?? editStringOf(book.value(sh.id, r, c), cell?.f, book.styleOf(sh.id, r, c).fmt ?? 'General')
  const edit: Edit = { sheet: sh.id, r, c, text, origin: o.origin ?? 'cell', mode: o.mode ?? 'edit', caret: o.caret ?? text.length }
  useStore.setState({ edit })
}
export function setEditText(text: string, caret: number) {
  const e = st().edit
  if (e) useStore.setState({ edit: { ...e, text, caret, point: undefined } })
}
export const cancelEdit = () => { useStore.setState({ edit: null }); gridApi()?.focus() }

/** Adds the closing brackets a formula is missing. */
export function autoClose(f: string): string {
  let depth = 0, q = false
  for (const ch of f) { if (ch === '"') q = !q; else if (!q) { if (ch === '(') depth++; else if (ch === ')') depth-- } }
  return depth > 0 ? f + ')'.repeat(depth) : f
}

/** Applies what is being typed. Returns false (and tells the person why) if it cannot be accepted. */
export function commitEdit(dir: 'down' | 'up' | 'right' | 'left' | 'none' = 'down'): boolean {
  const s = st(), e = s.edit
  if (!e) return true
  const book = s.book, sh = book.sheet(e.sheet)
  let text = e.text
  if (text.startsWith('=') && text.length > 1) {
    text = autoClose(text)
    const msg = book.checkFormula(text)
    if (msg) { s.toast('error', `That formula can't be used: ${msg}.`); return false }
  }
  const chk = checkInput(book, sh, e.r, e.c, text)
  if (!chk.ok) {
    if (chk.warn) { if (!window.confirm(`${chk.message}\n\nKeep it anyway?`)) return false }
    else { s.toast('error', chk.message ?? 'Not allowed here.'); return false }
  }
  book.setInput(e.sheet, e.r, e.c, text)
  useStore.setState({ edit: null, file: { ...s.file, dirty: true } })
  if (dir !== 'none') advance(dir)
  gridApi()?.focus()
  return true
}

/** After Enter or Tab: move on, staying inside a selected block like other spreadsheets do. */
export function advance(dir: 'down' | 'up' | 'right' | 'left') {
  const s = st()
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const multi = g.r1 !== g.r2 || g.c1 !== g.c2
  const dr = dir === 'down' ? 1 : dir === 'up' ? -1 : 0, dc = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
  if (!multi) {
    // Tab then Enter returns to the column where the Tab run started.
    move(dr, dc)
    return
  }
  let r = s.sel.r + dr, c = s.sel.c + dc
  if (r > g.r2) { r = g.r1; c++ } else if (r < g.r1) { r = g.r2; c-- }
  if (c > g.c2) { c = g.c1; r++ } else if (c < g.c1) { c = g.c2; r-- }
  if (r > g.r2) r = g.r1
  if (r < g.r1) r = g.r2
  if (c > g.c2) c = g.c1
  if (c < g.c1) c = g.c2
  setSel({ ...s.sel, r, c })
}

// ---------------------------------------------------------------- pointing at cells while typing a formula
export function canPoint(text: string, caret: number): boolean {
  if (!text.startsWith('=')) return false
  const before = text.slice(0, caret).replace(/\s+$/, '')
  if (!before) return false
  return /[=+\-*/^&(,<>;:{%]$/.test(before)
}

export function pointText(rect: Rect, sheetName?: string): string {
  const one = rect.r1 === rect.r2 && rect.c1 === rect.c2
  return one && !sheetName ? cellName(rect.r1, rect.c1) : rangeText(rect, sheetName)
}

/** Writes a reference into the formula at the caret (or replaces the one just pointed at). */
export function pointAt(rect: Rect, sheetName?: string): boolean {
  const e = st().edit
  if (!e || !e.text.startsWith('=')) return false
  if (!e.point && !canPoint(e.text, e.caret)) return false
  const t = pointText(rect, sheetName)
  const from = e.point?.from ?? e.caret, to = e.point?.to ?? e.caret
  const text = e.text.slice(0, from) + t + e.text.slice(to)
  useStore.setState({ edit: { ...e, text, caret: from + t.length, point: { from, to: from + t.length } } })
  return true
}

/** Colours for the references in a formula being edited. */
export const REF_COLORS = ['#2f6fd0', '#c2410c', '#15803d', '#a21caf', '#0e7490', '#b45309', '#be123c']
export function refsInText(text: string, bookSheet: number, nameToId: (n: string) => number | undefined) {
  const out: { rect: Rect; color: string; sheet: number }[] = []
  if (!text.startsWith('=')) return out
  const re = /(?:('(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?/g
  let m: RegExpExecArray | null
  let i = 0
  const cell = (s: string) => { const x = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s)!; let col = 0; for (const ch of x[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64; return { c: col - 1, r: parseInt(x[2], 10) - 1 } }
  while ((m = re.exec(text))) {
    const before = text[m.index - 1]
    if (before && /[\w.]/.test(before)) continue
    const sheet = m[1] ? nameToId(m[1].replace(/^'|'$/g, '').replace(/''/g, "'")) : bookSheet
    if (sheet === undefined) continue
    const a = cell(m[2]), b = m[3] ? cell(m[3]) : a
    if (a.c >= MAX_COLS) continue
    out.push({ rect: rectOf(a.r, a.c, b.r, b.c), color: REF_COLORS[i++ % REF_COLORS.length], sheet })
  }
  return out
}

// ------------------------------------------------------------------ deleting
export function clearSelection(what: 'contents' | 'formats' | 'all' = 'contents') {
  const s = st()
  if (!canWrite(s.sel.ranges)) return
  s.book.clear(s.book.activeSheet.id, s.sel.ranges.map(dataRect), what)
  useStore.setState({ file: { ...s.file, dirty: true } })
}

export function toggleCheckbox(r: number, c: number) {
  const s = st(), book = s.book, sh = book.activeSheet
  const v = validationAt(sh, r, c)
  if (!v || v.type !== 'checkbox' || !canWrite([{ r1: r, c1: c, r2: r, c2: c }])) return
  const cur = book.value(sh.id, r, c)
  const on = cur === true || String(cur).toUpperCase() === String(v.checked ?? 'TRUE').toUpperCase()
  book.setInput(sh.id, r, c, on ? v.unchecked ?? 'FALSE' : v.checked ?? 'TRUE')
  useStore.setState({ file: { ...s.file, dirty: true } })
}

export function selectedText(): string {
  const s = st(), g = s.sel.ranges[s.sel.ranges.length - 1]
  return [...Array(g.r2 - g.r1 + 1).keys()].map((i) => [...Array(g.c2 - g.c1 + 1).keys()].map((j) => s.book.display(s.book.activeSheet.id, g.r1 + i, g.c1 + j).text).join('\t')).join('\n')
}
export { inSel, layoutOf, single }
