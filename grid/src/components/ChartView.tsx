import { useMemo } from 'react'
import type { Chart } from '../engine/model'
import type { ChartData } from '../engine/chartdata'

export const PALETTE = ['#8a5a36', '#4f7cac', '#6a994e', '#d4a373', '#bc4749', '#9b72aa', '#e0a458', '#2a9d8f', '#7d5ba6', '#c08552']

/** Round numbers for an axis: 0, 50, 100, 150 rather than 0, 47.3, 94.6. */
export function niceTicks(lo: number, hi: number, n = 5): { ticks: number[]; lo: number; hi: number } {
  if (lo === hi) { lo = lo === 0 ? 0 : Math.min(lo, 0); hi = hi === 0 ? 1 : Math.max(hi, 0) || 1 }
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = a; v <= b + step / 1000; v += step) ticks.push(Math.round(v / step) * step)
  return { ticks, lo: a, hi: b }
}
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : String(+n.toFixed(4)))

interface Props { chart: Chart; data: ChartData; width: number; height: number; dark?: boolean }

/** Draws one chart as SVG. */
export function ChartView({ chart, data, width: W, height: H }: Props) {
  const colors = chart.colors?.length ? chart.colors : PALETTE
  const body = useMemo(() => draw(chart, data, W, H, colors), [chart, data, W, H, colors])
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title || `${chart.kind} chart`} xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: 'Carlito, Calibri, system-ui, sans-serif' }}>{body}</svg>
}

function draw(chart: Chart, data: ChartData, W: number, H: number, colors: string[]) {
  const pie = chart.kind === 'pie' || chart.kind === 'donut'
  const series = data.series
  const top = chart.title ? 34 : 12
  const legendPos = chart.legend === 'none' || (series.length < 2 && !pie) ? 'none' : chart.legend
  const showLegend = legendPos !== 'none'
  const legendItems = pie ? data.categories.map((c, i) => ({ name: c, color: colors[i % colors.length] })) : series.map((s, i) => ({ name: s.name, color: colors[i % colors.length] }))
  const legendW = showLegend && (legendPos === 'right' || legendPos === 'left') ? Math.min(150, 24 + Math.max(...legendItems.map((l) => l.name.length)) * 6.5) : 0
  const legendH = showLegend && (legendPos === 'top' || legendPos === 'bottom') ? 22 : 0
  const el: React.ReactNode[] = []
  el.push(<rect key="bg" width={W} height={H} fill="#fff" rx="6" />)
  if (chart.title) el.push(<text key="t" x={W / 2} y={22} textAnchor="middle" fontSize="15" fontWeight="700" fill="#2b1d14">{chart.title}</text>)

  let px = 8 + (legendPos === 'left' ? legendW : 0), pw = W - 16 - legendW, py = top + (legendPos === 'top' ? legendH : 0), ph = H - top - 10 - legendH
  if (!pie) { px += 42 + (chart.yTitle ? 16 : 0); pw -= 50 + (chart.yTitle ? 16 : 0); ph -= 28 + (chart.xTitle ? 16 : 0) }

  if (showLegend) {
    const items = legendItems.slice(0, 40)
    if (legendPos === 'right' || legendPos === 'left') {
      const lx = legendPos === 'right' ? W - legendW : 8
      items.forEach((l, i) => { el.push(<g key={'lg' + i}><rect x={lx} y={top + 4 + i * 18} width="10" height="10" rx="2" fill={l.color} /><text x={lx + 15} y={top + 13 + i * 18} fontSize="11.5" fill="#4a3a2c">{l.name.length > 20 ? l.name.slice(0, 19) + '…' : l.name}</text></g>) })
    } else {
      let x = 12
      const y = legendPos === 'top' ? top + 4 : H - 16
      items.forEach((l, i) => { el.push(<g key={'lg' + i}><rect x={x} y={y} width="10" height="10" rx="2" fill={l.color} /><text x={x + 14} y={y + 9} fontSize="11.5" fill="#4a3a2c">{l.name}</text></g>); x += 24 + l.name.length * 6.5 })
    }
  }

  if (pie) {
    const s = series[0]
    const vals = (s?.values ?? []).map((v) => Math.max(0, v ?? 0))
    const total = vals.reduce((a, b) => a + b, 0)
    const cx = px + pw / 2, cy = py + ph / 2, r = Math.max(10, Math.min(pw, ph) / 2 - 8)
    if (!total) { el.push(<text key="e" x={cx} y={cy} textAnchor="middle" fill="#8a7d6d">No data</text>); return el }
    let a0 = -Math.PI / 2
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const inner = chart.kind === 'donut' ? r * 0.55 : 0
      const p = (rr: number, a: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
      const d = v / total >= 0.9999
        ? `M ${cx - r},${cy} A ${r},${r} 0 1 1 ${cx + r},${cy} A ${r},${r} 0 1 1 ${cx - r},${cy} Z`
        : `M ${p(r, a0)} A ${r},${r} 0 ${large} 1 ${p(r, a1)} ${inner ? `L ${p(inner, a1)} A ${inner},${inner} 0 ${large} 0 ${p(inner, a0)}` : `L ${cx},${cy}`} Z`
      el.push(<path key={'s' + i} d={d} fill={colors[i % colors.length]} stroke="#fff" strokeWidth="1.5" />)
      if (v / total > 0.04) { const am = (a0 + a1) / 2, lr = inner ? (r + inner) / 2 : r * 0.62; el.push(<text key={'l' + i} x={cx + lr * Math.cos(am)} y={cy + lr * Math.sin(am) + 4} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">{Math.round((v / total) * 100)}%</text>) }
      a0 = a1
    })
    return el
  }

  const n = Math.max(data.categories.length, ...series.map((s) => s.values.length))
  if (!n || !series.length) { el.push(<text key="e" x={W / 2} y={H / 2} textAnchor="middle" fill="#8a7d6d">No data to show</text>); return el }

  if (chart.kind === 'scatter') {
    const pts = series.map((s) => s.values.map((v, i) => ({ x: s.xs?.[i] ?? i + 1, y: v })).filter((p) => p.y !== null) as { x: number; y: number }[])
    const xs = pts.flat().map((p) => p.x), ys = pts.flat().map((p) => p.y)
    const xt = niceTicks(Math.min(...xs), Math.max(...xs)), yt = niceTicks(Math.min(0, ...ys), Math.max(...ys))
    const X = (v: number) => px + ((v - xt.lo) / (xt.hi - xt.lo || 1)) * pw, Y = (v: number) => py + ph - ((v - yt.lo) / (yt.hi - yt.lo || 1)) * ph
    axes(el, chart, px, py, pw, ph, yt, Y, xt.ticks.map((t) => ({ label: short(t), x: X(t) })))
    pts.forEach((s, i) => s.forEach((p, j) => el.push(<circle key={`p${i}-${j}`} cx={X(p.x)} cy={Y(p.y)} r="4" fill={colors[i % colors.length]} fillOpacity="0.85" />)))
    return el
  }

  const horizontal = chart.kind === 'bar'
  const isBar = chart.kind === 'column' || chart.kind === 'bar' || chart.kind === 'histogram' || chart.kind === 'combo'
  const stacked = chart.stacked || chart.percent
  // value range
  let lo = 0, hi = 0
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0
      for (const s of series) { const v = s.values[i] ?? 0; if (v >= 0) pos += v; else neg += v }
      if (chart.percent) { pos = 100; neg = 0 }
      hi = Math.max(hi, pos); lo = Math.min(lo, neg)
    }
  } else {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null)
    lo = Math.min(...all, isBar || chart.kind === 'area' ? 0 : Infinity); hi = Math.max(...all, isBar || chart.kind === 'area' ? 0 : -Infinity)
    if (!isFinite(lo)) lo = 0
  }
  const yt = niceTicks(lo, hi)
  const catW = (horizontal ? ph : pw) / n
  const Y = (v: number) => (horizontal ? px + ((v - yt.lo) / (yt.hi - yt.lo || 1)) * pw : py + ph - ((v - yt.lo) / (yt.hi - yt.lo || 1)) * ph)
  const labels = data.categories.slice(0, n)
  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horizontal ? ph : pw) / 56))))

  if (horizontal) {
    // gridlines vertical, categories on the left
    yt.ticks.forEach((t, i) => { const x = Y(t); el.push(<line key={'g' + i} x1={x} x2={x} y1={py} y2={py + ph} stroke="#ece4d6" />, <text key={'gt' + i} x={x} y={py + ph + 15} textAnchor="middle" fontSize="11" fill="#6b5a48">{short(t)}</text>) })
    labels.forEach((l, i) => { if (i % step === 0) el.push(<text key={'c' + i} x={px - 6} y={py + (i + 0.5) * catW + 4} textAnchor="end" fontSize="11" fill="#6b5a48">{l.length > 12 ? l.slice(0, 11) + '…' : l}</text>) })
  } else {
    axes(el, chart, px, py, pw, ph, yt, Y, labels.map((l, i) => ({ label: l.length > 10 && catW < 60 ? l.slice(0, 9) + '…' : l, x: px + (i + 0.5) * catW, skip: i % step !== 0 })))
  }

  const groupW = catW * 0.78
  series.forEach((s, si) => {
    const color = colors[si % colors.length]
    if (isBar && !(chart.kind === 'combo' && si > 0)) {
      s.values.forEach((v, i) => {
        if (v === null) return
        let a = 0, b = v
        if (stacked) {
          let before = 0
          for (let k = 0; k < si; k++) before += series[k].values[i] ?? 0
          const total = chart.percent ? series.reduce((t, q) => t + Math.abs(q.values[i] ?? 0), 0) || 1 : 1
          a = chart.percent ? (before / total) * 100 : before; b = chart.percent ? ((before + v) / total) * 100 : before + v
        }
        const bw = stacked ? groupW : groupW / series.length
        const off = stacked ? (catW - groupW) / 2 : (catW - groupW) / 2 + si * bw
        const lo2 = Math.min(a, b), hi2 = Math.max(a, b)
        if (horizontal) el.push(<rect key={`b${si}-${i}`} x={Y(lo2)} y={py + i * catW + off} width={Math.max(1, Y(hi2) - Y(lo2))} height={bw - 1} fill={color} rx="1.5" />)
        else el.push(<rect key={`b${si}-${i}`} x={px + i * catW + off} y={Y(hi2)} width={bw - 1} height={Math.max(1, Y(lo2) - Y(hi2))} fill={color} rx="1.5" />)
      })
    } else {
      const X = (i: number) => px + (i + 0.5) * catW
      const pts = s.values.map((v, i) => (v === null ? null : { x: X(i), y: Y(v), v }))
      const path = (smooth: boolean) => {
        let d = ''
        pts.forEach((p, i) => {
          if (!p) return
          const prev = pts[i - 1]
          if (!prev) d += `M ${p.x},${p.y}`
          else if (smooth) { const mx = (prev.x + p.x) / 2; d += ` C ${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}` }
          else d += ` L ${p.x},${p.y}`
        })
        return d
      }
      if (chart.kind === 'area') {
        let base = Y(Math.max(yt.lo, 0))
        const first = pts.find(Boolean), last = [...pts].reverse().find(Boolean)
        if (first && last) el.push(<path key={'a' + si} d={`${path(chart.smooth)} L ${last.x},${base} L ${first.x},${base} Z`} fill={color} fillOpacity="0.35" stroke="none" />)
        base = 0
      }
      el.push(<path key={'l' + si} d={path(chart.smooth)} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" />)
      if (chart.points || chart.kind === 'line' || chart.kind === 'combo') pts.forEach((p, i) => { if (p && n <= 60) el.push(<circle key={`pt${si}-${i}`} cx={p.x} cy={p.y} r="3.2" fill="#fff" stroke={color} strokeWidth="2" />) })
    }
  })
  return el
}

function axes(el: React.ReactNode[], chart: Chart, px: number, py: number, pw: number, ph: number, yt: { ticks: number[] }, Y: (v: number) => number, xl: { label: string; x: number; skip?: boolean }[]) {
  yt.ticks.forEach((t, i) => {
    const y = Y(t)
    if (chart.gridlines !== false) el.push(<line key={'g' + i} x1={px} x2={px + pw} y1={y} y2={y} stroke="#ece4d6" />)
    el.push(<text key={'gt' + i} x={px - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#6b5a48">{chart.percent ? `${short(t)}%` : short(t)}</text>)
  })
  el.push(<line key="axis" x1={px} x2={px + pw} y1={Y(0 >= yt.ticks[0] ? 0 : yt.ticks[0])} y2={Y(0 >= yt.ticks[0] ? 0 : yt.ticks[0])} stroke="#b8a88f" />)
  xl.forEach((l, i) => { if (!l.skip) el.push(<text key={'x' + i} x={l.x} y={py + ph + 16} textAnchor="middle" fontSize="11" fill="#6b5a48">{l.label}</text>) })
  if (chart.xTitle) el.push(<text key="xt" x={px + pw / 2} y={py + ph + 34} textAnchor="middle" fontSize="12" fill="#4a3a2c">{chart.xTitle}</text>)
  if (chart.yTitle) el.push(<text key="yt" transform={`translate(${px - 44}, ${py + ph / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="#4a3a2c">{chart.yTitle}</text>)
}
