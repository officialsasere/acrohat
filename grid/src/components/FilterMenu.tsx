import { useMemo, useState } from 'react'
import { filterValues, setFilterCol, sortRange } from '../actions/data'
import { useStore } from '../store'

/** The drop-down under a filter button: sort, search, pick values, or set a condition. */
export function FilterMenu({ col, box, onClose }: { col: number; box: { x: number; y: number; w: number; h: number }; onClose: () => void }) {
  const book = useStore((s) => s.book)
  const sh = book.activeSheet
  const f = sh.filter!
  const values = useMemo(() => filterValues(col), [col, book.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = new Set(f.cols[col]?.hide ?? [])
  const [off, setOff] = useState<Set<string>>(new Set(hidden))
  const [q, setQ] = useState('')
  const [op, setOp] = useState(f.cols[col]?.cond?.op ?? '')
  const [v1, setV1] = useState(f.cols[col]?.cond?.v1 ?? '')
  const [v2, setV2] = useState(f.cols[col]?.cond?.v2 ?? '')
  const shown = values.filter((v) => v.text.toLowerCase().includes(q.toLowerCase()))
  const apply = () => {
    setFilterCol(col, { hide: [...off], cond: op ? { op, v1, v2 } : undefined })
    onClose()
  }
  const sortBy = (asc: boolean) => { sortRange(f.range, [{ col, asc }], true); onClose() }
  const toggle = (t: string) => { const n = new Set(off); if (n.has(t)) n.delete(t); else n.add(t); setOff(n) }
  const needsTwo = op === 'between' || op === 'notBetween'
  return (
    <>
      <div className="popup-shield" onPointerDown={onClose} />
      <div className="filter-menu" style={{ left: Math.max(0, box.x + box.w - 260), top: box.y + box.h }} role="dialog" aria-label="Filter">
        <button type="button" className="mi" onClick={() => sortBy(true)}>Sort A → Z</button>
        <button type="button" className="mi" onClick={() => sortBy(false)}>Sort Z → A</button>
        <div className="sep" />
        <label className="fm-label">Filter by condition</label>
        <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Condition">
          <option value="">None</option>
          <option value="empty">Is empty</option><option value="notEmpty">Is not empty</option>
          <option value="contains">Text contains</option><option value="notContains">Text does not contain</option><option value="begins">Text starts with</option><option value="ends">Text ends with</option>
          <option value="=">Equals</option><option value="<>">Does not equal</option>
          <option value=">">Greater than</option><option value=">=">Greater than or equal</option><option value="<">Less than</option><option value="<=">Less than or equal</option>
          <option value="between">Is between</option><option value="notBetween">Is not between</option>
        </select>
        {op && !['empty', 'notEmpty'].includes(op) && <input value={v1} onChange={(e) => setV1(e.target.value)} placeholder="Value" aria-label="Value" />}
        {needsTwo && <input value={v2} onChange={(e) => setV2(e.target.value)} placeholder="and" aria-label="Second value" />}
        <div className="sep" />
        <label className="fm-label">Filter by values</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search values" />
        <div className="fm-actions">
          <button type="button" className="link-btn" onClick={() => setOff(new Set())}>Select all</button>
          <button type="button" className="link-btn" onClick={() => setOff(new Set(values.map((v) => v.text)))}>Clear</button>
        </div>
        <div className="fm-list">
          {shown.map((v) => (
            <label key={v.text}><input type="checkbox" checked={!off.has(v.text)} onChange={() => toggle(v.text)} />{v.text === '' ? '(Blanks)' : v.text}<span>{v.count}</span></label>
          ))}
        </div>
        <div className="fm-foot">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={apply}>OK</button>
        </div>
      </div>
    </>
  )
}
