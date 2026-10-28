import { roundHalfUp } from '../numfmt'
import { Arr, E, isErr, Ref, type Scalar, type Value } from '../types'
import { clipRef, def, flat, int, isArrayArg, num, numbers, scalar, toArr, type Ctx } from '../eval'
import { toNumber } from '../coerce'

const fix = (x: number) => Number(x.toPrecision(15))
const chk = (x: number) => { if (!isFinite(x)) throw E.NUM; return x }

// ---- elementary
def('ABS', 1, 1, ([a], c) => Math.abs(num(a, c)), { scalar: true })
def('SIGN', 1, 1, ([a], c) => Math.sign(num(a, c)), { scalar: true })
def('SQRT', 1, 1, ([a], c) => { const x = num(a, c); if (x < 0) throw E.NUM; return Math.sqrt(x) }, { scalar: true })
def('SQRTPI', 1, 1, ([a], c) => { const x = num(a, c); if (x < 0) throw E.NUM; return Math.sqrt(x * Math.PI) }, { scalar: true })
def('EXP', 1, 1, ([a], c) => chk(Math.exp(num(a, c))), { scalar: true })
def('LN', 1, 1, ([a], c) => { const x = num(a, c); if (x <= 0) throw E.NUM; return Math.log(x) }, { scalar: true })
def('LOG10', 1, 1, ([a], c) => { const x = num(a, c); if (x <= 0) throw E.NUM; return Math.log10(x) }, { scalar: true })
def('LOG', 1, 2, ([a, b], c) => {
  const x = num(a, c), base = b === null || b === undefined ? 10 : num(b, c)
  if (x <= 0 || base <= 0 || base === 1) throw E.NUM
  return fix(Math.log(x) / Math.log(base))
}, { scalar: true })
def('POWER', 2, 2, ([a, b], c) => {
  const x = num(a, c), y = num(b, c)
  if (x === 0 && y < 0) throw E.DIV0
  return chk(Math.pow(x, y))
}, { scalar: true })
def('PI', 0, 0, () => Math.PI)
def('MOD', 2, 2, ([a, b], c) => { const n = num(a, c), d = num(b, c); if (d === 0) throw E.DIV0; return fix(n - d * Math.floor(n / d)) }, { scalar: true })
def('QUOTIENT', 2, 2, ([a, b], c) => { const d = num(b, c); if (d === 0) throw E.DIV0; return Math.trunc(num(a, c) / d) }, { scalar: true })
def('INT', 1, 1, ([a], c) => Math.floor(fix(num(a, c))), { scalar: true })
def('TRUNC', 1, 2, ([a, d], c) => { const p = 10 ** (d === null || d === undefined ? 0 : int(d, c)); return Math.trunc(fix(num(a, c) * p)) / p }, { scalar: true })
def('ROUND', 2, 2, ([a, d], c) => roundHalfUp(num(a, c), int(d, c)), { scalar: true })
def('ROUNDUP', 2, 2, ([a, d], c) => { const x = num(a, c), p = 10 ** int(d, c); return (Math.sign(x) * Math.ceil(fix(Math.abs(x) * p))) / p }, { scalar: true })
def('ROUNDDOWN', 2, 2, ([a, d], c) => { const x = num(a, c), p = 10 ** int(d, c); return (Math.sign(x) * Math.floor(fix(Math.abs(x) * p))) / p }, { scalar: true })
def('MROUND', 2, 2, ([a, b], c) => {
  const x = num(a, c), m = num(b, c)
  if (m === 0) return 0
  if (x * m < 0) throw E.NUM
  return fix(Math.sign(m) * roundHalfUp(Math.abs(x) / Math.abs(m), 0) * Math.abs(m))
}, { scalar: true })
def('CEILING', 1, 2, ([a, s], c) => {
  const x = num(a, c), sig = s === null || s === undefined ? (num(a, c) < 0 ? -1 : 1) : num(s, c)
  if (sig === 0) return 0
  if (x > 0 && sig < 0) throw E.NUM
  if (x >= 0) return fix(Math.ceil(fix(x / sig)) * sig)
  return sig < 0 ? fix(-Math.ceil(fix(-x / -sig)) * -sig) : fix(-Math.floor(fix(-x / sig)) * sig)
}, { scalar: true })
def('FLOOR', 1, 2, ([a, s], c) => {
  const x = num(a, c), sig = s === null || s === undefined ? (x < 0 ? -1 : 1) : num(s, c)
  if (sig === 0) throw E.DIV0
  if (x > 0 && sig < 0) throw E.NUM
  if (x >= 0) return fix(Math.floor(fix(x / sig)) * sig)
  return sig < 0 ? fix(-Math.floor(fix(-x / -sig)) * -sig) : fix(-Math.ceil(fix(-x / sig)) * sig)
}, { scalar: true })
for (const n of ['CEILING.PRECISE', 'ISO.CEILING', 'CEILING.MATH']) def(n, 1, 3, ([a, s, m], c) => {
  const x = num(a, c), sig = Math.abs(s === null || s === undefined ? 1 : num(s, c))
  if (sig === 0) return 0
  const away = n === 'CEILING.MATH' && m !== null && m !== undefined && num(m, c) !== 0
  return fix((x < 0 && away ? -Math.ceil(fix(-x / sig)) : Math.ceil(fix(x / sig))) * sig)
}, { scalar: true })
for (const n of ['FLOOR.PRECISE', 'FLOOR.MATH']) def(n, 1, 3, ([a, s, m], c) => {
  const x = num(a, c), sig = Math.abs(s === null || s === undefined ? 1 : num(s, c))
  if (sig === 0) return 0
  const away = n === 'FLOOR.MATH' && m !== null && m !== undefined && num(m, c) !== 0
  return fix((x < 0 && away ? -Math.floor(fix(-x / sig)) : Math.floor(fix(x / sig))) * sig)
}, { scalar: true })
def('EVEN', 1, 1, ([a], c) => { const x = num(a, c); const r = 2 * Math.ceil(Math.abs(x) / 2); return x < 0 ? -r : r }, { scalar: true })
def('ODD', 1, 1, ([a], c) => { const x = num(a, c); let r = 2 * Math.ceil((Math.abs(x) + 1) / 2) - 1; if (Math.abs(x) === 0) r = 1; return x < 0 ? -r : r }, { scalar: true })

// ---- trig
const trig: [string, (x: number) => number, boolean?][] = [
  ['SIN', Math.sin], ['COS', Math.cos], ['TAN', Math.tan], ['ASIN', Math.asin, true], ['ACOS', Math.acos, true], ['ATAN', Math.atan],
  ['SINH', Math.sinh], ['COSH', Math.cosh], ['TANH', Math.tanh], ['ASINH', Math.asinh], ['ACOSH', Math.acosh, true], ['ATANH', Math.atanh, true],
  ['DEGREES', (x) => (x * 180) / Math.PI], ['RADIANS', (x) => (x * Math.PI) / 180],
  ['COT', (x) => 1 / Math.tan(x)], ['SEC', (x) => 1 / Math.cos(x)], ['CSC', (x) => 1 / Math.sin(x)],
  ['ACOT', (x) => Math.atan(1 / x)], ['COTH', (x) => 1 / Math.tanh(x)], ['SECH', (x) => 1 / Math.cosh(x)], ['CSCH', (x) => 1 / Math.sinh(x)],
]
for (const [n, f, dom] of trig) def(n, 1, 1, ([a], c) => { const r = f(num(a, c)); if (isNaN(r) || (dom && !isFinite(r))) throw E.NUM; return chk(r) }, { scalar: true })
def('ATAN2', 2, 2, ([x, y], c) => { const a = num(x, c), b = num(y, c); if (a === 0 && b === 0) throw E.DIV0; return Math.atan2(b, a) }, { scalar: true })

// ---- combinatorics
export const fact = (n: number): number => { if (n < 0) throw E.NUM; n = Math.floor(n); if (n > 170) throw E.NUM; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r }
const combin = (n: number, k: number) => { if (n < 0 || k < 0 || k > n) throw E.NUM; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r) }
def('FACT', 1, 1, ([a], c) => fact(num(a, c)), { scalar: true })
def('FACTDOUBLE', 1, 1, ([a], c) => { let n = Math.floor(num(a, c)); if (n < -1) throw E.NUM; let r = 1; for (; n > 1; n -= 2) r *= n; return r }, { scalar: true })
def('COMBIN', 2, 2, ([a, b], c) => combin(Math.floor(num(a, c)), Math.floor(num(b, c))), { scalar: true })
def('COMBINA', 2, 2, ([a, b], c) => { const n = Math.floor(num(a, c)), k = Math.floor(num(b, c)); if (n < 0 || k < 0) throw E.NUM; return n === 0 && k === 0 ? 1 : combin(n + k - 1, k) }, { scalar: true })
def('PERMUT', 2, 2, ([a, b], c) => { const n = Math.floor(num(a, c)), k = Math.floor(num(b, c)); if (n < 0 || k < 0 || k > n) throw E.NUM; let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r }, { scalar: true })
def('PERMUTATIONA', 2, 2, ([a, b], c) => { const n = Math.floor(num(a, c)), k = Math.floor(num(b, c)); if (n < 0 || k < 0) throw E.NUM; return n ** k }, { scalar: true })
const gcd2 = (a: number, b: number): number => (b === 0 ? a : gcd2(b, a % b))
def('GCD', 1, 255, (args, c) => numbers(args, c).reduce((a, b) => { if (b < 0) throw E.NUM; return gcd2(a, Math.floor(b)) }, 0))
def('LCM', 1, 255, (args, c) => numbers(args, c).reduce((a, b) => { if (b < 0) throw E.NUM; b = Math.floor(b); return a === 0 || b === 0 ? 0 : (a / gcd2(a, b)) * b }, 1))

// ---- sums and products
def('SUM', 1, 255, (args, c) => fix(numbers(args, c).reduce((a, b) => a + b, 0)))
def('PRODUCT', 1, 255, (args, c) => { const n = numbers(args, c); return n.length ? n.reduce((a, b) => a * b, 1) : 0 })
def('SUMSQ', 1, 255, (args, c) => numbers(args, c).reduce((a, b) => a + b * b, 0))
function pairs(a: Value, b: Value, c: Ctx): [number, number][] {
  const x = toArr(a, c), y = toArr(b, c)
  if (x.rows !== y.rows || x.cols !== y.cols) throw E.NA
  const out: [number, number][] = []
  x.a.forEach((row, i) => row.forEach((v, j) => { const w = y.a[i][j]; if (isErr(v)) throw v; if (isErr(w)) throw w; out.push([typeof v === 'number' ? v : 0, typeof w === 'number' ? w : 0]) }))
  return out
}
def('SUMX2MY2', 2, 2, ([a, b], c) => pairs(a, b, c).reduce((s, [x, y]) => s + x * x - y * y, 0))
def('SUMX2PY2', 2, 2, ([a, b], c) => pairs(a, b, c).reduce((s, [x, y]) => s + x * x + y * y, 0))
def('SUMXMY2', 2, 2, ([a, b], c) => pairs(a, b, c).reduce((s, [x, y]) => s + (x - y) ** 2, 0))
def('SUMPRODUCT', 1, 255, (args, c) => {
  const arrs = args.map((a) => toArr(a, c))
  const { rows, cols } = arrs[0]
  if (arrs.some((a) => a.rows !== rows || a.cols !== cols)) throw E.VALUE
  let sum = 0
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    let p = 1
    for (const a of arrs) { const v = a.a[i][j]; if (isErr(v)) throw v; p *= typeof v === 'number' ? v : 0 }
    sum += p
  }
  return fix(sum)
})

// ---- random
def('RAND', 0, 0, () => Math.random(), { volatile: true })
def('RANDBETWEEN', 2, 2, ([a, b], c) => { const lo = Math.ceil(num(a, c)), hi = Math.floor(num(b, c)); if (lo > hi) throw E.NUM; return lo + Math.floor(Math.random() * (hi - lo + 1)) }, { volatile: true })
def('RANDARRAY', 0, 5, (a, c) => {
  const rows = a[0] == null ? 1 : int(a[0], c), cols = a[1] == null ? 1 : int(a[1], c)
  const lo = a[2] == null ? 0 : num(a[2], c), hi = a[3] == null ? 1 : num(a[3], c), whole = a[4] == null ? false : toNumber(scalar(a[4], c)) !== 0
  if (rows < 1 || cols < 1 || rows * cols > 1e6) throw E.VALUE
  return Arr.of(rows, cols, () => (whole ? Math.ceil(lo) + Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) : lo + Math.random() * (hi - lo)))
}, { volatile: true })
def('SEQUENCE', 1, 4, (a, c) => {
  const rows = int(a[0]!, c), cols = a[1] == null ? 1 : int(a[1], c), start = a[2] == null ? 1 : num(a[2], c), step = a[3] == null ? 1 : num(a[3], c)
  if (rows < 1 || cols < 1) throw E.CALC
  if (rows * cols > 5e6) throw E.NUM
  return Arr.of(rows, cols, (r, k) => start + (r * cols + k) * step)
})

// ---- number systems
const ROMANS: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
def('ROMAN', 1, 2, ([a], c) => { let n = Math.floor(num(a, c)); if (n < 0 || n > 3999) throw E.VALUE; if (n === 0) return ''; let s = ''; for (const [v, r] of ROMANS) while (n >= v) { s += r; n -= v } return s }, { scalar: true })
def('ARABIC', 1, 1, ([a], c) => {
  const s = String(scalar(a, c) ?? '').toUpperCase().trim()
  if (!/^[MDCLXVI]*$/.test(s)) throw E.VALUE
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  let n = 0
  for (let i = 0; i < s.length; i++) { const v = val[s[i]], nx = val[s[i + 1]] ?? 0; n += v < nx ? -v : v }
  return n
}, { scalar: true })
def('BASE', 2, 3, ([a, b, m], c) => {
  const n = Math.floor(num(a, c)), radix = Math.floor(num(b, c)), min = m == null ? 0 : int(m, c)
  if (n < 0 || radix < 2 || radix > 36) throw E.NUM
  return n.toString(radix).toUpperCase().padStart(min, '0')
}, { scalar: true })
def('DECIMAL', 2, 2, ([a, b], c) => {
  const s = String(scalar(a, c) ?? '').trim().toUpperCase(), radix = int(b, c)
  if (radix < 2 || radix > 36) throw E.NUM
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, radix)
  if (!s || [...s].some((ch) => !digits.includes(ch))) throw E.NUM
  return parseInt(s, radix)
}, { scalar: true })
const bits: [string, (a: number, b: number) => number][] = [['BITAND', (a, b) => Number(BigInt(a) & BigInt(b))], ['BITOR', (a, b) => Number(BigInt(a) | BigInt(b))], ['BITXOR', (a, b) => Number(BigInt(a) ^ BigInt(b))]]
for (const [n, f] of bits) def(n, 2, 2, ([a, b], c) => { const x = num(a, c), y = num(b, c); if (x < 0 || y < 0 || x !== Math.floor(x) || y !== Math.floor(y) || x >= 2 ** 48 || y >= 2 ** 48) throw E.NUM; return f(x, y) }, { scalar: true })
def('BITLSHIFT', 2, 2, ([a, b], c) => { const x = num(a, c), s = int(b, c); if (x < 0 || x >= 2 ** 48) throw E.NUM; return s >= 0 ? x * 2 ** s : Math.floor(x / 2 ** -s) }, { scalar: true })
def('BITRSHIFT', 2, 2, ([a, b], c) => { const x = num(a, c), s = int(b, c); if (x < 0 || x >= 2 ** 48) throw E.NUM; return s >= 0 ? Math.floor(x / 2 ** s) : x * 2 ** -s }, { scalar: true })

// ---- matrices
function matrix(v: Value, c: Ctx): number[][] {
  return toArr(v, c).a.map((r) => r.map((x) => { if (isErr(x)) throw x; if (typeof x !== 'number') throw E.VALUE; return x }))
}
def('TRANSPOSE', 1, 1, ([a], c) => { const m = toArr(a, c); return Arr.of(m.cols, m.rows, (r, k) => m.a[k][r]) })
def('MMULT', 2, 2, ([a, b], c) => {
  const x = matrix(a, c), y = matrix(b, c)
  if (x[0].length !== y.length) throw E.VALUE
  return Arr.of(x.length, y[0].length, (i, j) => x[i].reduce((s, v, k) => s + v * y[k][j], 0))
})
function det(m: number[][]): number {
  const n = m.length, a = m.map((r) => [...r])
  let d = 1
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r
    if (Math.abs(a[p][i]) < 1e-300) return 0
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; d = -d }
    d *= a[i][i]
    for (let r = i + 1; r < n; r++) { const f = a[r][i] / a[i][i]; for (let k = i; k < n; k++) a[r][k] -= f * a[i][k] }
  }
  return d
}
export function invert(m: number[][]): number[][] {
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
def('MDETERM', 1, 1, ([a], c) => { const m = matrix(a, c); if (m.length !== m[0].length) throw E.VALUE; return fix(det(m)) })
def('MINVERSE', 1, 1, ([a], c) => { const m = matrix(a, c); if (m.length !== m[0].length) throw E.VALUE; return new Arr(invert(m).map((r) => r.map(fix))) })
def('MUNIT', 1, 1, ([a], c) => { const n = int(a, c); if (n < 1) throw E.VALUE; return Arr.of(n, n, (i, j) => (i === j ? 1 : 0)) })
def('SERIESSUM', 4, 4, ([x, n, m, co], c) => {
  const xv = num(x, c), nv = num(n, c), mv = num(m, c)
  return flat(co, c).reduce<number>((s, v, i) => s + toNumber(v) * xv ** (nv + i * mv), 0)
})

// ---- SUBTOTAL / AGGREGATE (these can skip hidden or filtered rows)
function visibleCells(args: Value[], c: Ctx, skipHidden: boolean, skipNested: boolean, skipErrors: boolean): Scalar[] {
  const out: Scalar[] = []
  for (const a of args) {
    if (a instanceof Ref) {
      const r = clipRef(c, a)
      for (let i = r.r1; i <= r.r2; i++) {
        if (c.host.rowFiltered?.(r.sheet, i)) continue
        if (skipHidden && c.host.rowHidden?.(r.sheet, i)) continue
        for (let j = r.c1; j <= r.c2; j++) {
          const f = skipNested ? c.host.formulaText(r.sheet, i, j) : null
          if (f && /\b(SUBTOTAL|AGGREGATE)\(/i.test(f)) continue
          const v = c.host.cell(r.sheet, i, j)
          if (skipErrors && isErr(v)) continue
          out.push(v)
        }
      }
    } else out.push(...flat(a, c))
  }
  return out
}
function agg(fn: number, vals: Scalar[], extra?: number): Scalar {
  const nums = vals.filter((v): v is number => typeof v === 'number')
  const errs = vals.find(isErr)
  if (errs && ![2, 3].includes(fn)) return errs
  const mean = () => { if (!nums.length) throw E.DIV0; return nums.reduce((a, b) => a + b, 0) / nums.length }
  const sd = (pop: boolean) => { const n = nums.length; if (n < (pop ? 1 : 2)) throw E.DIV0; const m = mean(); return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (pop ? n : n - 1)) }
  switch (fn) {
    case 1: return mean()
    case 2: return nums.length
    case 3: return vals.filter((v) => v !== null && v !== '').length
    case 4: return nums.length ? Math.max(...nums) : 0
    case 5: return nums.length ? Math.min(...nums) : 0
    case 6: return nums.reduce((a, b) => a * b, nums.length ? 1 : 0)
    case 7: return sd(false)
    case 8: return sd(true)
    case 9: return fix(nums.reduce((a, b) => a + b, 0))
    case 10: { const m = mean(); return nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1) }
    case 11: { const m = mean(); return nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length }
    case 12: { const s = [...nums].sort((a, b) => a - b); if (!s.length) throw E.NUM; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }
    case 14: { const s = [...nums].sort((a, b) => b - a); const k = extra ?? 1; if (k < 1 || k > s.length) throw E.NUM; return s[k - 1] }
    case 15: { const s = [...nums].sort((a, b) => a - b); const k = extra ?? 1; if (k < 1 || k > s.length) throw E.NUM; return s[k - 1] }
    default: throw E.VALUE
  }
}
def('SUBTOTAL', 2, 255, (a, c) => {
  const code = int(a[0]!, c)
  const fn = code > 100 ? code - 100 : code
  if (fn < 1 || fn > 11) throw E.VALUE
  return agg(fn, visibleCells(a.slice(1), c, code > 100, true, false))
})
def('AGGREGATE', 3, 255, (a, c) => {
  const fn = int(a[0]!, c), opt = int(a[1]!, c)
  if (fn < 1 || fn > 19) throw E.VALUE
  const hasK = fn >= 14
  const refs = hasK ? [a[2]!] : a.slice(2)
  const vals = visibleCells(refs, c, [1, 3, 5, 7].includes(opt), true, opt >= 2 && opt !== 4 && opt !== 5 || opt === 6 || opt === 7)
  return agg(fn, vals, hasK && a[3] ? num(a[3], c) : undefined)
})

export { fix as _fix, isArrayArg }
