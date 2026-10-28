import { useMemo, useState } from 'react'
import { rangeText } from '../engine/address'
import { guessChart, readChart } from '../engine/chartdata'
import type { Chart, ChartKind } from '../engine/model'
import { layoutOf } from '../geometry'
import { currentRegion, dataRect } from '../actions/nav'
import { useBook } from '../hooks'
import { useStore } from '../store'
import { ChartView, PALETTE } from './ChartView'
import { Modal } from './ui'

const close = () => useStore.setState({ dialog: null, dialogArg: undefined })
const KINDS: [ChartKind, string][] = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['donut', 'Doughnut'], ['scatter', 'Scatter'], ['combo', 'Columns and line'], ['histogram', 'Histogram']]

export function ChartDialog() {
  const book = useBook()
  const s = useStore.getState()
  const sh = book.activeSheet
  const id = s.dialogArg as string | undefined
  const existing = id ? sh.charts.find((c) => c.id === id) : undefined
  const initial = useMemo<Chart>(() => {
    if (existing) return existing
    const g0 = s.sel.ranges.at(-1)!
    const g = g0.r1 === g0.r2 && g0.c1 === g0.c2 ? currentRegion(s.sel.r, s.sel.c) : dataRect(g0)
    const L = layoutOf(book, sh)
    return {
      id: Math.random().toString(36).slice(2, 9), kind: 'column', range: `${sh.name}!${rangeText(g)}`, ...guessChart(book, sh.id, g), title: '', xTitle: '', yTitle: '',
      legend: 'right', stacked: false, percent: false, smooth: false, points: false, gridlines: true,
      x: Math.round(L.cols.pos(g.c2 + 1) + 24), y: Math.round(L.rows.pos(g.r1)), w: 480, h: 300,
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [c, setC] = useState<Chart>(initial)
  const up = (p: Partial<Chart>) => setC({ ...c, ...p })
  const data = useMemo(() => readChart(book, c), [book, c])
  const colors = c.colors?.length ? c.colors : PALETTE
  const count = c.kind === 'pie' || c.kind === 'donut' ? 0 : data.series.length
  const save = () => {
    book.transaction(existing ? 'Edit chart' : 'Insert chart', () => book.prop(sh, 'charts', existing ? sh.charts.map((x) => (x.id === c.id ? c : x)) : [...sh.charts, c]))
    useStore.setState({ file: { ...s.file, dirty: true }, object: c.id })
    close()
  }
  return (
    <Modal title={existing ? 'Edit chart' : 'Insert chart'} onClose={close} wide actions={<>{existing && <button className="ghost danger" onClick={() => { book.transaction('Delete chart', () => book.prop(sh, 'charts', sh.charts.filter((x) => x.id !== c.id))); close() }}>Delete chart</button>}<button className="ghost" onClick={close}>Cancel</button><button className="primary" onClick={save}>{existing ? 'Update' : 'Insert'}</button></>}>
      <div className="chart-dialog">
        <div className="chart-form">
          <label>Chart type<select value={c.kind} onChange={(e) => up({ kind: e.target.value as ChartKind })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Data range<input value={c.range} onChange={(e) => up({ range: e.target.value })} aria-label="Data range" /></label>
          <div className="row">
            <label className="inline"><input type="checkbox" checked={c.headerRow} onChange={(e) => up({ headerRow: e.target.checked })} />First row is series names</label>
            <label className="inline"><input type="checkbox" checked={c.headerCol} onChange={(e) => up({ headerCol: e.target.checked })} />First column is categories</label>
            <label className="inline"><input type="checkbox" checked={c.byRows} onChange={(e) => up({ byRows: e.target.checked })} />Switch rows and columns</label>
          </div>
          <label>Title<input value={c.title} onChange={(e) => up({ title: e.target.value })} /></label>
          {c.kind !== 'pie' && c.kind !== 'donut' && (
            <>
              <div className="row"><label>Horizontal axis title<input value={c.xTitle} onChange={(e) => up({ xTitle: e.target.value })} /></label><label>Vertical axis title<input value={c.yTitle} onChange={(e) => up({ yTitle: e.target.value })} /></label></div>
              <div className="row">
                <label className="inline"><input type="checkbox" checked={c.stacked} onChange={(e) => up({ stacked: e.target.checked, percent: e.target.checked ? c.percent : false })} />Stacked</label>
                <label className="inline"><input type="checkbox" checked={c.percent} onChange={(e) => up({ percent: e.target.checked, stacked: e.target.checked || c.stacked })} />100%</label>
                <label className="inline"><input type="checkbox" checked={c.smooth} onChange={(e) => up({ smooth: e.target.checked })} />Smooth lines</label>
                <label className="inline"><input type="checkbox" checked={c.points} onChange={(e) => up({ points: e.target.checked })} />Show points</label>
                <label className="inline"><input type="checkbox" checked={c.gridlines} onChange={(e) => up({ gridlines: e.target.checked })} />Gridlines</label>
              </div>
            </>
          )}
          <label>Legend<select value={c.legend} onChange={(e) => up({ legend: e.target.value as Chart['legend'] })}>{['right', 'bottom', 'top', 'left', 'none'].map((l) => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}</select></label>
          {count > 0 && count <= 8 && (
            <div className="row">{data.series.map((sr, i) => <label key={i} className="inline" title={sr.name}><input type="color" aria-label={`Colour of ${sr.name}`} value={colors[i % colors.length]} onChange={(e) => { const cs = [...colors]; cs[i] = e.target.value; up({ colors: cs }) }} />{sr.name.slice(0, 14)}</label>)}</div>
          )}
        </div>
        <div className="chart-preview"><ChartView chart={c} data={data} width={440} height={300} /></div>
      </div>
    </Modal>
  )
}
