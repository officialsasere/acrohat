import { criteria } from '../criteria'
import { toNumber } from '../coerce'
import { Arr, E, isErr, Ref, type Scalar, type Value } from '../types'
import { clipRef, def, flat, int, isArrayArg, num, numbers, scalar, toArr, type Ctx } from '../eval'
import { betaI, erf, gamma, gammaP, gammaln, invert, normCdf, normInv, normPdf, tCdf } from './special'
import { _fix as fix } from './math'

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b)
const need = (xs: number[], n = 1) => { if (xs.length < n) throw E.DIV0; return xs }
const mean = (xs: number[]) => need(xs).reduce((a, b) => a + b, 0) / xs.length
const varS = (xs: number[], pop: boolean) => { need(xs, pop ? 1 : 2); const m = mean(xs); return xs.reduce((s, v) => s + (v - m) ** 2, 0) / (pop ? xs.length : xs.length - 1) }

// ---- counting
def('COUNT', 1, 255, (args, c) => {
  let n = 0
  for (const a of args) {
    if (isArrayArg(a)) { for (const x of flat(a, c)) if (typeof x === 'number') n++ }
    else { const x = scalar(a, c); if (typeof x === 'number' || typeof x === 'boolean' || (typeof x === 'string' && (() => { try { toNumber(x); return true } catch { return false } })())) n++ }
  }
  return n
})
def('COUNTA', 1, 255, (args, c) => args.reduce<number>((n, a) => n + flat(a, c).filter((x) => x !== null && x !== '' || (x === '' && !(a instanceof Ref))).length, 0))
def('COUNTBLANK', 1, 1, ([a], c) => flat(a, c).filter((x) => x === null || x === '').length)
def('COUNTUNIQUE', 1, 255, (args, c) => new Set(args.flatMap((a) => flat(a, c)).filter((x) => x !== null).map((x) => typeof x + ':' + String(x).toLowerCase())).size)

// ---- conditional sums, counts, averages
function condPairs(args: Value[], from: number, c: Ctx) {
  const out: { cells: Scalar[]; test: (x: Scalar) => boolean }[] = []
  let size = -1
  for (let i = from; i < args.length; i += 2) {
    const cells = flat(args[i]!, c)
    if (size >= 0 && cells.length !== size) throw E.VALUE
    size = cells.length
    out.push({ cells, test: criteria(scalar(args[i + 1]!, c)) })
  }
  return out
}
const matching = (pairs: ReturnType<typeof condPairs>, n: number) => {
  const idx: number[] = []
  for (let i = 0; i < n; i++) if (pairs.every((p) => p.test(p.cells[i]))) idx.push(i)
  return idx
}
def('COUNTIF', 2, 2, ([a, k], c) => { const t = criteria(scalar(k, c)); return flat(a, c).filter(t).length })
def('COUNTIFS', 2, 254, (args, c) => { if (args.length % 2) throw E.VALUE; const p = condPairs(args, 0, c); return matching(p, p[0].cells.length).length })
def('SUMIF', 2, 3, ([a, k, s], c) => {
  const t = criteria(scalar(k, c)), cells = flat(a, c), sums = s ? shifted(s, a, c) : cells
  let tot = 0
  cells.forEach((x, i) => { if (t(x)) { const v = sums[i]; if (isErr(v)) throw v; if (typeof v === 'number') tot += v } })
  return fix(tot)
})
/** SUMIF's sum range is only given its top-left cell: it is as big as the test range. */
function shifted(s: Value, test: Value, c: Ctx): Scalar[] {
  if (s instanceof Ref && test instanceof Ref) {
    const t = clipRef(c, test)
    return flat(new Ref(s.sheet, s.r1, s.c1, s.r1 + t.rows - 1, s.c1 + t.cols - 1), c)
  }
  return flat(s, c)
}
def('SUMIFS', 3, 255, (args, c) => {
  if (args.length % 2 === 0) throw E.VALUE
  const sums = flat(args[0]!, c), p = condPairs(args, 1, c)
  if (p[0].cells.length !== sums.length) throw E.VALUE
  return fix(matching(p, sums.length).reduce((t, i) => { const v = sums[i]; if (isErr(v)) throw v; return t + (typeof v === 'number' ? v : 0) }, 0))
})
def('AVERAGEIF', 2, 3, ([a, k, s], c) => {
  const t = criteria(scalar(k, c)), cells = flat(a, c), vals = s ? shifted(s, a, c) : cells
  const xs: number[] = []
  cells.forEach((x, i) => { if (t(x)) { const v = vals[i]; if (typeof v === 'number') xs.push(v) } })
  return mean(xs)
})
def('AVERAGEIFS', 3, 255, (args, c) => {
  if (args.length % 2 === 0) throw E.VALUE
  const vals = flat(args[0]!, c), p = condPairs(args, 1, c)
  return mean(matching(p, vals.length).map((i) => vals[i]).filter((v): v is number => typeof v === 'number'))
})
for (const [n, f] of [['MAXIFS', Math.max], ['MINIFS', Math.min]] as const) def(n, 3, 255, (args, c) => {
  if (args.length % 2 === 0) throw E.VALUE
  const vals = flat(args[0]!, c), p = condPairs(args, 1, c)
  const xs = matching(p, vals.length).map((i) => vals[i]).filter((v): v is number => typeof v === 'number')
  return xs.length ? f(...xs) : 0
})

// ---- averages and extremes
def('AVERAGE', 1, 255, (args, c) => mean(numbers(args, c)))
def('AVERAGEA', 1, 255, (args, c) => mean(args.flatMap((a) => flat(a, c)).filter((x) => x !== null).map((x) => { if (isErr(x)) throw x; return typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0 })))
def('MAX', 1, 255, (args, c) => { const n = numbers(args, c); return n.length ? n.reduce((a, b) => (b > a ? b : a)) : 0 })
def('MIN', 1, 255, (args, c) => { const n = numbers(args, c); return n.length ? n.reduce((a, b) => (b < a ? b : a)) : 0 })
def('MAXA', 1, 255, (args, c) => { const n = numbers(args, c, { text: true }); return n.length ? Math.max(...n) : 0 })
def('MINA', 1, 255, (args, c) => { const n = numbers(args, c, { text: true }); return n.length ? Math.min(...n) : 0 })
def('MEDIAN', 1, 255, (args, c) => { const s = sorted(numbers(args, c)); if (!s.length) throw E.NUM; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 })
function modes(args: Value[], c: Ctx): number[] {
  const xs = numbers(args, c)
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  const best = Math.max(0, ...counts.values())
  if (best < 2) throw E.NA
  return xs.filter((x, i) => counts.get(x) === best && xs.indexOf(x) === i)
}
for (const n of ['MODE', 'MODE.SNGL']) def(n, 1, 255, (args, c) => modes(args, c)[0])
def('MODE.MULT', 1, 255, (args, c) => new Arr(modes(args, c).map((x) => [x])))
def('GEOMEAN', 1, 255, (args, c) => { const xs = need(numbers(args, c)); if (xs.some((x) => x <= 0)) throw E.NUM; return Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) })
def('HARMEAN', 1, 255, (args, c) => { const xs = need(numbers(args, c)); if (xs.some((x) => x <= 0)) throw E.NUM; return xs.length / xs.reduce((s, x) => s + 1 / x, 0) })
def('TRIMMEAN', 2, 2, ([a, p], c) => { const s = sorted(numbers([a], c)), k = Math.floor((s.length * num(p, c)) / 2 ); if (num(p, c) < 0 || num(p, c) >= 1) throw E.NUM; return mean(s.slice(k, s.length - k)) })
def('AVEDEV', 1, 255, (args, c) => { const xs = need(numbers(args, c)), m = mean(xs); return xs.reduce((s, x) => s + Math.abs(x - m), 0) / xs.length })
def('DEVSQ', 1, 255, (args, c) => { const xs = need(numbers(args, c)), m = mean(xs); return xs.reduce((s, x) => s + (x - m) ** 2, 0) })

// ---- spread
for (const n of ['STDEV', 'STDEV.S']) def(n, 1, 255, (args, c) => Math.sqrt(varS(numbers(args, c), false)))
for (const n of ['STDEVP', 'STDEV.P']) def(n, 1, 255, (args, c) => Math.sqrt(varS(numbers(args, c), true)))
for (const n of ['VAR', 'VAR.S']) def(n, 1, 255, (args, c) => varS(numbers(args, c), false))
for (const n of ['VARP', 'VAR.P']) def(n, 1, 255, (args, c) => varS(numbers(args, c), true))
def('STDEVA', 1, 255, (args, c) => Math.sqrt(varS(numbers(args, c, { text: true }), false)))
def('VARA', 1, 255, (args, c) => varS(numbers(args, c, { text: true }), false))
def('SKEW', 1, 255, (args, c) => { const xs = numbers(args, c), n = xs.length; if (n < 3) throw E.DIV0; const m = mean(xs), s = Math.sqrt(varS(xs, false)); if (s === 0) throw E.DIV0; return (n / ((n - 1) * (n - 2))) * xs.reduce((t, x) => t + ((x - m) / s) ** 3, 0) })
def('SKEW.P', 1, 255, (args, c) => { const xs = numbers(args, c), n = xs.length; if (n < 1) throw E.DIV0; const m = mean(xs), s = Math.sqrt(varS(xs, true)); if (s === 0) throw E.DIV0; return xs.reduce((t, x) => t + ((x - m) / s) ** 3, 0) / n })
def('KURT', 1, 255, (args, c) => { const xs = numbers(args, c), n = xs.length; if (n < 4) throw E.DIV0; const m = mean(xs), s = Math.sqrt(varS(xs, false)); if (s === 0) throw E.DIV0; return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * xs.reduce((t, x) => t + ((x - m) / s) ** 4, 0) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)) })

// ---- order statistics
const kth = (args: Value[], c: Ctx, desc: boolean) => {
  const xs = sorted(numbers([args[0]!], c)), k = Math.ceil(num(args[1]!, c))
  if (k < 1 || k > xs.length) throw E.NUM
  return desc ? xs[xs.length - k] : xs[k - 1]
}
def('LARGE', 2, 2, (a, c) => kth(a, c, true))
def('SMALL', 2, 2, (a, c) => kth(a, c, false))
function rank(a: Value[], c: Ctx, avg: boolean) {
  const x = num(a[0]!, c), xs = numbers([a[1]!], c), asc = a[2] != null && num(a[2], c) !== 0
  if (!xs.includes(x)) throw E.NA
  const better = xs.filter((v) => (asc ? v < x : v > x)).length, same = xs.filter((v) => v === x).length
  return avg ? better + (same + 1) / 2 : better + 1
}
for (const n of ['RANK', 'RANK.EQ']) def(n, 2, 3, (a, c) => rank(a, c, false))
def('RANK.AVG', 2, 3, (a, c) => rank(a, c, true))
function percentile(xs: number[], p: number, exc: boolean): number {
  const s = sorted(xs), n = s.length
  if (!n) throw E.NUM
  if (exc) { if (p <= 0 || p >= 1) throw E.NUM; const r = p * (n + 1); if (r < 1 || r > n) throw E.NUM; const i = Math.floor(r); return i >= n ? s[n - 1] : s[i - 1] + (r - i) * (s[i] - s[i - 1]) }
  if (p < 0 || p > 1) throw E.NUM
  const r = p * (n - 1), i = Math.floor(r)
  return i + 1 >= n ? s[n - 1] : s[i] + (r - i) * (s[i + 1] - s[i])
}
for (const [n, e] of [['PERCENTILE', false], ['PERCENTILE.INC', false], ['PERCENTILE.EXC', true]] as const) def(n, 2, 2, ([a, k], c) => percentile(numbers([a], c), num(k, c), e))
for (const [n, e] of [['QUARTILE', false], ['QUARTILE.INC', false], ['QUARTILE.EXC', true]] as const) def(n, 2, 2, ([a, q], c) => { const k = int(q, c); if (k < (e ? 1 : 0) || k > (e ? 3 : 4)) throw E.NUM; return percentile(numbers([a], c), k / 4, e) })
for (const [n, e] of [['PERCENTRANK', false], ['PERCENTRANK.INC', false], ['PERCENTRANK.EXC', true]] as const) def(n, 2, 3, ([a, xv, sg], c) => {
  const s = sorted(numbers([a], c)), x = num(xv, c), sig = sg == null ? 3 : int(sg, c), n = s.length
  if (x < s[0] || x > s[n - 1]) throw E.NA
  let r: number
  const i = s.findIndex((v) => v >= x)
  if (s[i] === x) r = e ? (i + 1) / (n + 1) : i / (n - 1)
  else { const lo = i - 1, f = (x - s[lo]) / (s[i] - s[lo]); r = e ? (lo + 1 + f) / (n + 1) : (lo + f) / (n - 1) }
  const p = 10 ** sig
  return Math.floor(r * p) / p
})
def('FREQUENCY', 2, 2, ([d, b], c) => {
  const data = numbers([d], c), bins = sorted(numbers([b], c))
  const counts = Array(bins.length + 1).fill(0)
  for (const x of data) { let i = bins.findIndex((v) => x <= v); if (i < 0) i = bins.length; counts[i]++ }
  return new Arr(counts.map((n) => [n]))
})
def('PROB', 3, 4, ([xr, pr, lo, hi], c) => {
  const x = numbers([xr], c), p = numbers([pr], c), a = num(lo, c), b = hi == null ? a : num(hi, c)
  if (x.length !== p.length) throw E.NA
  if (p.some((v) => v < 0 || v > 1) || Math.abs(p.reduce((s, v) => s + v, 0) - 1) > 1e-9) throw E.NUM
  return x.reduce((s, v, i) => s + (v >= a && v <= b ? p[i] : 0), 0)
})

// ---- two variables
function xy(a: Value, b: Value, c: Ctx): [number[], number[]] {
  const x = flat(a, c), y = flat(b, c)
  if (x.length !== y.length) throw E.NA
  const X: number[] = [], Y: number[] = []
  x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') { X.push(v); Y.push(y[i] as number) } })
  if (X.length < 2) throw E.DIV0
  return [X, Y]
}
const cov = (X: number[], Y: number[], pop: boolean) => { const mx = mean(X), my = mean(Y); return X.reduce((s, v, i) => s + (v - mx) * (Y[i] - my), 0) / (pop ? X.length : X.length - 1) }
for (const n of ['CORREL', 'PEARSON']) def(n, 2, 2, ([a, b], c) => { const [X, Y] = xy(a, b, c); const d = Math.sqrt(varS(X, false) * varS(Y, false)); if (d === 0) throw E.DIV0; return cov(X, Y, false) / d })
for (const [n, p] of [['COVAR', true], ['COVARIANCE.P', true], ['COVARIANCE.S', false]] as const) def(n, 2, 2, ([a, b], c) => { const [X, Y] = xy(a, b, c); return cov(X, Y, p) })
function line(Y: number[], X: number[]) {
  const vx = varS(X, false)
  if (vx === 0) throw E.DIV0
  const slope = cov(X, Y, false) / vx
  return { slope, intercept: mean(Y) - slope * mean(X) }
}
def('SLOPE', 2, 2, ([y, x], c) => { const [Y, X] = xy(y, x, c); return line(Y, X).slope })
def('INTERCEPT', 2, 2, ([y, x], c) => { const [Y, X] = xy(y, x, c); return line(Y, X).intercept })
def('RSQ', 2, 2, ([y, x], c) => { const [Y, X] = xy(y, x, c); const d = varS(X, false) * varS(Y, false); if (d === 0) throw E.DIV0; return (cov(X, Y, false) ** 2) / d })
def('STEYX', 2, 2, ([y, x], c) => { const [Y, X] = xy(y, x, c); const { slope, intercept } = line(Y, X); if (Y.length < 3) throw E.DIV0; return Math.sqrt(Y.reduce((s, v, i) => s + (v - (intercept + slope * X[i])) ** 2, 0) / (Y.length - 2)) })
for (const n of ['FORECAST', 'FORECAST.LINEAR']) def(n, 3, 3, ([x0, y, x], c) => { const [Y, X] = xy(y, x, c); const l = line(Y, X); return l.intercept + l.slope * num(x0, c) })
def('TREND', 1, 4, ([y, x, nx], c) => {
  const Y = numbers([y], c)
  const X = x == null ? Y.map((_, i) => i + 1) : numbers([x], c)
  const l = line(Y, X)
  const targets = nx == null ? X : numbers([nx], c)
  return new Arr(targets.map((t) => [l.intercept + l.slope * t]))
})
def('GROWTH', 1, 4, ([y, x, nx], c) => {
  const Y = numbers([y], c)
  if (Y.some((v) => v <= 0)) throw E.NUM
  const X = x == null ? Y.map((_, i) => i + 1) : numbers([x], c)
  const l = line(Y.map(Math.log), X)
  const targets = nx == null ? X : numbers([nx], c)
  return new Arr(targets.map((t) => [Math.exp(l.intercept + l.slope * t)]))
})
def('LINEST', 1, 4, ([y, x, k, st], c) => {
  const Yv = numbers([y], c)
  const xa = x == null ? null : toArr(x, c)
  const rows = Yv.length
  const cols = xa ? (xa.rows === rows ? xa.cols : xa.rows) : 1
  const Xrows: number[][] = Array.from({ length: rows }, (_, i) => (xa ? Array.from({ length: cols }, (_, j) => toNumber(xa.rows === rows ? xa.a[i][j] : xa.a[j][i])) : [i + 1]))
  const withIntercept = k == null || toNumber(scalar(k, c)) !== 0
  const design = Xrows.map((r) => (withIntercept ? [...r, 1] : r))
  const p = design[0].length
  // Normal equations: (XtX) b = Xt y
  const XtX = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => design.reduce((s, r) => s + r[i] * r[j], 0)))
  const Xty = Array.from({ length: p }, (_, i) => design.reduce((s, r, k2) => s + r[i] * Yv[k2], 0))
  const inv = invertMatrix(XtX)
  const b = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0))
  const coef = [...b.slice(0, cols).reverse(), ...(withIntercept ? [b[p - 1]] : [])]
  if (!st || toNumber(scalar(st, c)) === 0) return new Arr([coef])
  const pred = design.map((r) => r.reduce((s, v, j) => s + v * b[j], 0))
  const ssRes = Yv.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0), my = mean(Yv)
  const ssTot = Yv.reduce((s, v) => s + (v - my) ** 2, 0), df = rows - p
  const mse = df > 0 ? ssRes / df : NaN
  const se = [...inv.map((r, i) => Math.sqrt(r[i] * mse)).slice(0, cols).reverse(), ...(withIntercept ? [Math.sqrt(inv[p - 1][p - 1] * mse)] : [])]
  const r2 = ssTot ? 1 - ssRes / ssTot : 1
  const F = df > 0 ? (r2 / (p - (withIntercept ? 1 : 0))) / ((1 - r2) / df) : NaN
  const width = coef.length
  const pad = (a: Scalar[]) => [...a, ...Array(width - a.length).fill(E.NA)]
  return new Arr([coef, se, pad([r2, Math.sqrt(mse)]), pad([F, df]), pad([ssTot - ssRes, ssRes])])
})
function invertMatrix(m: number[][]): number[][] {
  const n = m.length
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r
    if (Math.abs(a[p][i]) < 1e-12) throw E.NUM
    ;[a[p], a[i]] = [a[i], a[p]]
    const d = a[i][i]
    for (let k = 0; k < 2 * n; k++) a[i][k] /= d
    for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i]; for (let k = 0; k < 2 * n; k++) a[r][k] -= f * a[i][k] }
  }
  return a.map((r) => r.slice(n))
}

// ---- distributions
const cum = (a: Value[], c: Ctx, i: number) => a[i] != null && toNumber(scalar(a[i]!, c)) !== 0
for (const n of ['NORM.DIST', 'NORMDIST']) def(n, 4, 4, ([x, m, s, k], c) => {
  const sd = num(s, c); if (sd <= 0) throw E.NUM
  const z = (num(x, c) - num(m, c)) / sd
  return toNumber(scalar(k, c)) ? normCdf(z) : normPdf(z) / sd
}, { scalar: true })
for (const n of ['NORM.S.DIST', 'NORMSDIST']) def(n, 1, 2, ([z, k], c) => (n === 'NORMSDIST' || cum([z, k], c, 1) ? normCdf(num(z, c)) : normPdf(num(z, c))), { scalar: true })
for (const n of ['NORM.INV', 'NORMINV']) def(n, 3, 3, ([p, m, s], c) => { const sd = num(s, c); if (sd <= 0) throw E.NUM; return num(m, c) + sd * normInv(num(p, c)) }, { scalar: true })
for (const n of ['NORM.S.INV', 'NORMSINV']) def(n, 1, 1, ([p], c) => normInv(num(p, c)), { scalar: true })
def('GAUSS', 1, 1, ([z], c) => normCdf(num(z, c)) - 0.5, { scalar: true })
def('PHI', 1, 1, ([z], c) => normPdf(num(z, c)), { scalar: true })
def('STANDARDIZE', 3, 3, ([x, m, s], c) => { const sd = num(s, c); if (sd <= 0) throw E.NUM; return (num(x, c) - num(m, c)) / sd }, { scalar: true })
def('FISHER', 1, 1, ([x], c) => { const v = num(x, c); if (v <= -1 || v >= 1) throw E.NUM; return Math.atanh(v) }, { scalar: true })
def('FISHERINV', 1, 1, ([y], c) => Math.tanh(num(y, c)), { scalar: true })
def('ERF', 1, 2, ([a, b], c) => (b == null ? erf(num(a, c)) : erf(num(b, c)) - erf(num(a, c))), { scalar: true })
def('ERF.PRECISE', 1, 1, ([a], c) => erf(num(a, c)), { scalar: true })
def('ERFC', 1, 1, ([a], c) => 1 - erf(num(a, c)), { scalar: true })
def('GAMMALN', 1, 1, ([x], c) => { const v = num(x, c); if (v <= 0) throw E.NUM; return gammaln(v) }, { scalar: true })
def('GAMMALN.PRECISE', 1, 1, ([x], c) => { const v = num(x, c); if (v <= 0) throw E.NUM; return gammaln(v) }, { scalar: true })
def('GAMMA', 1, 1, ([x], c) => { const v = num(x, c); if (v <= 0 && v === Math.floor(v)) throw E.NUM; return gamma(v) }, { scalar: true })
const logChoose = (n: number, k: number) => gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1)
for (const n of ['BINOM.DIST', 'BINOMDIST']) def(n, 4, 4, ([k, t, p, cu], c) => {
  const s = Math.floor(num(k, c)), tr = Math.floor(num(t, c)), pr = num(p, c)
  if (s < 0 || s > tr || pr < 0 || pr > 1) throw E.NUM
  const pmf = (i: number) => (pr === 0 ? +(i === 0) : pr === 1 ? +(i === tr) : Math.exp(logChoose(tr, i) + i * Math.log(pr) + (tr - i) * Math.log(1 - pr)))
  if (!toNumber(scalar(cu, c))) return pmf(s)
  let sum = 0
  for (let i = 0; i <= s; i++) sum += pmf(i)
  return Math.min(1, sum)
}, { scalar: true })
def('BINOM.INV', 3, 3, ([t, p, a], c) => {
  const tr = Math.floor(num(t, c)), pr = num(p, c), al = num(a, c)
  if (tr < 0 || pr < 0 || pr > 1 || al < 0 || al > 1) throw E.NUM
  let sum = 0
  for (let i = 0; i <= tr; i++) { sum += Math.exp(logChoose(tr, i) + i * Math.log(pr || 1e-300) + (tr - i) * Math.log(1 - pr || 1e-300)); if (sum >= al - 1e-12) return i }
  return tr
}, { scalar: true })
for (const n of ['POISSON.DIST', 'POISSON']) def(n, 3, 3, ([k, m, cu], c) => {
  const x = Math.floor(num(k, c)), mu = num(m, c)
  if (x < 0 || mu < 0) throw E.NUM
  const pmf = (i: number) => Math.exp(-mu + i * Math.log(mu || 1e-300) - gammaln(i + 1))
  if (!toNumber(scalar(cu, c))) return mu === 0 ? +(x === 0) : pmf(x)
  return 1 - gammaP(x + 1, mu)
}, { scalar: true })
for (const n of ['EXPON.DIST', 'EXPONDIST']) def(n, 3, 3, ([x, l, cu], c) => { const v = num(x, c), lam = num(l, c); if (v < 0 || lam <= 0) throw E.NUM; return toNumber(scalar(cu, c)) ? 1 - Math.exp(-lam * v) : lam * Math.exp(-lam * v) }, { scalar: true })
for (const n of ['GAMMA.DIST', 'GAMMADIST']) def(n, 4, 4, ([x, a, b, cu], c) => {
  const v = num(x, c), al = num(a, c), be = num(b, c)
  if (v < 0 || al <= 0 || be <= 0) throw E.NUM
  return toNumber(scalar(cu, c)) ? gammaP(al, v / be) : Math.exp((al - 1) * Math.log(v || 1e-300) - v / be - gammaln(al) - al * Math.log(be))
}, { scalar: true })
for (const n of ['GAMMA.INV', 'GAMMAINV']) def(n, 3, 3, ([p, a, b], c) => { const pr = num(p, c), al = num(a, c), be = num(b, c); if (pr < 0 || pr >= 1 || al <= 0 || be <= 0) throw E.NUM; return be * invert((x) => gammaP(al, x), pr, 0, Math.max(1, al)) }, { scalar: true })
for (const n of ['LOGNORM.DIST', 'LOGNORMDIST']) def(n, 3, 4, ([x, m, s, cu], c) => {
  const v = num(x, c), mu = num(m, c), sd = num(s, c)
  if (v <= 0 || sd <= 0) throw E.NUM
  const z = (Math.log(v) - mu) / sd
  return n === 'LOGNORMDIST' || toNumber(scalar(cu, c)) ? normCdf(z) : normPdf(z) / (v * sd)
}, { scalar: true })
for (const n of ['LOGNORM.INV', 'LOGINV']) def(n, 3, 3, ([p, m, s], c) => Math.exp(num(m, c) + num(s, c) * normInv(num(p, c))), { scalar: true })
for (const n of ['WEIBULL.DIST', 'WEIBULL']) def(n, 4, 4, ([x, a, b, cu], c) => { const v = num(x, c), al = num(a, c), be = num(b, c); if (v < 0 || al <= 0 || be <= 0) throw E.NUM; return toNumber(scalar(cu, c)) ? 1 - Math.exp(-((v / be) ** al)) : (al / be ** al) * v ** (al - 1) * Math.exp(-((v / be) ** al)) }, { scalar: true })
def('BETA.DIST', 4, 6, ([x, a, b, cu, lo, hi], c) => {
  const A = lo == null ? 0 : num(lo, c), B = hi == null ? 1 : num(hi, c), v = (num(x, c) - A) / (B - A), al = num(a, c), be = num(b, c)
  if (v < 0 || v > 1 || al <= 0 || be <= 0) throw E.NUM
  return toNumber(scalar(cu, c)) ? betaI(v, al, be) : Math.exp(gammaln(al + be) - gammaln(al) - gammaln(be) + (al - 1) * Math.log(v) + (be - 1) * Math.log(1 - v)) / (B - A)
}, { scalar: true })
for (const n of ['T.DIST', 'TDIST', 'T.DIST.2T', 'T.DIST.RT']) def(n, n === 'T.DIST' ? 3 : n === 'TDIST' ? 3 : 2, 3, (a, c) => {
  const x = num(a[0]!, c), df = Math.floor(num(a[1]!, c))
  if (df < 1) throw E.NUM
  if (n === 'T.DIST') return toNumber(scalar(a[2]!, c)) ? tCdf(x, df) : Math.exp(gammaln((df + 1) / 2) - gammaln(df / 2)) / Math.sqrt(df * Math.PI) * (1 + (x * x) / df) ** (-(df + 1) / 2)
  if (n === 'TDIST') { if (x < 0) throw E.NUM; const tails = int(a[2]!, c); const p = 1 - tCdf(x, df); return tails === 1 ? p : 2 * p }
  if (n === 'T.DIST.2T') { if (x < 0) throw E.NUM; return 2 * (1 - tCdf(x, df)) }
  return 1 - tCdf(x, df)
}, { scalar: true })
for (const n of ['T.INV', 'T.INV.2T', 'TINV']) def(n, n === 'T.INV' ? 2 : 2, 2, ([p, d], c) => {
  const pr = num(p, c), df = Math.floor(num(d, c))
  if (pr <= 0 || pr > 1 || df < 1) throw E.NUM
  const target = n === 'T.INV' ? pr : 1 - pr / 2
  if (target === 0.5) return 0
  const lo = invert((x) => tCdf(x, df), Math.max(target, 1 - target), 0, 1)
  return target < 0.5 ? -lo : lo
}, { scalar: true })
for (const n of ['CHISQ.DIST', 'CHISQ.DIST.RT', 'CHIDIST']) def(n, 2, 3, (a, c) => {
  const x = num(a[0]!, c), df = Math.floor(num(a[1]!, c))
  if (x < 0 || df < 1) throw E.NUM
  if (n !== 'CHISQ.DIST') return 1 - gammaP(df / 2, x / 2)
  return toNumber(scalar(a[2]!, c)) ? gammaP(df / 2, x / 2) : Math.exp((df / 2 - 1) * Math.log(x || 1e-300) - x / 2 - (df / 2) * Math.LN2 - gammaln(df / 2))
}, { scalar: true })
for (const n of ['CHISQ.INV', 'CHISQ.INV.RT', 'CHIINV']) def(n, 2, 2, ([p, d], c) => { const pr = num(p, c), df = Math.floor(num(d, c)); if (pr < 0 || pr > 1 || df < 1) throw E.NUM; const t = n === 'CHISQ.INV' ? pr : 1 - pr; return 2 * invert((x) => gammaP(df / 2, x), t, 0, df / 2 + 1) }, { scalar: true })
for (const n of ['F.DIST', 'F.DIST.RT', 'FDIST']) def(n, 3, 4, (a, c) => {
  const x = num(a[0]!, c), d1 = num(a[1]!, c), d2 = num(a[2]!, c)
  if (x < 0 || d1 < 1 || d2 < 1) throw E.NUM
  const cdf = betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2)
  if (n !== 'F.DIST') return 1 - cdf
  return toNumber(scalar(a[3]!, c)) ? cdf : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (gammaln(d1 / 2) + gammaln(d2 / 2) - gammaln((d1 + d2) / 2)))
}, { scalar: true })
for (const n of ['F.INV', 'F.INV.RT', 'FINV']) def(n, 3, 3, ([p, a, b], c) => { const pr = num(p, c), d1 = num(a, c), d2 = num(b, c); if (pr <= 0 || pr >= 1) throw E.NUM; const t = n === 'F.INV' ? pr : 1 - pr; return invert((x) => betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2), t, 0, 1) }, { scalar: true })
for (const n of ['CONFIDENCE.NORM', 'CONFIDENCE']) def(n, 3, 3, ([a, s, k], c) => { const al = num(a, c), sd = num(s, c), size = num(k, c); if (al <= 0 || al >= 1 || sd <= 0 || size < 1) throw E.NUM; return (-normInv(al / 2) * sd) / Math.sqrt(size) }, { scalar: true })
def('CONFIDENCE.T', 3, 3, ([a, s, k], c) => {
  const al = num(a, c), sd = num(s, c), size = Math.floor(num(k, c))
  if (al <= 0 || al >= 1 || sd <= 0 || size < 2) throw E.NUM
  const t = invert((x) => tCdf(x, size - 1), 1 - al / 2, 0, 1)
  return (t * sd) / Math.sqrt(size)
}, { scalar: true })
def('Z.TEST', 2, 3, ([a, x, s], c) => { const xs = numbers([a], c), mu = num(x, c), sd = s == null ? Math.sqrt(varS(xs, false)) : num(s, c); return 1 - normCdf((mean(xs) - mu) / (sd / Math.sqrt(xs.length))) })
def('T.TEST', 4, 4, ([a, b, t, ty], c) => {
  const X = numbers([a], c), Y = numbers([b], c), tails = int(t, c), type = int(ty, c)
  let tv: number, df: number
  if (type === 1) { if (X.length !== Y.length) throw E.NA; const d = X.map((v, i) => v - Y[i]); tv = mean(d) / Math.sqrt(varS(d, false) / d.length); df = d.length - 1 }
  else if (type === 2) { const sp = ((X.length - 1) * varS(X, false) + (Y.length - 1) * varS(Y, false)) / (X.length + Y.length - 2); tv = (mean(X) - mean(Y)) / Math.sqrt(sp * (1 / X.length + 1 / Y.length)); df = X.length + Y.length - 2 }
  else { const a1 = varS(X, false) / X.length, b1 = varS(Y, false) / Y.length; tv = (mean(X) - mean(Y)) / Math.sqrt(a1 + b1); df = (a1 + b1) ** 2 / (a1 ** 2 / (X.length - 1) + b1 ** 2 / (Y.length - 1)) }
  const p = 1 - tCdf(Math.abs(tv), df)
  return tails === 1 ? p : 2 * p
})
export { isArrayArg, Ref }
