import { toNumber } from '../coerce'
import { Arr, E, type Value } from '../types'
import { def, flat, int, num, numbers, scalar, type Ctx } from '../eval'

const opt = (v: Value | undefined | null) => v === undefined || v === null
const o = (v: Value | undefined | null, c: Ctx, d: number) => (opt(v) ? d : num(v!, c))

const pmt = (r: number, n: number, pv: number, fv: number, t: number) => (r === 0 ? -(pv + fv) / n : (-(pv * (1 + r) ** n + fv) * r) / ((1 + r * t) * ((1 + r) ** n - 1)))
const fv = (r: number, n: number, p: number, pv: number, t: number) => (r === 0 ? -(pv + p * n) : -(pv * (1 + r) ** n + (p * (1 + r * t) * ((1 + r) ** n - 1)) / r))
const pvf = (r: number, n: number, p: number, f: number, t: number) => (r === 0 ? -(f + p * n) : -(f + (p * (1 + r * t) * ((1 + r) ** n - 1)) / r) / (1 + r) ** n)

def('PMT', 3, 5, ([r, n, pv, f, t], c) => { const nn = num(n, c); if (nn === 0) throw E.NUM; return pmt(num(r, c), nn, num(pv, c), o(f, c, 0), o(t, c, 0)) }, { scalar: true })
def('FV', 3, 5, ([r, n, p, pv, t], c) => fv(num(r, c), num(n, c), num(p, c), o(pv, c, 0), o(t, c, 0)), { scalar: true })
def('PV', 3, 5, ([r, n, p, f, t], c) => pvf(num(r, c), num(n, c), num(p, c), o(f, c, 0), o(t, c, 0)), { scalar: true })
def('NPER', 3, 5, ([r, p, pv, f, t], c) => {
  const rate = num(r, c), pay = num(p, c), pval = num(pv, c), fval = o(f, c, 0), type = o(t, c, 0)
  if (rate === 0) { if (pay === 0) throw E.NUM; return -(pval + fval) / pay }
  const a = pay * (1 + rate * type) - fval * rate, b = pay * (1 + rate * type) + pval * rate
  if (a / b <= 0) throw E.NUM
  return Math.log(a / b) / Math.log(1 + rate)
}, { scalar: true })
def('RATE', 3, 6, ([n, p, pv, f, t, g], c) => {
  const nper = num(n, c), pay = num(p, c), pval = num(pv, c), fval = o(f, c, 0), type = o(t, c, 0)
  let r = o(g, c, 0.1)
  for (let i = 0; i < 100; i++) {
    const f1 = (rate: number) => (rate === 0 ? pval + pay * nper + fval : pval * (1 + rate) ** nper + (pay * (1 + rate * type) * ((1 + rate) ** nper - 1)) / rate + fval)
    const y = f1(r), h = 1e-7, d = (f1(r + h) - y) / h
    if (d === 0) break
    const nr = r - y / d
    if (Math.abs(nr - r) < 1e-12) return nr
    r = nr
  }
  throw E.NUM
}, { scalar: true })
function ipmt(r: number, per: number, n: number, pv: number, f: number, t: number): number {
  const pay = pmt(r, n, pv, f, t)
  if (t === 1) return per === 1 ? 0 : fv(r, per - 2, pay, pv, 1) * r
  return fv(r, per - 1, pay, pv, 0) * r
}
def('IPMT', 4, 6, ([r, per, n, pv, f, t], c) => { const p = num(per, c), nn = num(n, c); if (p < 1 || p > nn) throw E.NUM; return ipmt(num(r, c), p, nn, num(pv, c), o(f, c, 0), o(t, c, 0)) }, { scalar: true })
def('PPMT', 4, 6, ([r, per, n, pv, f, t], c) => { const p = num(per, c), nn = num(n, c); if (p < 1 || p > nn) throw E.NUM; const rate = num(r, c), pval = num(pv, c), fval = o(f, c, 0), type = o(t, c, 0); return pmt(rate, nn, pval, fval, type) - ipmt(rate, p, nn, pval, fval, type) }, { scalar: true })
def('ISPMT', 4, 4, ([r, per, n, pv], c) => { const rate = num(r, c), nn = num(n, c); return -num(pv, c) * rate * (1 - num(per, c) / nn) }, { scalar: true })
def('CUMIPMT', 6, 6, ([r, n, pv, s, e, t], c) => { let sum = 0; const rate = num(r, c), nn = num(n, c), pval = num(pv, c), type = num(t, c); for (let p = int(s, c); p <= int(e, c); p++) sum += ipmt(rate, p, nn, pval, 0, type); return sum })
def('CUMPRINC', 6, 6, ([r, n, pv, s, e, t], c) => { let sum = 0; const rate = num(r, c), nn = num(n, c), pval = num(pv, c), type = num(t, c); for (let p = int(s, c); p <= int(e, c); p++) sum += pmt(rate, nn, pval, 0, type) - ipmt(rate, p, nn, pval, 0, type); return sum })
def('NPV', 2, 255, ([r, ...vals], c) => { const rate = num(r, c); return numbers(vals as Value[], c).reduce((s, v, i) => s + v / (1 + rate) ** (i + 1), 0) })
function irr(cf: number[], guess: number): number {
  if (!cf.some((v) => v > 0) || !cf.some((v) => v < 0)) throw E.NUM
  const npv = (r: number) => cf.reduce((s, v, i) => s + v / (1 + r) ** i, 0)
  let r = guess
  for (let i = 0; i < 100; i++) {
    const y = npv(r), h = 1e-7, d = (npv(r + h) - y) / h
    if (d === 0 || !isFinite(d)) break
    const nr = r - y / d
    if (nr <= -1) break
    if (Math.abs(nr - r) < 1e-12) return nr
    r = nr
  }
  let lo = -0.9999, hi = 10
  if (npv(lo) * npv(hi) > 0) throw E.NUM
  for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid }
  return (lo + hi) / 2
}
def('IRR', 1, 2, ([v, g], c) => irr(numbers([v], c), o(g, c, 0.1)))
def('MIRR', 3, 3, ([v, fr, rr], c) => {
  const cf = numbers([v], c), f = num(fr, c), r = num(rr, c), n = cf.length
  const pos = cf.reduce((s, x, i) => s + (x > 0 ? x * (1 + r) ** (n - 1 - i) : 0), 0), neg = cf.reduce((s, x, i) => s + (x < 0 ? x / (1 + f) ** i : 0), 0)
  if (!pos || !neg) throw E.DIV0
  return (pos / -neg) ** (1 / (n - 1)) - 1
})
function dated(v: Value, d: Value, c: Ctx) {
  const vals = numbers([v], c), dates = flat(d, c).map((x) => Math.floor(toNumber(x)))
  if (vals.length !== dates.length) throw E.NUM
  return { vals, dates }
}
def('XNPV', 3, 3, ([r, v, d], c) => { const rate = num(r, c), { vals, dates } = dated(v, d, c); return vals.reduce((s, x, i) => s + x / (1 + rate) ** ((dates[i] - dates[0]) / 365), 0) })
def('XIRR', 2, 3, ([v, d, g], c) => {
  const { vals, dates } = dated(v, d, c)
  if (!vals.some((x) => x > 0) || !vals.some((x) => x < 0)) throw E.NUM
  const f = (r: number) => vals.reduce((s, x, i) => s + x / (1 + r) ** ((dates[i] - dates[0]) / 365), 0)
  let r = o(g, c, 0.1)
  for (let i = 0; i < 100; i++) { const y = f(r), h = 1e-7, dd = (f(r + h) - y) / h; if (!dd || !isFinite(dd)) break; const nr = r - y / dd; if (nr <= -1) break; if (Math.abs(nr - r) < 1e-12) return nr; r = nr }
  let lo = -0.9999, hi = 100
  if (f(lo) * f(hi) > 0) throw E.NUM
  for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid }
  return (lo + hi) / 2
})
def('SLN', 3, 3, ([a, b, l], c) => { const life = num(l, c); if (life === 0) throw E.DIV0; return (num(a, c) - num(b, c)) / life }, { scalar: true })
def('SYD', 4, 4, ([a, b, l, p], c) => { const cost = num(a, c), salv = num(b, c), life = num(l, c), per = num(p, c); if (per < 1 || per > life || life <= 0) throw E.NUM; return ((cost - salv) * (life - per + 1) * 2) / (life * (life + 1)) }, { scalar: true })
def('DDB', 4, 5, ([a, b, l, p, f], c) => {
  const cost = num(a, c), salv = num(b, c), life = num(l, c), per = num(p, c), factor = o(f, c, 2)
  if (cost < 0 || salv < 0 || life <= 0 || per < 1 || per > life) throw E.NUM
  let book = cost, dep = 0
  for (let i = 1; i <= per; i++) { dep = Math.min((book * factor) / life, Math.max(0, book - salv)); book -= dep }
  return dep
}, { scalar: true })
def('DB', 4, 5, ([a, b, l, p, m], c) => {
  const cost = num(a, c), salv = num(b, c), life = num(l, c), per = num(p, c), months = o(m, c, 12)
  if (cost < 0 || salv < 0 || life <= 0 || per < 1) throw E.NUM
  const rate = Math.round((1 - (salv / cost) ** (1 / life)) * 1000) / 1000
  let total = 0, dep = 0
  for (let i = 1; i <= Math.min(per, life + 1); i++) {
    dep = i === 1 ? (cost * rate * months) / 12 : i === life + 1 ? ((cost - total) * rate * (12 - months)) / 12 : (cost - total) * rate
    total += dep
  }
  return dep
}, { scalar: true })
def('EFFECT', 2, 2, ([r, n], c) => { const k = Math.floor(num(n, c)); if (num(r, c) <= 0 || k < 1) throw E.NUM; return (1 + num(r, c) / k) ** k - 1 }, { scalar: true })
def('NOMINAL', 2, 2, ([r, n], c) => { const k = Math.floor(num(n, c)); if (num(r, c) <= 0 || k < 1) throw E.NUM; return k * ((1 + num(r, c)) ** (1 / k) - 1) }, { scalar: true })
def('FVSCHEDULE', 2, 2, ([p, s], c) => flat(s, c).reduce<number>((a, r) => a * (1 + toNumber(r)), num(p, c)))
def('PDURATION', 3, 3, ([r, p, f], c) => { const rate = num(r, c), a = num(p, c), b = num(f, c); if (rate <= 0 || a <= 0 || b <= 0) throw E.NUM; return Math.log(b / a) / Math.log(1 + rate) }, { scalar: true })
def('RRI', 3, 3, ([n, p, f], c) => { const k = num(n, c); if (k <= 0) throw E.NUM; return (num(f, c) / num(p, c)) ** (1 / k) - 1 }, { scalar: true })
def('DOLLARDE', 2, 2, ([a, b], c) => { const f = Math.floor(num(b, c)); if (f < 1) throw E.NUM; const x = num(a, c), i = Math.trunc(x); return i + ((x - i) * 10 ** Math.ceil(Math.log10(f))) / f }, { scalar: true })
def('DOLLARFR', 2, 2, ([a, b], c) => { const f = Math.floor(num(b, c)); if (f < 1) throw E.NUM; const x = num(a, c), i = Math.trunc(x); return i + ((x - i) * f) / 10 ** Math.ceil(Math.log10(f)) }, { scalar: true })
export { Arr, scalar }
