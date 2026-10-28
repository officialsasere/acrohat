import { css, type ChartEl, type Theme, type ThemeColor } from '../model'
import { fontFamily } from '../richtext'

const ORDER: ThemeColor[] = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
export const seriesColor = (c: ChartEl, i: number, th: Theme) => css(c.series[i]?.color ?? `@${ORDER[i % 6]}`, th)

/** "Nice" axis ticks covering [lo, hi]. */
export function ticks(lo: number, hi: number, n = 5): { min: number; max: number; step: number; values: number[] } {
  if (lo === hi) { hi = lo + 1 }
  const raw = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step
  const values: number[] = []
  for (let v = min; v <= max + step / 2; v += step) values.push(+v.toFixed(10))
  return { min, max, step, values }
}
const fmt = (v: number) => Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : String(+v.toFixed(2))

export function ChartView({ chart, th }: { chart: ChartEl; th: Theme }) {
  const { w, h } = chart
  const font = fontFamily('+body', th), fg = css('@text2', th), ink = css('@text', th)
  const FS = Math.max(9, Math.min(14, Math.min(w, h) / 24))
  const padT = chart.title ? FS * 2.6 : FS, legendH = FS * 2
  const legendOn = chart.legend !== 'none' && chart.series.length > (chart.kind === 'pie' || chart.kind === 'doughnut' ? 0 : 1) - 0
  const pieLike = chart.kind === 'pie' || chart.kind === 'doughnut'
  const names = pieLike ? chart.cats : chart.series.map((s) => s.name)
  const colorAt = (i: number) => (pieLike ? css(chart.series[0]?.color && chart.cats.length === 1 ? chart.series[0].color : `@${ORDER[i % 6]}`, th) : seriesColor(chart, i, th))
  const legendW = legendOn && chart.legend === 'right' ? Math.min(w * 0.3, Math.max(...names.map((n) => n.length), 4) * FS * 0.62 + FS * 2.4) : 0
  const L = legendOn && chart.legend === 'right' ? 0 : 0
  void L
  const top = padT + (legendOn && chart.legend === 'top' ? legendH : 0)
  const bottomPad = legendOn && chart.legend === 'bottom' ? legendH : 0
  const horiz = chart.kind === 'bar'
  const yTitleW = chart.yTitle ? FS * 1.8 : 0, xTitleH = chart.xTitle ? FS * 1.8 : 0

  const legend = legendOn && (
    <g fontFamily={font} fontSize={FS} fill={ink}>
      {chart.legend === 'right'
        ? names.map((n, i) => <g key={i} transform={`translate(${w - legendW + FS * 0.4},${top + i * FS * 1.6})`}><rect width={FS * 0.9} height={FS * 0.9} y={-FS * 0.8} rx="2" fill={colorAt(i)} /><text x={FS * 1.3}>{n}</text></g>)
        : (() => { const widths = names.map((n) => n.length * FS * 0.6 + FS * 2.2), total = widths.reduce((a, b) => a + b, 0); let x = (w - total) / 2; const y = chart.legend === 'top' ? padT + FS * 1.1 : h - FS * 0.6; return names.map((n, i) => { const g = <g key={i} transform={`translate(${x},${y})`}><rect width={FS * 0.9} height={FS * 0.9} y={-FS * 0.8} rx="2" fill={colorAt(i)} /><text x={FS * 1.3}>{n}</text></g>; x += widths[i]; return g }) })()}
    </g>
  )
  const title = chart.title && <text x={w / 2} y={FS * 1.7} textAnchor="middle" fontFamily={font} fontSize={FS * 1.3} fontWeight="700" fill={ink}>{chart.title}</text>

  if (pieLike) {
    const vals = (chart.series[0]?.vals ?? []).map((v) => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1
    const cx = (w - legendW) / 2, cy = top + (h - top - bottomPad) / 2, r = Math.max(8, Math.min(cx, (h - top - bottomPad) / 2) - FS * 1.6)
    const inner = chart.kind === 'doughnut' ? r * 0.55 : 0
    let a = -Math.PI / 2
    return (
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        {title}
        {vals.map((v, i) => {
          const da = (v / total) * Math.PI * 2, a2 = a + da
          const p = (ang: number, rr: number) => `${cx + Math.cos(ang) * rr} ${cy + Math.sin(ang) * rr}`
          const large = da > Math.PI ? 1 : 0
          const d = vals.length === 1 || da >= Math.PI * 2 - 1e-6
            ? `M${cx - r} ${cy}A${r} ${r} 0 1 1 ${cx + r} ${cy}A${r} ${r} 0 1 1 ${cx - r} ${cy}${inner ? `M${cx - inner} ${cy}A${inner} ${inner} 0 1 0 ${cx + inner} ${cy}A${inner} ${inner} 0 1 0 ${cx - inner} ${cy}` : ''}Z`
            : inner ? `M${p(a, r)}A${r} ${r} 0 ${large} 1 ${p(a2, r)}L${p(a2, inner)}A${inner} ${inner} 0 ${large} 0 ${p(a, inner)}Z` : `M${cx} ${cy}L${p(a, r)}A${r} ${r} 0 ${large} 1 ${p(a2, r)}Z`
          const mid = a + da / 2
          const node = (
            <g key={i}>
              <path d={d} fill={colorAt(i)} stroke={css('@bg', th)} strokeWidth="1.5" fillRule="evenodd" />
              {chart.labels && v > 0 && da > 0.15 && <text x={cx + Math.cos(mid) * (inner ? (r + inner) / 2 : r * 0.65)} y={cy + Math.sin(mid) * (inner ? (r + inner) / 2 : r * 0.65)} textAnchor="middle" dominantBaseline="middle" fontFamily={font} fontSize={FS} fill="#fff" fontWeight="700">{Math.round((v / total) * 100)}%</text>}
            </g>
          )
          a = a2
          return node
        })}
        {legend}
      </svg>
    )
  }

  if (chart.kind === 'radar') {
    const n = Math.max(chart.cats.length, 3)
    const cx = (w - legendW) / 2, cy = top + (h - top - bottomPad) / 2, r = Math.max(10, Math.min(cx, (h - top - bottomPad) / 2) - FS * 2)
    const max = ticks(0, Math.max(1, ...chart.series.flatMap((s) => s.vals))).max
    const pt = (i: number, v: number): [number, number] => { const ang = -Math.PI / 2 + (i * Math.PI * 2) / n; return [cx + Math.cos(ang) * r * (v / max), cy + Math.sin(ang) * r * (v / max)] }
    return (
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        {title}
        {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} points={Array.from({ length: n }, (_, i) => pt(i, max * k).join(',')).join(' ')} fill="none" stroke={css('@bg2', th)} strokeWidth="1" />)}
        {Array.from({ length: n }, (_, i) => <g key={i}><line x1={cx} y1={cy} x2={pt(i, max)[0]} y2={pt(i, max)[1]} stroke={css('@bg2', th)} /><text x={pt(i, max * 1.12)[0]} y={pt(i, max * 1.12)[1]} fontFamily={font} fontSize={FS} fill={fg} textAnchor="middle" dominantBaseline="middle">{chart.cats[i] ?? ''}</text></g>)}
        {chart.series.map((s, si) => <polygon key={si} points={Array.from({ length: n }, (_, i) => pt(i, s.vals[i] ?? 0).join(',')).join(' ')} fill={seriesColor(chart, si, th)} fillOpacity="0.25" stroke={seriesColor(chart, si, th)} strokeWidth="2" />)}
        {legend}
      </svg>
    )
  }

  // Cartesian charts
  const plotL = FS * 3.2 + yTitleW + (horiz ? Math.max(0, ...chart.cats.map((c) => c.length)) * FS * 0.35 : 0)
  const plot = { x: plotL, y: top, w: w - plotL - legendW - FS, h: h - top - bottomPad - FS * 2.2 - xTitleH }
  const n = Math.max(chart.cats.length, ...chart.series.map((s) => s.vals.length), 1)
  const scatter = chart.kind === 'scatter'
  const stacked = chart.grouping !== 'clustered' && (chart.kind === 'column' || chart.kind === 'bar' || chart.kind === 'area')
  const pct = chart.grouping === 'percent' && stacked
  let lo = 0, hi = 1
  if (pct) { hi = 100 }
  else if (stacked) {
    for (let i = 0; i < n; i++) { let pos = 0, neg = 0; for (const s of chart.series) { const v = s.vals[i] ?? 0; if (v >= 0) pos += v; else neg += v } hi = Math.max(hi, pos); lo = Math.min(lo, neg) }
  } else {
    const all = chart.series.flatMap((s) => s.vals)
    if (all.length) { hi = Math.max(...all, scatter ? -Infinity : 0); lo = Math.min(...all, scatter ? Infinity : 0) }
  }
  const yt = ticks(lo, hi)
  const xs = scatter ? chart.series.flatMap((s) => s.xs ?? s.vals.map((_, i) => i + 1)) : []
  const xt = scatter ? ticks(Math.min(...xs, 0), Math.max(...xs, 1)) : null
  const vAxis = (v: number) => (horiz ? plot.x + ((v - yt.min) / (yt.max - yt.min)) * plot.w : plot.y + plot.h - ((v - yt.min) / (yt.max - yt.min)) * plot.h)
  const band = (horiz ? plot.h : plot.w) / n
  const catPos = (i: number) => (horiz ? plot.y + band * i : plot.x + band * i)
  const totals = Array.from({ length: n }, (_, i) => chart.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1)
  const val = (si: number, i: number) => { const v = chart.series[si].vals[i] ?? 0; return pct ? (v / totals[i]) * 100 : v }

  const bars: React.ReactNode[] = []
  if (chart.kind === 'column' || chart.kind === 'bar') {
    const k = chart.series.length
    const gap = band * 0.25
    const bw = stacked ? band - gap * 2 : (band - gap * 2) / k
    for (let i = 0; i < n; i++) {
      let pos = 0, neg = 0
      chart.series.forEach((_, si) => {
        const v = val(si, i)
        let a: number, b: number
        if (stacked) { if (v >= 0) { a = pos; pos += v; b = pos } else { a = neg; neg += v; b = neg } } else { a = 0; b = v }
        const p1 = vAxis(Math.min(a, b)), p2 = vAxis(Math.max(a, b))
        const off = catPos(i) + gap + (stacked ? 0 : bw * si)
        const rect = horiz ? { x: Math.min(p1, p2), y: off, width: Math.abs(p2 - p1), height: bw } : { x: off, y: Math.min(p1, p2), width: bw, height: Math.abs(p2 - p1) }
        bars.push(<rect key={`${si}-${i}`} {...rect} fill={seriesColor(chart, si, th)} />)
        if (chart.labels && Math.abs(p2 - p1) > FS) bars.push(<text key={`l${si}-${i}`} x={rect.x + rect.width / 2} y={rect.y + rect.height / 2} textAnchor="middle" dominantBaseline="middle" fontFamily={font} fontSize={FS * 0.9} fill="#fff">{fmt(chart.series[si].vals[i] ?? 0)}</text>)
      })
    }
  }
  const linePts = (si: number) => Array.from({ length: n }, (_, i): [number, number] => [plot.x + band * (i + 0.5), vAxis(val(si, i))])
  const smooth = (pts: [number, number][]) => { if (pts.length < 3) return 'M' + pts.map((p) => p.join(' ')).join('L'); let d = `M${pts[0].join(' ')}`; for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2; d += `C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}` } return d }
  const areaBase = vAxis(Math.max(yt.min, Math.min(0, yt.max)))

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      {title}
      <g fontFamily={font} fontSize={FS} fill={fg}>
        {yt.values.map((v) => {
          const p = vAxis(v)
          return horiz
            ? <g key={v}>{chart.grid && <line x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} stroke={css('@bg2', th)} />}<text x={p} y={plot.y + plot.h + FS * 1.3} textAnchor="middle">{fmt(v)}{pct ? '%' : ''}</text></g>
            : <g key={v}>{chart.grid && <line x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} stroke={css('@bg2', th)} />}<text x={plot.x - FS * 0.5} y={p} textAnchor="end" dominantBaseline="middle">{fmt(v)}{pct ? '%' : ''}</text></g>
        })}
        {scatter && xt && xt.values.map((v) => { const x = plot.x + ((v - xt.min) / (xt.max - xt.min)) * plot.w; return <g key={v}>{chart.grid && <line x1={x} x2={x} y1={plot.y} y2={plot.y + plot.h} stroke={css('@bg2', th)} />}<text x={x} y={plot.y + plot.h + FS * 1.3} textAnchor="middle">{fmt(v)}</text></g> })}
        {!scatter && chart.cats.slice(0, n).map((c, i) => horiz
          ? <text key={i} x={plot.x - FS * 0.5} y={catPos(i) + band / 2} textAnchor="end" dominantBaseline="middle">{c}</text>
          : <text key={i} x={catPos(i) + band / 2} y={plot.y + plot.h + FS * 1.3} textAnchor="middle">{c.length * FS * 0.55 > band ? c.slice(0, Math.max(2, Math.floor(band / (FS * 0.55)) - 1)) + '…' : c}</text>)}
      </g>
      <line x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.h} stroke={fg} strokeOpacity="0.5" />
      <line x1={plot.x} x2={plot.x + plot.w} y1={horiz ? plot.y + plot.h : vAxis(Math.max(yt.min, Math.min(0, yt.max)))} y2={horiz ? plot.y + plot.h : vAxis(Math.max(yt.min, Math.min(0, yt.max)))} stroke={fg} strokeOpacity="0.5" />
      {bars}
      {chart.kind === 'area' && chart.series.map((_, si) => {
        const top = linePts(si)
        let base: [number, number][]
        if (stacked && si > 0) { base = Array.from({ length: n }, (_, i): [number, number] => [plot.x + band * (i + 0.5), vAxis(chart.series.slice(0, si).reduce((a, _s, k) => a + val(k, i), 0))]) } else base = top.map(([x]) => [x, areaBase] as [number, number])
        const topPts = stacked ? Array.from({ length: n }, (_, i): [number, number] => [plot.x + band * (i + 0.5), vAxis(chart.series.slice(0, si + 1).reduce((a, _s, k) => a + val(k, i), 0))]) : top
        return <path key={si} d={`M${topPts.map((p) => p.join(' ')).join('L')}L${[...base].reverse().map((p) => p.join(' ')).join('L')}Z`} fill={seriesColor(chart, si, th)} fillOpacity={stacked ? 0.9 : 0.55} stroke={seriesColor(chart, si, th)} strokeWidth="1.5" />
      })}
      {chart.kind === 'line' && chart.series.map((_, si) => {
        const pts = linePts(si)
        return <g key={si}><path d={chart.smooth ? smooth(pts) : 'M' + pts.map((p) => p.join(' ')).join('L')} fill="none" stroke={seriesColor(chart, si, th)} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{pts.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="3.5" fill={seriesColor(chart, si, th)} />{chart.labels && <text x={x} y={y - FS * 0.7} textAnchor="middle" fontFamily={font} fontSize={FS * 0.9} fill={ink}>{fmt(chart.series[si].vals[i] ?? 0)}</text>}</g>)}</g>
      })}
      {scatter && xt && chart.series.map((s, si) => (s.vals.map((v, i) => <circle key={`${si}-${i}`} cx={plot.x + (((s.xs?.[i] ?? i + 1) - xt.min) / (xt.max - xt.min)) * plot.w} cy={vAxis(v)} r="4.5" fill={seriesColor(chart, si, th)} fillOpacity="0.85" />)))}
      {chart.xTitle && <text x={plot.x + plot.w / 2} y={h - bottomPad - FS * 0.2} textAnchor="middle" fontFamily={font} fontSize={FS} fill={fg}>{chart.xTitle}</text>}
      {chart.yTitle && <text transform={`translate(${FS},${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle" fontFamily={font} fontSize={FS} fill={fg}>{chart.yTitle}</text>}
      {legend}
    </svg>
  )
}
