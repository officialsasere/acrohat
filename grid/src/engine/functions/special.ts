/** Special functions behind the statistics and distribution formulas. */
import { E } from '../types'

export function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26 is too coarse; use a series for small x and a continued fraction for large.
  const ax = Math.abs(x)
  if (ax < 2.5) {
    let sum = ax, term = ax, n = 0
    while (Math.abs(term) > 1e-17 * Math.abs(sum) && n < 200) { n++; term *= (-ax * ax) / n; sum += term / (2 * n + 1) }
    const r = (2 / Math.sqrt(Math.PI)) * sum
    return x < 0 ? -r : r
  }
  const r = 1 - erfcCf(ax)
  return x < 0 ? -r : r
}
function erfcCf(x: number): number {
  // Lentz continued fraction for erfc
  let f = 0
  for (let k = 60; k >= 1; k--) f = (k / 2) / (x + f)
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * (x + f))
}
export const erfc = (x: number) => (x < 2.5 ? 1 - erf(x) : erfcCf(x))

export const normCdf = (z: number) => 0.5 * erfc(-z / Math.SQRT2)
export const normPdf = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)

/** Inverse of the standard normal CDF (Acklam's algorithm, refined with one Newton step). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw E.NUM
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  let x: number
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1) }
  else { const q = p - 0.5, r = q * q; x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1) }
  for (let i = 0; i < 2; i++) { const e = normCdf(x) - p; x -= e / normPdf(x) }
  return x
}

const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
export function gammaln(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - gammaln(1 - x)
  x -= 1
  let a = LG[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i++) a += LG[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}
export const gamma = (x: number): number => (x === Math.floor(x) && x > 0 && x < 171 ? Math.round(Math.exp(gammaln(x))) : x < 0.5 ? Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x)) : Math.exp(gammaln(x)))

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    let sum = 1 / a, term = sum
    for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-16) break }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a))
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-16) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaln(a)) * h
}

/** Regularised incomplete beta I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x))
  const cf = (x: number, a: number, b: number) => {
    let c = 1, d = 1 - ((a + b) * x) / (a + 1)
    if (Math.abs(d) < 1e-300) d = 1e-300
    d = 1 / d
    let h = d
    for (let m = 1; m <= 500; m++) {
      const m2 = 2 * m
      let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300
      d = 1 / d; h *= d * c
      aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300
      d = 1 / d
      const del = d * c
      h *= del
      if (Math.abs(del - 1) < 1e-16) break
    }
    return h
  }
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b
}

export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t)
  const p = 0.5 * betaI(x, df / 2, 0.5)
  return t > 0 ? 1 - p : p
}

/** Finds x with f(x) = target for increasing f, by bracketing and bisection. */
export function invert(f: (x: number) => number, target: number, lo: number, hi: number, grow = true): number {
  if (grow) { let n = 0; while (f(hi) < target && n++ < 200) { lo = hi; hi *= 2 } }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < target) lo = mid; else hi = mid
    if (Math.abs(hi - lo) < 1e-14 * Math.max(1, Math.abs(mid))) break
  }
  return (lo + hi) / 2
}
