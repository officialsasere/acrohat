import { mapEls, type Fill, type Para, type TableCell, type TableEl } from './model'
import { editEls, selected } from './actions'
import { useStore } from './store'
import { emptyCell } from './insert'

const S = () => useStore.getState()
const table = (): TableEl | undefined => { const t = selected()[0]; return t && t.type === 'table' && selected().length === 1 ? t : undefined }
const cellRange = (t: TableEl) => { const c = S().cellSel; return c && c.id === t.id ? c : { id: t.id, r1: 0, c1: 0, r2: t.rows.length - 1, c2: t.cols.length - 1 } }
const edit = (label: string, fn: (t: TableEl) => TableEl) => { const t = table(); if (!t) return; editEls(label, (l) => mapEls(l, (x) => (x.id === t.id && x.type === 'table' ? fn(x) : x))) }
const total = (t: TableEl) => ({ ...t, w: t.cols.reduce((a, b) => a + b, 0), h: t.rows.reduce((a, r) => a + r.h, 0) })

/** Row and column indexes a span passes over, so inserting inside a merged cell stretches it. */
function fixSpans(t: TableEl): TableEl {
  const rows = t.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }))
  return { ...t, rows }
}

export const tableOps = {
  addRow(where: 'above' | 'below') {
    const t = table(); if (!t) return
    const r = cellRange(t)
    const at = where === 'above' ? r.r1 : r.r2 + 1
    const ref = t.rows[Math.min(at, t.rows.length - 1)]
    edit('Insert row', (x) => total(fixSpans({ ...x, rows: [...x.rows.slice(0, at), { h: ref.h, cells: Array.from({ length: x.cols.length }, emptyCell) }, ...x.rows.slice(at)] })))
  },
  addCol(where: 'left' | 'right') {
    const t = table(); if (!t) return
    const r = cellRange(t)
    const at = where === 'left' ? r.c1 : r.c2 + 1
    const w = t.cols[Math.min(at, t.cols.length - 1)]
    edit('Insert column', (x) => total({ ...x, cols: [...x.cols.slice(0, at), w, ...x.cols.slice(at)], rows: x.rows.map((row) => ({ ...row, cells: [...row.cells.slice(0, at), emptyCell(), ...row.cells.slice(at)] })) }))
  },
  deleteRows() {
    const t = table(); if (!t) return
    const r = cellRange(t)
    if (r.r2 - r.r1 + 1 >= t.rows.length) { S().toast('info', 'A table needs at least one row. Delete the table instead.'); return }
    edit('Delete row', (x) => total({ ...x, rows: x.rows.filter((_, i) => i < r.r1 || i > r.r2) }))
    useStore.setState({ cellSel: null })
  },
  deleteCols() {
    const t = table(); if (!t) return
    const r = cellRange(t)
    if (r.c2 - r.c1 + 1 >= t.cols.length) { S().toast('info', 'A table needs at least one column. Delete the table instead.'); return }
    edit('Delete column', (x) => total({ ...x, cols: x.cols.filter((_, i) => i < r.c1 || i > r.c2), rows: x.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i < r.c1 || i > r.c2) })) }))
    useStore.setState({ cellSel: null })
  },
  merge() {
    const t = table(); if (!t) return
    const r = cellRange(t)
    if (r.r1 === r.r2 && r.c1 === r.c2) return S().toast('info', 'Select two or more cells first (drag across them).')
    edit('Merge cells', (x) => {
      const keep = x.rows[r.r1].cells[r.c1]
      const paras: Para[] = []
      for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) { const c = x.rows[i].cells[j]; if (c.text.paras.some((p) => p.runs.length) && !(i === r.r1 && j === r.c1)) paras.push(...c.text.paras); else if (i === r.r1 && j === r.c1) paras.unshift(...c.text.paras.filter((p) => p.runs.length)) }
      return { ...x, rows: x.rows.map((row, i) => ({ ...row, cells: row.cells.map((c, j): TableCell => {
        if (i < r.r1 || i > r.r2 || j < r.c1 || j > r.c2) return c
        if (i === r.r1 && j === r.c1) return { ...keep, span: { r: r.r2 - r.r1 + 1, c: r.c2 - r.c1 + 1 }, text: { ...keep.text, paras: paras.length ? paras : [{ runs: [] }] } }
        return { ...emptyCell(), covered: true }
      }) })) }
    })
  },
  split() {
    const t = table(); if (!t) return
    const r = cellRange(t)
    edit('Split cells', (x) => ({ ...x, rows: x.rows.map((row, i) => ({ ...row, cells: row.cells.map((c, j) => {
      if (i < r.r1 || i > r.r2 || j < r.c1 || j > r.c2) return c
      const { span, covered, ...rest } = c; void span; void covered
      return rest as TableCell
    }) })) }))
  },
  fill(f: Fill | undefined) {
    const t = table(); if (!t) return
    const r = cellRange(t)
    edit('Cell fill', (x) => ({ ...x, rows: x.rows.map((row, i) => ({ ...row, cells: row.cells.map((c, j) => (i >= r.r1 && i <= r.r2 && j >= r.c1 && j <= r.c2 ? { ...c, fill: f } : c)) })) }))
  },
  vAlign(v: 'top' | 'middle' | 'bottom') {
    const t = table(); if (!t) return
    const r = cellRange(t)
    edit('Cell alignment', (x) => ({ ...x, rows: x.rows.map((row, i) => ({ ...row, cells: row.cells.map((c, j) => (i >= r.r1 && i <= r.r2 && j >= r.c1 && j <= r.c2 ? { ...c, v } : c)) })) }))
  },
  style(p: Partial<TableEl['style']>) { edit('Table style', (x) => ({ ...x, style: { ...x.style, ...p } })) },
  evenRows() { edit('Distribute rows', (x) => ({ ...x, rows: x.rows.map((r) => ({ ...r, h: x.h / x.rows.length })) })) },
  evenCols() { edit('Distribute columns', (x) => ({ ...x, cols: x.cols.map(() => x.w / x.cols.length) })) },
}
