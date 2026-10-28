import { canWrite } from './edit'
import { dataRect, selectCell, setSel } from './nav'
import { useStore } from '../store'
import { layoutOf } from '../geometry'
import { fontOf } from '../render'
import { MAX_COLS, MAX_ROWS, key } from '../engine/types'
import { SPARK } from '../engine/functions/google'

const st = () => useStore.getState()
const mark = () => useStore.setState((s) => ({ file: { ...s.file, dirty: true } }))

function rows(): [number, number] { const g = st().sel.ranges[st().sel.ranges.length - 1]; return [g.r1, g.r2] }
function cols(): [number, number] { const g = st().sel.ranges[st().sel.ranges.length - 1]; return [g.c1, g.c2] }

export function insertRows(where: 'above' | 'below', n?: number) {
  const s = st(), sh = s.book.activeSheet
  const [a, b] = rows()
  const count = n ?? b - a + 1
  if (!canWrite([{ r1: 0, c1: 0, r2: 0, c2: 0 }]) ) return
  if (sh.protected) return void s.toast('error', 'This sheet is protected.')
  s.book.structural(sh.id, { axis: 'row', kind: 'insert', at: where === 'above' ? a : b + 1, count })
  mark()
}
export function insertCols(where: 'left' | 'right', n?: number) {
  const s = st(), sh = s.book.activeSheet
  const [a, b] = cols()
  if (sh.protected) return void s.toast('error', 'This sheet is protected.')
  s.book.structural(sh.id, { axis: 'col', kind: 'insert', at: where === 'left' ? a : b + 1, count: n ?? b - a + 1 })
  mark()
}
export function deleteRows() {
  const s = st(), sh = s.book.activeSheet
  if (sh.protected) return void s.toast('error', 'This sheet is protected.')
  const [a, b] = rows()
  s.book.structural(sh.id, { axis: 'row', kind: 'delete', at: a, count: b - a + 1 })
  mark()
}
export function deleteCols() {
  const s = st(), sh = s.book.activeSheet
  if (sh.protected) return void s.toast('error', 'This sheet is protected.')
  const [a, b] = cols()
  s.book.structural(sh.id, { axis: 'col', kind: 'delete', at: a, count: b - a + 1 })
  mark()
}

export function hideRows(on = true) {
  const s = st(), sh = s.book.activeSheet
  const [a, b] = rows()
  s.book.transaction(on ? 'Hide rows' : 'Show rows', () => { for (let r = a; r <= Math.min(b, sh.rows - 1); r++) s.book.setAdd(sh.hiddenRows, r, on) })
  mark()
}
export function hideCols(on = true) {
  const s = st(), sh = s.book.activeSheet
  const [a, b] = cols()
  s.book.transaction(on ? 'Hide columns' : 'Show columns', () => { for (let c = a; c <= Math.min(b, sh.cols - 1); c++) s.book.setAdd(sh.hiddenCols, c, on) })
  mark()
}
/** Shows rows and columns hidden next to the selection. */
export function unhideAround() {
  const s = st(), sh = s.book.activeSheet
  const [a, b] = rows(), [c1, c2] = cols()
  s.book.transaction('Show hidden', () => {
    for (let r = Math.max(0, a - 1); r <= b + 1; r++) if (sh.hiddenRows.has(r)) s.book.setAdd(sh.hiddenRows, r, false)
    for (let c = Math.max(0, c1 - 1); c <= c2 + 1; c++) if (sh.hiddenCols.has(c)) s.book.setAdd(sh.hiddenCols, c, false)
  })
}

export function setColWidth(c1: number, c2: number, w: number) {
  const s = st(), sh = s.book.activeSheet
  s.book.transaction('Column width', () => { for (let c = c1; c <= Math.min(c2, MAX_COLS - 1); c++) s.book.mapSet(sh.colW, c, Math.max(8, Math.min(1000, w))) })
  mark()
}
export function setRowHeight(r1: number, r2: number, h: number) {
  const s = st(), sh = s.book.activeSheet
  s.book.transaction('Row height', () => { for (let r = r1; r <= Math.min(r2, MAX_ROWS - 1); r++) s.book.mapSet(sh.rowH, r, Math.max(6, Math.min(1000, h))) })
  mark()
}

let measureCtx: CanvasRenderingContext2D | null = null
/** Width a column needs for its contents, in pixels. */
export function autofitWidth(c: number): number {
  const s = st(), book = s.book, sh = book.activeSheet
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  let max = 30
  const u = book.usedRange(sh.id)
  for (let r = 0; r < Math.min(u.rows, 5000); r++) {
    const cell = sh.cells.get(key(r, c))
    if (!cell && !book.spillOwner(sh.id, r, c)) continue
    const f = book.display(sh.id, r, c)
    if (!f.text || f.text.startsWith(SPARK)) continue
    const font = fontOf(book.styles.get(cell?.s ?? 0), 1)
    measureCtx.font = font
    const lines = f.text.split('\n')
    const w = Math.max(...lines.map((l) => measureCtx!.measureText(l).width)) + 12 + (book.styles.get(cell?.s ?? 0).indent ?? 0) * 9
    if (cell && book.styles.get(cell.s).wrap === true) continue
    max = Math.max(max, w)
  }
  return Math.min(600, Math.ceil(max))
}
export function autofitCols(c1: number, c2: number) {
  const s = st(), sh = s.book.activeSheet
  s.book.transaction('Fit column width', () => { for (let c = c1; c <= c2; c++) s.book.mapSet(sh.colW, c, autofitWidth(c)) })
  mark()
}
export function autofitRows(r1: number, r2: number) {
  const s = st(), sh = s.book.activeSheet
  s.book.transaction('Fit row height', () => { for (let r = r1; r <= r2; r++) s.book.mapSet(sh.rowH, r, undefined) })
  mark()
}

/** Keeps everything above and to the left of the cursor in view while scrolling. */
export function freeze(rowsN: number, colsN: number) {
  const s = st(), sh = s.book.activeSheet
  s.book.transaction('Freeze', () => { s.book.prop(sh, 'frozenRows', rowsN); s.book.prop(sh, 'frozenCols', colsN) })
  mark()
}
export function freezeAtCursor() { const s = st(); freeze(s.sel.r, s.sel.c) }
export function unfreeze() { freeze(0, 0) }

export function toggleGridlines() { const s = st(); s.book.prop(s.book.activeSheet, 'gridlines', !s.book.activeSheet.gridlines); mark() }
export function addRowsAtEnd(n = 1000) { const s = st(), sh = s.book.activeSheet; s.book.prop(sh, 'rows', Math.min(MAX_ROWS, sh.rows + n)) }
export function addColsAtEnd(n = 26) { const s = st(), sh = s.book.activeSheet; s.book.prop(sh, 'cols', Math.min(MAX_COLS, sh.cols + n)) }

export function goto(r: number, c: number) { selectCell(r, c) }
export { dataRect, layoutOf, setSel }
