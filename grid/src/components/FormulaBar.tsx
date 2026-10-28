import { useEffect, useState } from 'react'
import { cellName, rangeText } from '../engine/address'
import { editStringOf } from '../engine/input'
import { commitEdit, cancelEdit, setEditText, startEdit } from '../actions/edit'
import { selectRange, setSel } from '../actions/nav'
import { single } from '../selection'
import { useBook } from '../hooks'
import { useStore } from '../store'
import { Icon } from './ui'

/** The name box (where you are) and the formula bar (what is in the cell). */
export function FormulaBar() {
  const book = useBook()
  const sel = useStore((s) => s.sel)
  const edit = useStore((s) => s.edit)
  const sh = book.activeSheet
  const g = sel.ranges[sel.ranges.length - 1]
  const label = g.r1 === g.r2 && g.c1 === g.c2 ? cellName(sel.r, sel.c) : rangeText(g)
  const [name, setName] = useState<string | null>(null)
  useEffect(() => setName(null), [label])
  const cell = book.getCell(sh.id, sel.r, sel.c)
  const shown = edit ? edit.text : editStringOf(book.value(sh.id, sel.r, sel.c), cell?.f, book.styleOf(sh.id, sel.r, sel.c).fmt ?? 'General')
  const go = () => {
    const t = (name ?? '').trim()
    if (!t) return setName(null)
    const ref = book.addrToRef(t)
    if (!ref) { useStore.getState().toast('error', `"${t}" is not a cell, a range or a name.`); return setName(null) }
    if (ref.sheet !== sh.id) book.setActive(ref.sheet)
    const r = ref.rect
    if (r.r1 === r.r2 && r.c1 === r.c2) setSel(single(r.r1, r.c1)); else { setSel({ ranges: [r], r: r.r1, c: r.c1, ar: r.r1, ac: r.c1 }); selectRange(r.r1, r.c1, r.r2, r.c2) }
    setName(null)
  }
  return (
    <div className="formula-bar">
      <input className="name-box" aria-label="Name box" value={name ?? label} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={() => setName(null)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go() } if (e.key === 'Escape') { setName(null); (e.target as HTMLElement).blur() } }} />
      <button type="button" className="fx" title="Insert function" aria-label="Insert function" onClick={() => useStore.setState({ dialog: 'function' })}><i>f</i><sub>x</sub></button>
      {edit && <><button type="button" aria-label="Cancel" title="Cancel (Esc)" onClick={cancelEdit}><Icon name="close" size={16} /></button><button type="button" aria-label="Accept" title="Accept (Enter)" onClick={() => commitEdit('down')}><span className="tick">✓</span></button></>}
      <textarea
        className="formula-input"
        aria-label="Formula bar"
        rows={1}
        spellCheck={false}
        value={shown}
        onFocus={(e) => { if (!edit) startEdit({ origin: 'bar', mode: 'edit', caret: shown.length }); void e }}
        onChange={(e) => setEditText(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); commitEdit(e.shiftKey ? 'up' : 'down') }
          else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const t = e.currentTarget, p = t.selectionStart; setEditText(t.value.slice(0, p) + '\n' + t.value.slice(t.selectionEnd), p + 1) }
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
        }}
        onSelect={(e) => { const t = e.currentTarget; const ed = useStore.getState().edit; if (ed && ed.origin === 'bar' && ed.caret !== t.selectionStart && t.value === ed.text && !ed.point) useStore.setState({ edit: { ...ed, caret: t.selectionStart } }) }}
      />
    </div>
  )
}
