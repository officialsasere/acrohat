import { parseDateTime } from './dates'
import { formatGeneral } from './numfmt'
import { Arr, E, isErr, Ref, XlErr, type Scalar, type Value } from './types'

/** Text of a number the way "&" and TEXT-less conversions show it: up to 15 significant digits. */
export function numToText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  if (!isFinite(n)) return '#NUM!'
  const a = Math.abs(n)
  if (a >= 1e15 || a < 1e-5) return n.toExponential(14).replace(/\.?0+e/, 'E').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2')
  return String(Number(n.toPrecision(15)))
}

export function toText(v: Scalar): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return numToText(v)
  return v.code
}

/** Text that reads as a number: "12", "1,234.5", "$5", "12%", "(5)", "1e3". Returns null if it is not one. */
export function parseNumberText(s: string): number | null {
  let t = s.trim()
  if (!t) return null
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim() }
  if (t[0] === '-') { neg = !neg; t = t.slice(1).trim() } else if (t[0] === '+') t = t.slice(1).trim()
  let pct = false
  if (t.endsWith('%')) { pct = true; t = t.slice(0, -1).trim() }
  t = t.replace(/^[$€£¥₹]\s*/, '').replace(/\s*[$€£¥₹]$/, '')
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d*)?([eE][+-]?\d+)?$/.test(t) || !/\d/.test(t)) return null
  const n = parseFloat(t.replace(/,/g, ''))
  if (isNaN(n)) return null
  return (neg ? -1 : 1) * (pct ? n / 100 : n)
}

/** Converts for arithmetic: empty is 0, TRUE is 1, "12" is 12, dates written as text become serials. Throws #VALUE! otherwise. */
export function toNumber(v: Scalar): number {
  if (typeof v === 'number') return v
  if (v === null) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const n = parseNumberText(v)
    if (n !== null) return n
    const d = parseDateTime(v)
    if (d) return d.serial
    throw E.VALUE
  }
  throw v
}

export function toBool(v: Scalar): boolean {
  if (typeof v === 'boolean') return v
  if (v === null) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase()
    if (u === 'TRUE') return true
    if (u === 'FALSE') return false
    throw E.VALUE
  }
  throw v
}

/** Numbers are compared to 15 significant digits, like the other spreadsheets: 0.1+0.2 equals 0.3. */
const same15 = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(15)) : n)

const rank = (v: Scalar) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3)

/** Orders values the way sheets do: numbers, then text (ignoring case), then booleans. Empty counts as 0 or "" or FALSE. */
export function compareValues(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  if (isErr(a) || isErr(b)) throw isErr(a) ? a : (b as XlErr)
  const ra = rank(a), rb = rank(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  if (ra === 1) { const x = same15(a as number), y = same15(b as number); return x < y ? -1 : x > y ? 1 : 0 }
  if (ra === 2) {
    const x = (a as string).toLowerCase(), y = (b as string).toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  return a === b ? 0 : a ? 1 : -1
}

export const isArrayish = (v: Value): v is Arr | Ref => v instanceof Arr || (v instanceof Ref && !v.single)
export { formatGeneral }
