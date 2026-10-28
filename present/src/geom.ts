/** Preset shapes. Names and "adjust" values follow the .pptx preset geometry list, so shapes survive a round trip. */

export interface Path { d: string; /** Extra strokes inside the shape (no fill). */ detail?: string; /** Open shapes (braces, arcs) are not filled. */ open?: boolean }
const f = (n: number) => +n.toFixed(2)
const poly = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z'
const rad = (deg: number) => (deg * Math.PI) / 180

function star(n: number, ratio: number, w: number, h: number, rot = -90): string {
  const pts: [number, number][] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ratio : 1, a = rad(rot + (i * 180) / n)
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return poly(fit(pts, w, h))
}
function regular(n: number, w: number, h: number, rot = -90): string {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) { const a = rad(rot + (i * 360) / n); pts.push([Math.cos(a), Math.sin(a)]) }
  return poly(fit(pts, w, h))
}
/** Scale points to fill a w × h box exactly. */
function fit(pts: [number, number][], w: number, h: number): [number, number][] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * w, ((y - y0) / (y1 - y0)) * h])
}
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
const rrect = (x: number, y: number, w: number, h: number, r: number) => { r = Math.max(0, Math.min(r, w / 2, h / 2)); return `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)}V${f(y + h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z` }
const arcPt = (cx: number, cy: number, rx: number, ry: number, deg: number): [number, number] => [cx + rx * Math.cos(rad(deg)), cy + ry * Math.sin(rad(deg))]

type Def = { adj?: number[]; path: (w: number, h: number, a: number[]) => Path | string; text?: (w: number, h: number, a: number[]) => [number, number, number, number] }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const ss = (w: number, h: number) => Math.min(w, h)

/** A block arrow pointing right, rotated into place by swapping axes. */
function blockArrow(w: number, h: number, a1: number, a2: number, dir: 'r' | 'l' | 'u' | 'd' | 'lr' | 'ud'): string {
  const horiz = dir === 'r' || dir === 'l' || dir === 'lr'
  const L = horiz ? w : h, T = horiz ? h : w
  const shaft = T * clamp(a1, 0, 100000) / 100000
  const head = Math.min(ss(w, h) * clamp(a2, 0, 100000) / 100000, dir === 'lr' || dir === 'ud' ? L / 2 : L)
  const y0 = (T - shaft) / 2, y1 = y0 + shaft
  let pts: [number, number][]
  if (dir === 'lr' || dir === 'ud') pts = [[0, T / 2], [head, 0], [head, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [head, y1], [head, T]]
  else pts = [[0, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [0, y1]]
  if (dir === 'l' || dir === 'u') pts = pts.map(([x, y]) => [L - x, y])
  if (!horiz) pts = pts.map(([x, y]) => [y, x])
  return poly(pts)
}

const DEFS: Record<string, Def> = {
  rect: { path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]) },
  roundRect: { adj: [16667], path: (w, h, [a]) => rrect(0, 0, w, h, ss(w, h) * a / 100000), text: (w, h, [a]) => { const i = ss(w, h) * a / 100000 * 0.29; return [i, i, w - i, h - i] } },
  round1Rect: { adj: [16667], path: (w, h, [a]) => { const r = ss(w, h) * a / 100000; return `M0 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h)}H0Z` } },
  round2SameRect: { adj: [16667, 0], path: (w, h, [a, b]) => { const r = ss(w, h) * a / 100000, q = ss(w, h) * b / 100000; return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - q)}A${f(q)} ${f(q)} 0 0 1 ${f(w - q)} ${f(h)}H${f(q)}A${f(q)} ${f(q)} 0 0 1 0 ${f(h - q)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z` } },
  snip1Rect: { adj: [16667], path: (w, h, [a]) => { const r = ss(w, h) * a / 100000; return poly([[0, 0], [w - r, 0], [w, r], [w, h], [0, h]]) } },
  snip2SameRect: { adj: [16667, 0], path: (w, h, [a, b]) => { const r = ss(w, h) * a / 100000, q = ss(w, h) * b / 100000; return poly([[r, 0], [w - r, 0], [w, r], [w, h - q], [w - q, h], [q, h], [0, h - q], [0, r]]) } },
  ellipse: { path: (w, h) => ell(w / 2, h / 2, w / 2, h / 2), text: (w, h) => [w * 0.1464, h * 0.1464, w * 0.8536, h * 0.8536] },
  triangle: { adj: [50000], path: (w, h, [a]) => poly([[w * a / 100000, 0], [w, h], [0, h]]), text: (w, h, [a]) => [w * a / 200000, h / 2, w - w * (100000 - a) / 200000, h] },
  rtTriangle: { path: (w, h) => poly([[0, 0], [w, h], [0, h]]) },
  diamond: { path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), text: (w, h) => [w / 4, h / 4, w * 0.75, h * 0.75] },
  parallelogram: { adj: [25000], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w); return poly([[d, 0], [w, 0], [w - d, h], [0, h]]) }, text: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return [d / 2, 0, w - d / 2, h] } },
  trapezoid: { adj: [25000], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w / 2); return poly([[0, h], [d, 0], [w - d, 0], [w, h]]) }, text: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return [d / 3, h / 3, w - d / 3, h] } },
  pentagon: { path: (w, h) => regular(5, w, h) },
  hexagon: { adj: [25000], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w / 2); return poly([[0, h / 2], [d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h]]) } },
  heptagon: { path: (w, h) => regular(7, w, h) },
  octagon: { adj: [29289], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w / 2, h / 2); return poly([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]) } },
  decagon: { path: (w, h) => regular(10, w, h, 0) },
  dodecagon: { path: (w, h) => regular(12, w, h) },
  plus: { adj: [25000], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return poly([[d, 0], [w - d, 0], [w - d, d], [w, d], [w, h - d], [w - d, h - d], [w - d, h], [d, h], [d, h - d], [0, h - d], [0, d], [d, d]]) } },
  frame: { adj: [12500], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return `${poly([[0, 0], [w, 0], [w, h], [0, h]])}M${f(d)} ${f(d)}V${f(h - d)}H${f(w - d)}V${f(d)}Z` } },
  donut: { adj: [25000], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return `${ell(w / 2, h / 2, w / 2, h / 2)}${ell(w / 2, h / 2, Math.max(0.1, w / 2 - d), Math.max(0.1, h / 2 - d))}` } },
  noSmoking: { adj: [18750], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000, rx = w / 2 - d, ry = h / 2 - d; const k = Math.SQRT1_2; return `${ell(w / 2, h / 2, w / 2, h / 2)}${ell(w / 2, h / 2, rx, ry)}`.concat(`M${f(w / 2 - rx * k)} ${f(h / 2 - ry * k)}L${f(w / 2 - rx * k + d * 0.9)} ${f(h / 2 - ry * k - d * 0.2)}L${f(w / 2 + rx * k)} ${f(h / 2 + ry * k)}L${f(w / 2 + rx * k - d * 0.9)} ${f(h / 2 + ry * k + d * 0.2)}Z`) } },
  blockArc: { adj: [10800000, 0, 25000], path: (w, h, [a1, a2, a3]) => { const t = ss(w, h) * a3 / 100000, s = a1 / 60000, e = (a2 || 0) / 60000; const rx = w / 2, ry = h / 2; const p1 = arcPt(rx, ry, rx, ry, s), p2 = arcPt(rx, ry, rx, ry, e), p3 = arcPt(rx, ry, rx - t, ry - t, e), p4 = arcPt(rx, ry, rx - t, ry - t, s); const sweep = ((e - s) % 360 + 360) % 360; const big = sweep > 180 ? 1 : 0; return `M${f(p1[0])} ${f(p1[1])}A${f(rx)} ${f(ry)} 0 ${big} 1 ${f(p2[0])} ${f(p2[1])}L${f(p3[0])} ${f(p3[1])}A${f(rx - t)} ${f(ry - t)} 0 ${big} 0 ${f(p4[0])} ${f(p4[1])}Z` } },
  teardrop: { adj: [100000], path: (w, h, [a]) => { const k = a / 100000; const x = w / 2 + (w / 2) * k, y = h / 2 - (h / 2) * k; return `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w / 2)} ${f(h)}A${f(w / 2)} ${f(h / 2)} 0 0 1 ${f(w)} ${f(h / 2)}L${f(x)} ${f(y)}L${f(w / 2)} 0A${f(w / 2)} ${f(h / 2)} 0 0 0 0 ${f(h / 2)}Z` } },
  can: { adj: [25000], path: (w, h, [a]) => { const e = Math.min(h * a / 200000, h / 2); return { d: `M0 ${f(e)}A${f(w / 2)} ${f(e)} 0 0 1 ${f(w)} ${f(e)}V${f(h - e)}A${f(w / 2)} ${f(e)} 0 0 1 0 ${f(h - e)}Z`, detail: `M0 ${f(e)}A${f(w / 2)} ${f(e)} 0 0 0 ${f(w)} ${f(e)}` } } },
  cube: { adj: [25000], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w, h); return { d: poly([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]), detail: `M0 ${f(d)}H${f(w - d)}V${f(h)}M${f(w - d)} ${f(d)}L${f(w)} 0` } } },
  bevel: { adj: [12500], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]), detail: `M${f(d)} ${f(d)}H${f(w - d)}V${f(h - d)}H${f(d)}ZM0 0L${f(d)} ${f(d)}M${f(w)} 0L${f(w - d)} ${f(d)}M${f(w)} ${f(h)}L${f(w - d)} ${f(h - d)}M0 ${f(h)}L${f(d)} ${f(h - d)}` } } },
  foldedCorner: { adj: [16667], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return { d: poly([[0, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]), detail: `M${f(w - d)} ${f(h)}V${f(h - d)}H${f(w)}` } } },
  plaque: { adj: [16667], path: (w, h, [a]) => { const d = ss(w, h) * a / 100000; return `M${f(d)} 0H${f(w - d)}A${f(d)} ${f(d)} 0 0 0 ${f(w)} ${f(d)}V${f(h - d)}A${f(d)} ${f(d)} 0 0 0 ${f(w - d)} ${f(h)}H${f(d)}A${f(d)} ${f(d)} 0 0 0 0 ${f(h - d)}V${f(d)}A${f(d)} ${f(d)} 0 0 0 ${f(d)} 0Z` } },
  heart: { path: (w, h) => `M${f(w / 2)} ${f(h)}C${f(-w * 0.1)} ${f(h * 0.55)} ${f(w * 0.1)} ${f(-h * 0.05)} ${f(w / 2)} ${f(h * 0.28)}C${f(w * 0.9)} ${f(-h * 0.05)} ${f(w * 1.1)} ${f(h * 0.55)} ${f(w / 2)} ${f(h)}Z` },
  lightningBolt: { path: (w, h) => poly([[w * 0.4, 0], [w * 0.12, h * 0.46], [w * 0.38, h * 0.46], [w * 0.2, h], [w * 0.88, h * 0.4], [w * 0.57, h * 0.4], [w * 0.8, 0]]) },
  sun: { adj: [25000], path: (w, h, [a]) => { const r = w * a / 100000 * 1.4 + w * 0.12, cx = w / 2, cy = h / 2; let d = ell(cx, cy, r, r * h / w); for (let i = 0; i < 8; i++) { const an = rad(i * 45), c = Math.cos(an), s = Math.sin(an); const r1 = r * 1.18, r2 = w / 2; const tx = cx + c * r2, ty = cy + s * r2 * h / w; const bx = cx + c * r1, by = cy + s * r1 * h / w; const px = -s * w * 0.045, py = c * h * 0.045; d += poly([[bx + px, by + py], [tx, ty], [bx - px, by - py]]) } return d } },
  moon: { adj: [50000], path: (w, h, [a]) => { const k = clamp(a / 100000, 0.05, 0.95); return `M${f(w)} 0A${f(w)} ${f(h / 2)} 0 0 0 ${f(w)} ${f(h)}A${f(w * (1 - k))} ${f(h / 2)} 0 0 1 ${f(w)} 0Z` } },
  cloud: { path: (w, h) => { const p = (x: number, y: number) => `${f(w * x)} ${f(h * y)}`; return `M${p(0.2, 0.9)}C${p(0.05, 0.92)} ${p(-0.02, 0.62)} ${p(0.1, 0.55)}C${p(0.0, 0.35)} ${p(0.15, 0.2)} ${p(0.28, 0.28)}C${p(0.3, 0.05)} ${p(0.58, 0.0)} ${p(0.65, 0.2)}C${p(0.8, 0.05)} ${p(1.0, 0.2)} ${p(0.92, 0.4)}C${p(1.06, 0.5)} ${p(1.04, 0.85)} ${p(0.85, 0.82)}C${p(0.82, 0.98)} ${p(0.6, 0.98)} ${p(0.55, 0.88)}C${p(0.45, 1.0)} ${p(0.28, 1.0)} ${p(0.2, 0.9)}Z` }, text: (w, h) => [w * 0.15, h * 0.2, w * 0.85, h * 0.8] },
  smileyFace: { adj: [4653], path: (w, h, [a]) => { const m = h * a / 100000 * 2; return { d: ell(w / 2, h / 2, w / 2, h / 2), detail: `${ell(w * 0.35, h * 0.35, w * 0.05, h * 0.06)}${ell(w * 0.65, h * 0.35, w * 0.05, h * 0.06)}M${f(w * 0.22)} ${f(h * 0.6)}Q${f(w / 2)} ${f(h * 0.6 + h * 0.3 + m)} ${f(w * 0.78)} ${f(h * 0.6)}` } } },
  wave: { adj: [12500, 0], path: (w, h, [a]) => { const d = h * a / 100000; return `M0 ${f(d)}C${f(w * 0.25)} ${f(-d * 0.9)} ${f(w * 0.25)} ${f(d * 2.9)} ${f(w / 2)} ${f(d)}S${f(w * 0.75)} ${f(-d * 0.9)} ${f(w)} ${f(d)}V${f(h - d)}C${f(w * 0.75)} ${f(h + d * 0.9)} ${f(w * 0.75)} ${f(h - d * 2.9)} ${f(w / 2)} ${f(h - d)}S${f(w * 0.25)} ${f(h + d * 0.9)} 0 ${f(h - d)}Z` } },
  star4: { adj: [12500], path: (w, h, [a]) => star(4, a / 50000, w, h) },
  star5: { adj: [19098], path: (w, h, [a]) => star(5, a / 50000, w, h) },
  star6: { adj: [28868], path: (w, h, [a]) => star(6, a / 50000, w, h) },
  star7: { adj: [34601], path: (w, h, [a]) => star(7, a / 50000, w, h) },
  star8: { adj: [37500], path: (w, h, [a]) => star(8, a / 50000, w, h) },
  star10: { adj: [42533], path: (w, h, [a]) => star(10, a / 50000, w, h) },
  star12: { adj: [37500], path: (w, h, [a]) => star(12, a / 50000, w, h) },
  star16: { adj: [37500], path: (w, h, [a]) => star(16, a / 50000, w, h) },
  star24: { adj: [37500], path: (w, h, [a]) => star(24, a / 50000, w, h) },
  star32: { adj: [37500], path: (w, h, [a]) => star(32, a / 50000, w, h) },
  rightArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => blockArrow(w, h, a, b, 'r') },
  leftArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => blockArrow(w, h, a, b, 'l') },
  upArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => blockArrow(w, h, a, b, 'u') },
  downArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => blockArrow(w, h, a, b, 'd') },
  leftRightArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => blockArrow(w, h, a, b, 'lr') },
  upDownArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => blockArrow(w, h, a, b, 'ud') },
  chevron: { adj: [50000], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w); return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]) } },
  homePlate: { adj: [50000], path: (w, h, [a]) => { const d = Math.min(ss(w, h) * a / 100000, w); return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]) } },
  notchedRightArrow: { adj: [50000, 50000], path: (w, h, [a, b]) => { const sh = h * a / 100000, hd = Math.min(ss(w, h) * b / 100000, w), y0 = (h - sh) / 2, n = sh / 2; return poly([[0, y0], [w - hd, y0], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, y0 + sh], [0, y0 + sh], [n, h / 2]]) } },
  bentArrow: { adj: [25000, 25000, 25000], path: (w, h, [a, b, c]) => { const t = ss(w, h) * a / 100000, hh = ss(w, h) * b / 100000, hd = Math.min(ss(w, h) * c / 100000, w), cy = hh; return poly([[0, h], [0, cy - t / 2], [w - hd, cy - t / 2], [w - hd, cy - hh], [w, cy], [w - hd, cy + hh], [w - hd, cy + t / 2], [t, cy + t / 2], [t, h]]) } },
  uturnArrow: { adj: [25000], path: (w, h, [a]) => { const t = ss(w, h) * a / 100000; return `M0 ${f(h)}V${f(h * 0.4)}A${f(w * 0.3)} ${f(h * 0.4)} 0 0 1 ${f(w * 0.6)} 0H${f(w * 0.6)}A${f(w * 0.3)} ${f(h * 0.4)} 0 0 1 ${f(w * 0.9)} ${f(h * 0.4)}H${f(w)}L${f(w * 0.8)} ${f(h * 0.4 + t * 2)}L${f(w * 0.6)} ${f(h * 0.4)}H${f(w * 0.7)}A${f(w * 0.1)} ${f(h * 0.2)} 0 0 0 ${f(w * 0.6)} ${f(t)}A${f(w * 0.3 - t)} ${f(h * 0.4 - t)} 0 0 0 ${f(t)} ${f(h * 0.4)}V${f(h)}Z` } },
  wedgeRectCallout: { adj: [-20833, 62500], path: (w, h, [a, b]) => callout(w, h, a, b, 0) },
  wedgeRoundRectCallout: { adj: [-20833, 62500, 16667], path: (w, h, [a, b, c]) => callout(w, h, a, b, ss(w, h) * c / 100000) },
  wedgeEllipseCallout: { adj: [-20833, 62500], path: (w, h, [a, b]) => { const tx = w / 2 + (w * a) / 100000, ty = h / 2 + (h * b) / 100000; const ang = Math.atan2(ty - h / 2, tx - w / 2), da = 0.25; const p1 = [w / 2 + (w / 2) * Math.cos(ang - da), h / 2 + (h / 2) * Math.sin(ang - da)], p2 = [w / 2 + (w / 2) * Math.cos(ang + da), h / 2 + (h / 2) * Math.sin(ang + da)]; return `M${f(p2[0])} ${f(p2[1])}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(p1[0])} ${f(p1[1])}L${f(tx)} ${f(ty)}Z` }, text: (w, h) => [w * 0.1464, h * 0.1464, w * 0.8536, h * 0.8536] },
  cloudCallout: { adj: [-20833, 62500], path: (w, h, [a, b]) => { const tx = w / 2 + (w * a) / 100000, ty = h / 2 + (h * b) / 100000; const c = DEFS.cloud.path(w, h * 0.8, []); const d = typeof c === 'string' ? c : c.d; return `${d}${ell(tx + (w / 2 - tx) * 0.2, ty + (h / 2 - ty) * 0.2 - h * 0.02, w * 0.05, h * 0.05)}${ell(tx, ty, w * 0.03, h * 0.03)}` } },
  leftBracket: { adj: [8333], path: (w, h, [a]) => { const r = ss(w, h) * a / 100000; return { d: `M${f(w)} 0H${f(r)}A${f(r)} ${f(r)} 0 0 0 0 ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 0 ${f(r)} ${f(h)}H${f(w)}`, open: true } } },
  rightBracket: { adj: [8333], path: (w, h, [a]) => { const r = ss(w, h) * a / 100000; return { d: `M0 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H0`, open: true } } },
  leftBrace: { adj: [8333, 50000], path: (w, h, [a, b]) => { const r = ss(w, h) * a / 100000, m = h * b / 100000; return { d: `M${f(w)} 0Q${f(w / 2)} 0 ${f(w / 2)} ${f(r)}V${f(m - r)}Q${f(w / 2)} ${f(m)} 0 ${f(m)}Q${f(w / 2)} ${f(m)} ${f(w / 2)} ${f(m + r)}V${f(h - r)}Q${f(w / 2)} ${f(h)} ${f(w)} ${f(h)}`, open: true } } },
  rightBrace: { adj: [8333, 50000], path: (w, h, [a, b]) => { const r = ss(w, h) * a / 100000, m = h * b / 100000; return { d: `M0 0Q${f(w / 2)} 0 ${f(w / 2)} ${f(r)}V${f(m - r)}Q${f(w / 2)} ${f(m)} ${f(w)} ${f(m)}Q${f(w / 2)} ${f(m)} ${f(w / 2)} ${f(m + r)}V${f(h - r)}Q${f(w / 2)} ${f(h)} 0 ${f(h)}`, open: true } } },
  arc: { adj: [16200000, 0], path: (w, h, [a, b]) => { const p1 = arcPt(w / 2, h / 2, w / 2, h / 2, a / 60000), p2 = arcPt(w / 2, h / 2, w / 2, h / 2, b / 60000); const sweep = (((b - a) / 60000) % 360 + 360) % 360; return { d: `M${f(p1[0])} ${f(p1[1])}A${f(w / 2)} ${f(h / 2)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(p2[0])} ${f(p2[1])}`, open: true } } },
  pie: { adj: [0, 16200000], path: (w, h, [a, b]) => { const p1 = arcPt(w / 2, h / 2, w / 2, h / 2, a / 60000), p2 = arcPt(w / 2, h / 2, w / 2, h / 2, b / 60000); const sweep = (((b - a) / 60000) % 360 + 360) % 360; return `M${f(w / 2)} ${f(h / 2)}L${f(p1[0])} ${f(p1[1])}A${f(w / 2)} ${f(h / 2)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(p2[0])} ${f(p2[1])}Z` } },
  chord: { adj: [2700000, 16200000], path: (w, h, [a, b]) => { const p1 = arcPt(w / 2, h / 2, w / 2, h / 2, a / 60000), p2 = arcPt(w / 2, h / 2, w / 2, h / 2, b / 60000); const sweep = (((b - a) / 60000) % 360 + 360) % 360; return `M${f(p1[0])} ${f(p1[1])}A${f(w / 2)} ${f(h / 2)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(p2[0])} ${f(p2[1])}Z` } },
  mathPlus: { adj: [23520], path: (w, h, [a]) => { const t = ss(w, h) * a / 100000 / 2; const cx = w / 2, cy = h / 2; return poly([[cx - t, h * 0.1], [cx + t, h * 0.1], [cx + t, cy - t], [w * 0.9, cy - t], [w * 0.9, cy + t], [cx + t, cy + t], [cx + t, h * 0.9], [cx - t, h * 0.9], [cx - t, cy + t], [w * 0.1, cy + t], [w * 0.1, cy - t], [cx - t, cy - t]]) } },
  mathMinus: { adj: [23520], path: (w, h, [a]) => { const t = ss(w, h) * a / 100000 / 2; return poly([[w * 0.1, h / 2 - t], [w * 0.9, h / 2 - t], [w * 0.9, h / 2 + t], [w * 0.1, h / 2 + t]]) } },
  mathMultiply: { adj: [23520], path: (w, h, [a]) => { const t = ss(w, h) * a / 100000 / 2 * 0.7, cx = w / 2, cy = h / 2, x0 = w * 0.12, y0 = h * 0.12, x1 = w * 0.88, y1 = h * 0.88; return poly([[x0, y0 + t], [x0 + t, y0], [cx, cy - t], [x1 - t, y0], [x1, y0 + t], [cx + t, cy], [x1, y1 - t], [x1 - t, y1], [cx, cy + t], [x0 + t, y1], [x0, y1 - t], [cx - t, cy]]) } },
  mathEqual: { adj: [23520, 11760], path: (w, h, [a, b]) => { const t = ss(w, h) * a / 100000 / 2, g = ss(w, h) * b / 100000; const cy = h / 2; return poly([[w * 0.1, cy - g - t * 2], [w * 0.9, cy - g - t * 2], [w * 0.9, cy - g], [w * 0.1, cy - g]]) + poly([[w * 0.1, cy + g], [w * 0.9, cy + g], [w * 0.9, cy + g + t * 2], [w * 0.1, cy + g + t * 2]]) } },
  mathDivide: { adj: [23520, 5880, 11760], path: (w, h, [a, b, c]) => { const t = ss(w, h) * a / 100000 / 2, d = ss(w, h) * b / 100000, g = ss(w, h) * c / 100000; return poly([[w * 0.1, h / 2 - t], [w * 0.9, h / 2 - t], [w * 0.9, h / 2 + t], [w * 0.1, h / 2 + t]]) + ell(w / 2, h / 2 - t - g - d, d, d) + ell(w / 2, h / 2 + t + g + d, d, d) } },
  flowChartProcess: { path: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]) },
  flowChartAlternateProcess: { path: (w, h) => rrect(0, 0, w, h, ss(w, h) / 6) },
  flowChartDecision: { path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), text: (w, h) => [w / 4, h / 4, w * 0.75, h * 0.75] },
  flowChartInputOutput: { path: (w, h) => poly([[w / 5, 0], [w, 0], [w * 0.8, h], [0, h]]), text: (w, h) => [w / 5, 0, w * 0.8, h] },
  flowChartPredefinedProcess: { path: (w, h) => ({ d: poly([[0, 0], [w, 0], [w, h], [0, h]]), detail: `M${f(w / 8)} 0V${f(h)}M${f(w * 7 / 8)} 0V${f(h)}` }) },
  flowChartDocument: { path: (w, h) => `M0 0H${f(w)}V${f(h * 0.85)}C${f(w * 0.75)} ${f(h * 0.7)} ${f(w * 0.6)} ${f(h * 1.1)} ${f(w / 2)} ${f(h * 0.92)}C${f(w * 0.3)} ${f(h * 0.8)} ${f(w * 0.15)} ${f(h)} 0 ${f(h * 0.9)}Z` },
  flowChartTerminator: { path: (w, h) => rrect(0, 0, w, h, h / 2) },
  flowChartConnector: { path: (w, h) => ell(w / 2, h / 2, w / 2, h / 2), text: (w, h) => [w * 0.1464, h * 0.1464, w * 0.8536, h * 0.8536] },
  flowChartPreparation: { path: (w, h) => poly([[0, h / 2], [w / 5, 0], [w * 0.8, 0], [w, h / 2], [w * 0.8, h], [w / 5, h]]) },
  flowChartManualInput: { path: (w, h) => poly([[0, h / 5], [w, 0], [w, h], [0, h]]) },
  flowChartDelay: { path: (w, h) => `M0 0H${f(w / 2)}A${f(w / 2)} ${f(h / 2)} 0 0 1 ${f(w / 2)} ${f(h)}H0Z` },
  flowChartMagneticDisk: { path: (w, h) => DEFS.can.path(w, h, [50000]) },
  flowChartMerge: { path: (w, h) => poly([[0, 0], [w, 0], [w / 2, h]]) },
  flowChartExtract: { path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  flowChartOr: { path: (w, h) => ({ d: ell(w / 2, h / 2, w / 2, h / 2), detail: `M${f(w / 2)} 0V${f(h)}M0 ${f(h / 2)}H${f(w)}` }) },
  flowChartSummingJunction: { path: (w, h) => ({ d: ell(w / 2, h / 2, w / 2, h / 2), detail: `M${f(w * 0.146)} ${f(h * 0.146)}L${f(w * 0.854)} ${f(h * 0.854)}M${f(w * 0.854)} ${f(h * 0.146)}L${f(w * 0.146)} ${f(h * 0.854)}` }) },
}

function callout(w: number, h: number, a: number, b: number, r: number): string {
  const tx = w / 2 + (w * a) / 100000, ty = h / 2 + (h * b) / 100000
  const left = tx < w / 3, right = tx > (w * 2) / 3, top = ty < 0, bottom = ty > h
  r = Math.min(r, w / 2, h / 2)
  const seg = (side: 't' | 'r' | 'b' | 'l') => {
    const span = side === 't' || side === 'b' ? w : h
    const s1 = span * 0.2, s2 = span * 0.4
    const [p, q] = side === 't' ? [[s1, 0], [s2, 0]] : side === 'b' ? [[w - s1, h], [w - s2, h]] : side === 'r' ? [[w, s1], [w, s2]] : [[0, h - s1], [0, h - s2]]
    return { p, q }
  }
  const side = bottom ? 'b' : top ? 't' : right ? 'r' : left ? 'l' : 'b'
  const out: string[] = []
  const edge = (s: 't' | 'r' | 'b' | 'l', end: [number, number]) => {
    if (s === side) { const { p, q } = seg(s); out.push(`L${f(p[0])} ${f(p[1])}L${f(tx)} ${f(ty)}L${f(q[0])} ${f(q[1])}`) }
    out.push(`L${f(end[0])} ${f(end[1])}`)
  }
  out.push(`M${f(r)} 0`)
  edge('t', [w - r, 0]); if (r) out.push(`A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}`)
  edge('r', [w, h - r]); if (r) out.push(`A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}`)
  edge('b', [r, h]); if (r) out.push(`A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}`)
  edge('l', [0, r]); if (r) out.push(`A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0`)
  return out.join('') + 'Z'
}

export function shapePath(geom: string, w: number, h: number, adj?: number[]): Path {
  const def = DEFS[geom] ?? DEFS.rect
  const a = def.adj ? def.adj.map((d, i) => adj?.[i] ?? d) : []
  const p = def.path(Math.max(w, 0.01), Math.max(h, 0.01), a)
  return typeof p === 'string' ? { d: p } : p
}
export const defaultAdj = (geom: string) => DEFS[geom]?.adj
export const adjCount = (geom: string) => DEFS[geom]?.adj?.length ?? 0
/** The area text may use, as insets from each side. */
export function textBox(geom: string, w: number, h: number, adj?: number[]): [number, number, number, number] {
  const def = DEFS[geom]
  if (!def?.text) return [0, 0, 0, 0]
  const a = def.adj ? def.adj.map((d, i) => adj?.[i] ?? d) : []
  const [l, t, r, b] = def.text(w, h, a)
  return [l, t, w - r, h - b]
}
export const isGeom = (g: string) => g in DEFS

export const SHAPE_GROUPS: { name: string; shapes: { geom: string; label: string }[] }[] = [
  { name: 'Basic', shapes: [
    { geom: 'rect', label: 'Rectangle' }, { geom: 'roundRect', label: 'Rounded rectangle' }, { geom: 'ellipse', label: 'Oval' }, { geom: 'triangle', label: 'Triangle' }, { geom: 'rtTriangle', label: 'Right triangle' },
    { geom: 'diamond', label: 'Diamond' }, { geom: 'parallelogram', label: 'Parallelogram' }, { geom: 'trapezoid', label: 'Trapezoid' }, { geom: 'pentagon', label: 'Pentagon' }, { geom: 'hexagon', label: 'Hexagon' },
    { geom: 'heptagon', label: 'Heptagon' }, { geom: 'octagon', label: 'Octagon' }, { geom: 'decagon', label: 'Decagon' }, { geom: 'dodecagon', label: 'Dodecagon' }, { geom: 'plus', label: 'Cross' },
    { geom: 'frame', label: 'Frame' }, { geom: 'donut', label: 'Donut' }, { geom: 'noSmoking', label: '"No" symbol' }, { geom: 'blockArc', label: 'Block arc' }, { geom: 'teardrop', label: 'Teardrop' },
    { geom: 'can', label: 'Can' }, { geom: 'cube', label: 'Cube' }, { geom: 'bevel', label: 'Bevel' }, { geom: 'foldedCorner', label: 'Folded corner' }, { geom: 'plaque', label: 'Plaque' },
    { geom: 'round1Rect', label: 'Round one corner' }, { geom: 'round2SameRect', label: 'Round top corners' }, { geom: 'snip1Rect', label: 'Snip one corner' }, { geom: 'snip2SameRect', label: 'Snip top corners' },
    { geom: 'heart', label: 'Heart' }, { geom: 'lightningBolt', label: 'Lightning bolt' }, { geom: 'sun', label: 'Sun' }, { geom: 'moon', label: 'Moon' }, { geom: 'cloud', label: 'Cloud' }, { geom: 'smileyFace', label: 'Smiley face' },
    { geom: 'wave', label: 'Wave' }, { geom: 'arc', label: 'Arc' }, { geom: 'pie', label: 'Pie' }, { geom: 'chord', label: 'Chord' },
    { geom: 'leftBracket', label: 'Left bracket' }, { geom: 'rightBracket', label: 'Right bracket' }, { geom: 'leftBrace', label: 'Left brace' }, { geom: 'rightBrace', label: 'Right brace' },
  ] },
  { name: 'Arrows', shapes: [
    { geom: 'rightArrow', label: 'Right arrow' }, { geom: 'leftArrow', label: 'Left arrow' }, { geom: 'upArrow', label: 'Up arrow' }, { geom: 'downArrow', label: 'Down arrow' },
    { geom: 'leftRightArrow', label: 'Left-right arrow' }, { geom: 'upDownArrow', label: 'Up-down arrow' }, { geom: 'bentArrow', label: 'Bent arrow' }, { geom: 'uturnArrow', label: 'U-turn arrow' },
    { geom: 'notchedRightArrow', label: 'Notched arrow' }, { geom: 'chevron', label: 'Chevron' }, { geom: 'homePlate', label: 'Pentagon arrow' },
  ] },
  { name: 'Stars', shapes: ['star4', 'star5', 'star6', 'star7', 'star8', 'star10', 'star12', 'star16', 'star24', 'star32'].map((g) => ({ geom: g, label: `${g.slice(4)}-point star` })) },
  { name: 'Callouts', shapes: [
    { geom: 'wedgeRectCallout', label: 'Speech bubble' }, { geom: 'wedgeRoundRectCallout', label: 'Rounded speech bubble' }, { geom: 'wedgeEllipseCallout', label: 'Oval speech bubble' }, { geom: 'cloudCallout', label: 'Thought bubble' },
  ] },
  { name: 'Flowchart', shapes: [
    { geom: 'flowChartProcess', label: 'Process' }, { geom: 'flowChartAlternateProcess', label: 'Alternate process' }, { geom: 'flowChartDecision', label: 'Decision' }, { geom: 'flowChartInputOutput', label: 'Data' },
    { geom: 'flowChartPredefinedProcess', label: 'Predefined process' }, { geom: 'flowChartDocument', label: 'Document' }, { geom: 'flowChartTerminator', label: 'Terminator' }, { geom: 'flowChartConnector', label: 'Connector' },
    { geom: 'flowChartPreparation', label: 'Preparation' }, { geom: 'flowChartManualInput', label: 'Manual input' }, { geom: 'flowChartDelay', label: 'Delay' }, { geom: 'flowChartMagneticDisk', label: 'Stored data' },
    { geom: 'flowChartMerge', label: 'Merge' }, { geom: 'flowChartExtract', label: 'Extract' }, { geom: 'flowChartOr', label: 'Or' }, { geom: 'flowChartSummingJunction', label: 'Summing junction' },
  ] },
  { name: 'Math', shapes: [
    { geom: 'mathPlus', label: 'Plus' }, { geom: 'mathMinus', label: 'Minus' }, { geom: 'mathMultiply', label: 'Multiply' }, { geom: 'mathEqual', label: 'Equals' }, { geom: 'mathDivide', label: 'Divide' },
  ] },
]

/** Scale an imported freeform outline (made of M L C Q A Z with absolute numbers) to a new size. */
export function scaleCustPath(d: string, sx: number, sy: number): string {
  let out = ''
  for (const m of d.matchAll(/([MLCQAZ])([^MLCQAZ]*)/g)) {
    const cmd = m[1]
    const n = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    if (cmd === 'Z') { out += 'Z'; continue }
    if (cmd === 'A') { out += `A${n[0] * sx} ${n[1] * sy} ${n[2]} ${n[3]} ${n[4]} ${f(n[5] * sx)} ${f(n[6] * sy)}`; continue }
    out += cmd + n.map((v, i) => f(v * (i % 2 ? sy : sx))).join(' ')
  }
  return out
}
