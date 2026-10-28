import { findEl, mapEls, textOf, type El, type ShapeEl, type TableEl, type Text } from '../model'
import { curSlide, targetEls, useStore } from '../store'
import { editEls, deleteSel } from '../actions'

const S = () => useStore.getState()

export const isTextBox = (e: El): e is ShapeEl => e.type === 'shape' && !e.ph && e.geom === 'rect' && !e.fill && !(e.line && e.line.w > 0)

/** Write edited text back into its shape or table cell (one undo step per editing session). */
export function setElText(id: string, cell: { r: number; c: number } | undefined, text: Text) {
  editEls('Edit text', (list) => mapEls(list, (e) => {
    if (e.id !== id) return e
    if (e.type === 'shape') return { ...e, text: { ...e.text, ...text } }
    if (e.type === 'table' && cell) return { ...e, rows: e.rows.map((r, ri) => (ri === cell.r ? { ...r, cells: r.cells.map((c, ci) => (ci === cell.c ? { ...c, text } : c)) } : r)) } as TableEl
    return e
  }), { key: `text:${id}` })
  if (!cell) growToFit(id)
}

/** Text boxes grow with their text, like boxes on a real slide. */
function growToFit(id: string) {
  requestAnimationFrame(() => {
    const s = S()
    const e = findEl(targetEls(s.deck, s.target, curSlide(s)), id)
    if (!e || !isTextBox(e) || e.text?.fit === 'shrink') return
    const tv = document.querySelector(`[data-el="${id}"] .tv`) as HTMLElement | null
    if (!tv) return
    const ins = e.text?.inset ?? [7.2, 3.6, 7.2, 3.6]
    const want = Math.ceil(tv.scrollHeight + ins[1] + ins[3])
    if (want > e.h + 0.5 || (want < e.h - 0.5 && want > 0 && e.h - want > 2)) {
      editEls('Resize text box', (list) => mapEls(list, (x) => (x.id === id ? { ...x, h: Math.max(want, 20) } : x)), { key: `text:${id}` })
    }
  })
}

export function startEdit(id: string, cell?: { r: number; c: number }) {
  const s = S()
  const e = findEl(targetEls(s.deck, s.target, curSlide(s)), id)
  if (!e || (e.type !== 'shape' && e.type !== 'table') || e.locked) return
  useStore.setState({ editing: { id, cell: e.type === 'table' ? cell ?? { r: 0, c: 0 } : undefined }, sel: [id], tool: { kind: 'select' } })
}

/** Leave text editing; an emptied text box disappears. */
export function stopEdit() {
  const s = S()
  if (!s.editing) return
  const id = s.editing.id
  const e = findEl(targetEls(s.deck, s.target, curSlide(s)), id)
  useStore.setState({ editing: null, editor: null, fmt: null, lastKey: '' })
  if (e && isTextBox(e) && !textOf(e.text).trim()) { useStore.setState({ sel: [id] }); deleteSel() }
}
