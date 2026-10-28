import { compareValues, parseNumberText } from './coerce'
import { parseDateTime } from './dates'
import { isErr, type Scalar } from './types'

/** Turns a criterion such as ">5", "<>apple", "a*", "=", 7 or TRUE into a test for cell values (COUNTIF, SUMIF and friends). */
export function criteria(c: Scalar): (x: Scalar) => boolean {
  if (isErr(c)) return () => false
  if (typeof c === 'number') return (x) => typeof x === 'number' && x === c
  if (typeof c === 'boolean') return (x) => x === c
  if (c === null) return (x) => typeof x === 'number' && x === 0
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!
  const op = m[1] ?? ''
  const rest = m[2]
  const n = parseNumberText(rest) ?? (rest.trim() && /\d/.test(rest) ? parseDateTime(rest)?.serial ?? null : null)
  const b = /^(TRUE|FALSE)$/i.test(rest.trim()) ? rest.trim().toUpperCase() === 'TRUE' : null
  const isText = n === null && b === null
  const wild = /[*?~]/.test(rest)
  const re = wild ? wildcardRegex(rest) : null
  const eqText = (x: Scalar) => (typeof x === 'string' || x === null ? (re ? re.test(String(x ?? '')) : String(x ?? '').toLowerCase() === rest.toLowerCase()) : false)
  if (op === '' || op === '=') {
    if (rest === '') return op === '=' ? (x) => x === null || x === '' : (x) => x === null || x === ''
    if (n !== null) return (x) => (typeof x === 'number' && x === n) || (typeof x === 'string' && parseNumberText(x) === n)
    if (b !== null) return (x) => x === b
    return eqText
  }
  if (op === '<>') {
    if (rest === '') return (x) => !(x === null || x === '')
    if (n !== null) return (x) => !(typeof x === 'number' && x === n)
    if (b !== null) return (x) => x !== b
    return (x) => !eqText(x)
  }
  const test = (cmp: number) => (op === '<' ? cmp < 0 : op === '>' ? cmp > 0 : op === '<=' ? cmp <= 0 : cmp >= 0)
  if (n !== null) return (x) => typeof x === 'number' && test(x < n ? -1 : x > n ? 1 : 0)
  if (isText) return (x) => typeof x === 'string' && test(compareValues(x, rest))
  return (x) => typeof x === 'boolean' && b !== null && test(compareValues(x, b))
}

export function wildcardRegex(p: string): RegExp {
  let s = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '~' && i + 1 < p.length) { s += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue }
    if (ch === '*') s += '[\\s\\S]*'
    else if (ch === '?') s += '[\\s\\S]'
    else s += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + s + '$', 'i')
}
