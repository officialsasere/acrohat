import { DAYS, MONTHS, serialToTime, serialToYmd, serialWeekday } from './dates'
import type { Scalar } from './types'
import { isErr } from './types'

/**
 * Number formats as used in spreadsheets: 0.00, #,##0, 0%, $#,##0.00, 0.00E+00, # ?/?, yyyy-mm-dd, h:mm AM/PM,
 * [h]:mm:ss, [Red], [>100], "text", and up to four sections (positive;negative;zero;text).
 */
export interface Formatted { text: string; color?: string; /** true for text, so it can default to left alignment */ isText: boolean }

type Tok =
  | { k: 'lit'; s: string }
  | { k: 'digit'; ch: '0' | '#' | '?' }
  | { k: 'dot' } | { k: 'comma' } | { k: 'pct' } | { k: 'exp'; sign: boolean }
  | { k: 'frac' } | { k: 'text' } | { k: 'general' }
  | { k: 'date'; s: string } | { k: 'elapsed'; unit: 'h' | 'm' | 's'; n: number } | { k: 'ampm'; s: string }

interface Section { toks: Tok[]; cond?: { op: string; n: number }; color?: string; kind: 'num' | 'date' | 'text' | 'general' }

const COLORS: Record<string, string> = { black: '#000000', blue: '#0000ff', cyan: '#00b7c3', green: '#00a000', magenta: '#d000d0', red: '#e00000', white: '#ffffff', yellow: '#c8a000' }
const cache = new Map<string, Section[]>()

function splitSections(fmt: string): string[] {
  const out: string[] = []
  let cur = '', q = false, br = false
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]
    if (ch === '\\' && !q) { cur += ch + (fmt[++i] ?? ''); continue }
    if (ch === '"') q = !q
    else if (!q && ch === '[') br = true
    else if (!q && ch === ']') br = false
    if (ch === ';' && !q && !br) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

function parseSection(src: string): Section {
  const toks: Tok[] = []
  const sec: Section = { toks, kind: 'num' }
  let i = 0
  let hasDate = false
  const lit = (s: string) => { const l = toks[toks.length - 1]; if (l?.k === 'lit') l.s += s; else toks.push({ k: 'lit', s }) }
  while (i < src.length) {
    const ch = src[i]
    const rest = src.slice(i)
    if (ch === '"') { const j = src.indexOf('"', i + 1); lit(src.slice(i + 1, j < 0 ? undefined : j)); i = j < 0 ? src.length : j + 1; continue }
    if (ch === '\\') { lit(src[i + 1] ?? ''); i += 2; continue }
    if (ch === '_') { lit(' '); i += 2; continue }
    if (ch === '*') { i += 2; continue }
    if (ch === '[') {
      const j = src.indexOf(']', i)
      const inner = src.slice(i + 1, j)
      i = j + 1
      const low = inner.toLowerCase()
      const el = /^(h+|m+|s+)$/.exec(low)
      if (el) { toks.push({ k: 'elapsed', unit: low[0] as 'h' | 'm' | 's', n: low.length }); hasDate = true; continue }
      if (COLORS[low]) { sec.color = COLORS[low]; continue }
      const cm = /^color\s*(\d+)$/.exec(low)
      if (cm) { sec.color = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'][+cm[1] - 1] ?? '#000000'; continue }
      const cond = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(inner)
      if (cond) { sec.cond = { op: cond[1], n: parseFloat(cond[2]) }; continue }
      if (inner.startsWith('$')) { const cur = inner.slice(1).split('-')[0]; if (cur) lit(cur); continue }
      continue
    }
    if (/^general/i.test(rest)) { toks.push({ k: 'general' }); i += 7; continue }
    if (/^(AM\/PM|A\/P)/i.test(rest)) { const m = /^(AM\/PM|A\/P)/i.exec(rest)![0]; toks.push({ k: 'ampm', s: m }); hasDate = true; i += m.length; continue }
    if (/^E[+-]/i.test(rest)) { toks.push({ k: 'exp', sign: rest[1] === '+' }); i += 2; continue }
    if (ch === '0' || ch === '#' || ch === '?') { toks.push({ k: 'digit', ch }); i++; continue }
    if (ch === '.') { toks.push({ k: 'dot' }); i++; continue }
    if (ch === ',') { toks.push({ k: 'comma' }); i++; continue }
    if (ch === '%') { toks.push({ k: 'pct' }); i++; continue }
    if (ch === '@') { toks.push({ k: 'text' }); i++; continue }
    if (ch === '/') { toks.push({ k: 'frac' }); i++; continue }
    const dm = /^(y{1,4}|m{1,5}|d{1,4}|h{1,2}|s{1,2})/i.exec(rest)
    if (dm) { toks.push({ k: 'date', s: dm[0].toLowerCase() }); hasDate = true; i += dm[0].length; continue }
    lit(ch)
    i++
  }
  // A "/" between digit placeholders is a fraction; otherwise (dates, plain text) it is a literal.
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].k === 'frac') {
      const before = toks.slice(0, k).some((t) => t.k === 'digit'), after = toks.slice(k + 1).some((t) => t.k === 'digit')
      if (!(before && after) || hasDate) toks[k] = { k: 'lit', s: '/' }
    }
  }
  if (hasDate) for (let k = 0; k < toks.length; k++) if (toks[k].k === 'comma') toks[k] = { k: 'lit', s: ',' }
  sec.kind = toks.some((t) => t.k === 'general') ? 'general' : hasDate ? 'date' : toks.some((t) => t.k === 'text') && !toks.some((t) => t.k === 'digit') ? 'text' : 'num'
  return sec
}

function sections(fmt: string): Section[] {
  let s = cache.get(fmt)
  if (!s) { s = splitSections(fmt).map(parseSection); cache.set(fmt, s); if (cache.size > 500) cache.delete(cache.keys().next().value!) }
  return s
}

export const isDateFormat = (fmt: string) => fmt !== 'General' && sections(fmt).some((s) => s.kind === 'date')

function cmp(op: string, a: number, b: number) {
  return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : op === '=' ? a === b : a !== b
}

/** Round half away from zero on the decimal representation, so 1.005 -> 1.01 as people expect. */
export function roundHalfUp(x: number, d: number): number {
  if (!isFinite(x)) return x
  const neg = x < 0
  const ax = Math.abs(x)
  const r = d >= 0 ? Number(Math.round(Number(ax + 'e' + d)) + 'e-' + d) : Math.round(ax / 10 ** -d) * 10 ** -d
  return neg ? -r : r
}

export function formatGeneral(n: number, maxLen = 11): string {
  if (n === 0) return '0'
  if (!isFinite(n)) return String(n)
  const a = Math.abs(n)
  if (Number.isInteger(n) && a < 1e11) return String(n)
  let s: string
  if (a >= 1e11 || a < 1e-6) {
    s = n.toExponential(Math.max(0, maxLen - 6)).replace(/\.?0+e/, 'E').replace('e', 'E')
    s = s.replace(/E([+-])(\d)$/, 'E$10$2')
    return s
  }
  s = String(Number(n.toPrecision(15)))
  if (s.length > maxLen) {
    const intLen = Math.floor(a).toString().length
    const dec = Math.max(0, maxLen - 1 - intLen - (n < 0 ? 1 : 0))
    s = String(roundHalfUp(n, dec))
    if (s.includes('e')) s = n.toExponential(5).replace(/\.?0+e/, 'E')
  }
  return s
}

function group(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function bestFraction(x: number, maxDen: number, fixedDen?: number): [number, number] {
  if (fixedDen) return [Math.round(x * fixedDen), fixedDen]
  let best: [number, number] = [Math.round(x), 1], err = Math.abs(x - best[0])
  for (let d = 2; d <= maxDen && err > 1e-12; d++) {
    const n = Math.round(x * d), e = Math.abs(x - n / d)
    if (e < err - 1e-12) { best = [n, d]; err = e }
  }
  return best
}

function formatNumberSection(x: number, sec: Section, neg: boolean, showSign: boolean): string {
  const toks = sec.toks
  const sign = neg && showSign ? '-' : ''
  const pcts = toks.filter((t) => t.k === 'pct').length
  let v = Math.abs(x) * 100 ** pcts
  const isPh = (t: Tok) => t.k === 'digit' || t.k === 'dot'
  const first = toks.findIndex(isPh)
  let last = -1
  toks.forEach((t, k) => { if (isPh(t)) last = k })
  // Literal text and percent signs outside the digits.
  const affix = (from: number, to: number) => toks.slice(from, to).map((t) => (t.k === 'lit' ? t.s : t.k === 'pct' ? '%' : '')).join('')
  const expAt = toks.findIndex((t) => t.k === 'exp')
  const fracAt = toks.findIndex((t) => t.k === 'frac')
  if (first < 0 && fracAt < 0) return sign + affix(0, toks.length)

  // Commas right after the last placeholder divide by 1000 each.
  let scale = 0
  for (let k = last + 1; k < toks.length && toks[k].k === 'comma'; k++) scale++
  v /= 1000 ** scale
  const dotAt = toks.findIndex((t) => t.k === 'dot')

  if (fracAt >= 0) {
    // "# ?/?" mixed numbers, "?/8" fixed denominators.
    const before = toks.slice(0, fracAt), after = toks.slice(fracAt + 1)
    const denDigits = after.filter((t) => t.k === 'digit').length
    const fixed = (() => { const n = after.filter((t) => t.k === 'lit').map((t) => (t as { s: string }).s).join('').match(/\d+/); return n ? +n[0] : 0 })()
    const hasWhole = before.filter((t) => t.k === 'digit').length > 1
    const whole = hasWhole ? Math.floor(v) : 0
    let [n, d] = bestFraction(v - whole, 10 ** Math.max(1, denDigits) - 1, fixed || undefined)
    let w = whole
    if (n === d) { w += 1; n = 0 }
    const fr = n === 0 ? '' : `${hasWhole ? n : n + whole * d}/${d}`
    const shown = hasWhole ? (w > 0 || !fr ? String(w) : '') : fr || '0'
    return sign + affix(0, first) + (hasWhole ? shown + (shown && fr ? ' ' : '') + fr : shown) + affix(last + 1, toks.length)
  }

  if (expAt >= 0) {
    const decimals = dotAt >= 0 && dotAt < expAt ? toks.slice(dotAt + 1, expAt).filter((t) => t.k === 'digit').length : 0
    const expDigits = toks.slice(expAt + 1).filter((t) => t.k === 'digit').length || 2
    let e = v === 0 ? 0 : Math.floor(Math.log10(v))
    let m = roundHalfUp(v / 10 ** e, decimals)
    if (m >= 10) { m /= 10; e++ }
    const t = toks[expAt] as { sign: boolean }
    return sign + affix(0, first) + m.toFixed(decimals) + 'E' + (e < 0 ? '-' : t.sign ? '+' : '') + String(Math.abs(e)).padStart(expDigits, '0')
  }

  const dec = dotAt >= 0 ? toks.slice(dotAt + 1).filter((t) => t.k === 'digit') as { k: 'digit'; ch: string }[] : []
  const intTokIdx = toks.map((t, k) => (t.k === 'digit' && (dotAt < 0 || k < dotAt) ? k : -1)).filter((k) => k >= 0)
  const rounded = roundHalfUp(v, dec.length)
  const [ip0, dp0 = ''] = rounded.toFixed(dec.length).split('.')
  let ip = ip0
  const zeros = intTokIdx.filter((k) => (toks[k] as { ch: string }).ch === '0').length
  const qs = intTokIdx.filter((k) => (toks[k] as { ch: string }).ch === '?').length
  if (ip === '0' && zeros === 0) ip = ''
  if (ip.length < zeros) ip = ip.padStart(zeros, '0')
  if (qs && ip.length < intTokIdx.length) ip = ip.padStart(intTokIdx.length, ' ')
  // Decimals: "0" always shows, "#" drops trailing zeros, "?" turns them into spaces.
  let keep = dec.length
  while (keep > 0 && dec[keep - 1].ch !== '0' && dp0[keep - 1] === '0') keep--
  const dp = dp0.slice(0, keep) + dec.slice(keep).map((d) => (d.ch === '?' ? ' ' : '')).join('')

  // Literal text between integer placeholders (phone numbers, ZIP+4...): hand the digits out from the right.
  const firstInt = intTokIdx[0], lastInt = intTokIdx[intTokIdx.length - 1]
  const interleaved = intTokIdx.length > 1 && toks.slice(firstInt, lastInt).some((t) => t.k === 'lit')
  let body: string
  if (interleaved) {
    const digits = ip.padStart(intTokIdx.length, '0').split('')
    const extra = digits.length > intTokIdx.length ? digits.splice(0, digits.length - intTokIdx.length).join('') : ''
    let di = 0, s = ''
    for (let k = first; k <= lastInt; k++) {
      const t = toks[k]
      if (t.k === 'digit') s += (di === 0 ? extra : '') + digits[di++]
      else if (t.k === 'lit') s += t.s
    }
    body = s
  } else {
    const thousands = toks.some((t, k) => t.k === 'comma' && k > first && k < last)
    const lead = ip.match(/^ */)![0]
    body = lead + (thousands ? group(ip.slice(lead.length)) : ip.slice(lead.length))
  }
  if (dotAt >= 0 && (dec.length > 0 || toks[dotAt] && dp !== undefined)) body += (dec.length ? '.' + dp : '.')
  return sign + affix(0, first) + body + affix(last + 1, toks.length)
}

function dateParts(serial: number) {
  const { y, m, d } = serialToYmd(serial)
  return { y, m, d, ...serialToTime(serial), wd: serialWeekday(serial) }
}

function formatDateSection(x: number, sec: Section): string {
  const toks = sec.toks
  const t = dateParts(x)
  const ampm = toks.find((k) => k.k === 'ampm') as { s: string } | undefined
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12
  let out = ''
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i]
    if (k.k === 'lit') { out += k.s; continue }
    if (k.k === 'ampm') { const pm = t.h >= 12; out += /^a\//i.test(k.s) ? (pm ? 'P' : 'A') : pm ? 'PM' : 'AM'; if (k.s === k.s.toLowerCase()) out = out.slice(0, -2) + (pm ? 'pm' : 'am'); continue }
    if (k.k === 'elapsed') {
      const totalSec = Math.round(x * 86400)
      const v = k.unit === 'h' ? Math.floor(totalSec / 3600) : k.unit === 'm' ? Math.floor(totalSec / 60) : totalSec
      out += String(v).padStart(k.n, '0'); continue
    }
    if (k.k === 'dot' || k.k === 'digit') {
      // fractional seconds: ss.000
      if (k.k === 'dot') {
        const n = toks.slice(i + 1).filter((u) => u.k === 'digit').length
        const prevIsSec = toks.slice(0, i).reverse().find((u) => u.k === 'date' || u.k === 'elapsed')
        if (n && prevIsSec && ((prevIsSec.k === 'date' && prevIsSec.s[0] === 's') || (prevIsSec.k === 'elapsed' && prevIsSec.unit === 's'))) { out += '.' + String(Math.floor(t.ms)).padStart(3, '0').slice(0, n); i += n; continue }
        out += '.'
      }
      continue
    }
    if (k.k !== 'date') continue
    const s = k.s
    switch (s[0]) {
      case 'y': out += s.length <= 2 ? String(t.y % 100).padStart(2, '0') : String(t.y).padStart(4, '0'); break
      case 'd': out += s.length === 1 ? t.d : s.length === 2 ? String(t.d).padStart(2, '0') : s.length === 3 ? DAYS[t.wd].slice(0, 3) : DAYS[t.wd]; break
      case 'h': out += s.length === 1 ? (ampm ? h12 : t.h) : String(ampm ? h12 : t.h).padStart(2, '0'); break
      case 's': out += s.length === 1 ? t.s : String(t.s).padStart(2, '0'); break
      case 'm': {
        // Minutes right after an hour or right before seconds; months otherwise.
        const prev = toks.slice(0, i).reverse().find((u) => u.k === 'date' || u.k === 'elapsed')
        const nxt = toks.slice(i + 1).find((u) => u.k === 'date' || u.k === 'elapsed')
        const minute = (prev && ((prev.k === 'date' && prev.s[0] === 'h') || (prev.k === 'elapsed' && prev.unit === 'h'))) || (nxt && ((nxt.k === 'date' && nxt.s[0] === 's') || (nxt.k === 'elapsed' && nxt.unit === 's')))
        if (minute) out += s.length === 1 ? t.mi : String(t.mi).padStart(2, '0')
        else out += s.length === 1 ? t.m : s.length === 2 ? String(t.m).padStart(2, '0') : s.length === 3 ? MONTHS[t.m - 1].slice(0, 3) : s.length === 4 ? MONTHS[t.m - 1] : MONTHS[t.m - 1][0]
        break
      }
    }
  }
  return out
}

export function formatValue(v: Scalar, fmt = 'General'): Formatted {
  if (isErr(v)) return { text: v.code, isText: true }
  if (v === null) return { text: '', isText: false }
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', isText: true }
  const secs = sections(fmt || 'General')
  if (typeof v === 'string') {
    const ts = secs.length >= 4 ? secs[3] : secs.find((s) => s.kind === 'text')
    if (ts && ts.toks.some((t) => t.k === 'text')) return { text: ts.toks.map((t) => (t.k === 'text' ? v : t.k === 'lit' ? t.s : '')).join(''), color: ts.color, isText: true }
    return { text: v, isText: true }
  }
  if (!isFinite(v)) return { text: isNaN(v) ? '#NUM!' : '#NUM!', isText: true }
  // Choose the section: by condition, else positive / negative / zero.
  let sec = secs[0], useSign = true
  const conds = secs.filter((s) => s.cond)
  if (conds.length) {
    const hit = secs.find((s) => s.cond && cmp(s.cond.op, v, s.cond.n))
    sec = hit ?? secs.find((s) => !s.cond) ?? secs[secs.length - 1]
    useSign = sec === secs[0] || !!(sec.cond && sec.cond.op.includes('<') && false)
    if (hit && secs.indexOf(hit) > 0) useSign = false
  } else if (secs.length >= 2) {
    if (v < 0) { sec = secs[1]; useSign = false }
    else if (v === 0 && secs.length >= 3) sec = secs[2]
  }
  const neg = v < 0
  if (sec.kind === 'general' || (fmt === 'General' && secs.length === 1)) {
    const g = formatGeneral(v)
    const extra = sec.toks.filter((t) => t.k === 'lit').map((t) => (t as { s: string }).s)
    return { text: sec.kind === 'general' && extra.length ? sec.toks.map((t) => (t.k === 'general' ? g : t.k === 'lit' ? t.s : '')).join('') : g, color: sec.color, isText: false }
  }
  if (sec.kind === 'date') {
    if (v < 0) return { text: '#'.repeat(10), isText: true }
    return { text: formatDateSection(v, sec), color: sec.color, isText: false }
  }
  if (sec.kind === 'text') return { text: String(v), isText: false }
  return { text: formatNumberSection(v, sec, neg, useSign), color: sec.color, isText: false }
}

/** The text shown while editing a cell: full precision, dates as dates. */
export function editText(v: Scalar, fmt = 'General'): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return v
  if (isErr(v)) return v.code
  if (isDateFormat(fmt)) {
    const t = serialToTime(v)
    const hasTime = v % 1 !== 0 && (t.h || t.mi || t.s)
    const f = /[dmy]/i.test(fmt.replace(/\[[^\]]*\]|"[^"]*"/g, '')) ? (hasTime ? 'm/d/yyyy h:mm:ss' : 'm/d/yyyy') : 'h:mm:ss'
    return formatValue(v, f).text
  }
  if (/%/.test(fmt) && !/"[^"]*%[^"]*"/.test(fmt)) return String(Number((v * 100).toPrecision(15))) + '%'
  return String(Number(v.toPrecision(15)))
}

export const BUILTIN_FORMATS: { label: string; fmt: string; sample?: number }[] = [
  { label: 'Automatic', fmt: 'General' },
  { label: 'Number', fmt: '#,##0.00', sample: 1234.5 },
  { label: 'Integer', fmt: '0', sample: 1235 },
  { label: 'Percent', fmt: '0.00%', sample: 0.1234 },
  { label: 'Scientific', fmt: '0.00E+00', sample: 12345 },
  { label: 'Accounting', fmt: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', sample: 1234.5 },
  { label: 'Financial', fmt: '#,##0.00;(#,##0.00)', sample: -1234.5 },
  { label: 'Currency', fmt: '$#,##0.00', sample: 1234.5 },
  { label: 'Currency (no cents)', fmt: '$#,##0', sample: 1234.5 },
  { label: 'Date', fmt: 'm/d/yyyy', sample: 46000 },
  { label: 'Date (long)', fmt: 'mmmm d, yyyy', sample: 46000 },
  { label: 'Date (ISO)', fmt: 'yyyy-mm-dd', sample: 46000 },
  { label: 'Time', fmt: 'h:mm:ss AM/PM', sample: 0.5625 },
  { label: 'Date time', fmt: 'm/d/yyyy h:mm', sample: 46000.5625 },
  { label: 'Duration', fmt: '[h]:mm:ss', sample: 1.5 },
  { label: 'Fraction', fmt: '# ?/?', sample: 3.5 },
  { label: 'Text', fmt: '@' },
]
