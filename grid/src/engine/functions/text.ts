import { compareValues, numToText, parseNumberText, toNumber, toText } from '../coerce'
import { parseDateTime } from '../dates'
import { wildcardRegex } from '../criteria'
import { formatValue } from '../numfmt'
import { Arr, E, isErr, type Scalar, type Value } from '../types'
import { def, flat, int, isArrayArg, num, scalar, str, toArr, type Ctx } from '../eval'

const s = (v: Value, c: Ctx) => str(v, c)
const opt = (v: Value | undefined | null) => v === undefined || v === null

def('LEN', 1, 1, ([a], c) => [...s(a, c)].length, { scalar: true })
def('LENB', 1, 1, ([a], c) => new TextEncoder().encode(s(a, c)).length, { scalar: true })
def('LEFT', 1, 2, ([a, n], c) => { const k = opt(n) ? 1 : int(n!, c); if (k < 0) throw E.VALUE; return [...s(a, c)].slice(0, k).join('') }, { scalar: true })
def('RIGHT', 1, 2, ([a, n], c) => { const k = opt(n) ? 1 : int(n!, c); if (k < 0) throw E.VALUE; const t = [...s(a, c)]; return k === 0 ? '' : t.slice(-k).join('') }, { scalar: true })
def('MID', 3, 3, ([a, st, n], c) => { const i = int(st, c), k = int(n, c); if (i < 1 || k < 0) throw E.VALUE; return [...s(a, c)].slice(i - 1, i - 1 + k).join('') }, { scalar: true })
def('UPPER', 1, 1, ([a], c) => s(a, c).toUpperCase(), { scalar: true })
def('LOWER', 1, 1, ([a], c) => s(a, c).toLowerCase(), { scalar: true })
def('PROPER', 1, 1, ([a], c) => s(a, c).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, l) => p + l.toUpperCase()), { scalar: true })
def('TRIM', 1, 1, ([a], c) => s(a, c).replace(/ +/g, ' ').replace(/^ | $/g, ''), { scalar: true })
def('CLEAN', 1, 1, ([a], c) => s(a, c).replace(/[\x00-\x1f]/g, ''), { scalar: true })
def('REPT', 2, 2, ([a, n], c) => { const k = int(n, c); if (k < 0) throw E.VALUE; const t = s(a, c); if (t.length * k > 32767) throw E.VALUE; return t.repeat(k) }, { scalar: true })
def('EXACT', 2, 2, ([a, b], c) => s(a, c) === s(b, c), { scalar: true })
def('CHAR', 1, 1, ([a], c) => { const n = int(a, c); if (n < 1 || n > 255) throw E.VALUE; return String.fromCharCode(n) }, { scalar: true })
def('CODE', 1, 1, ([a], c) => { const t = s(a, c); if (!t) throw E.VALUE; return t.charCodeAt(0) }, { scalar: true })
def('UNICHAR', 1, 1, ([a], c) => { const n = int(a, c); if (n < 1 || n > 0x10ffff) throw E.VALUE; return String.fromCodePoint(n) }, { scalar: true })
def('UNICODE', 1, 1, ([a], c) => { const t = s(a, c); if (!t) throw E.VALUE; return t.codePointAt(0)! }, { scalar: true })
def('T', 1, 1, ([a], c) => { const v = scalar(a, c); return typeof v === 'string' ? v : isErr(v) ? v : '' }, { scalar: true })

function joinParts(args: Value[], c: Ctx, skipEmpty: boolean) {
  const out: string[] = []
  for (const a of args) for (const x of flat(a, c)) { if (isErr(x)) throw x; if (skipEmpty && (x === null || x === '')) continue; out.push(toText(x)) }
  return out
}
def('CONCAT', 1, 255, (a, c) => joinParts(a, c, false).join(''))
def('CONCATENATE', 1, 255, (a, c) => joinParts(a, c, false).join(''))
def('TEXTJOIN', 3, 255, ([d, ig, ...rest], c) => {
  const delim = flat(d, c).map(toText)
  const parts = joinParts(rest as Value[], c, num(ig, c) !== 0 && scalar(ig, c) !== false)
  return parts.reduce((acc, p, i) => acc + (i ? delim[(i - 1) % delim.length] ?? '' : '') + p, '')
})
def('JOIN', 2, 255, ([d, ...rest], c) => joinParts(rest as Value[], c, false).join(s(d, c)))

def('FIND', 2, 3, ([f, t, st], c) => {
  const needle = s(f, c), hay = s(t, c), from = opt(st) ? 1 : int(st!, c)
  if (from < 1 || from > hay.length + 1) throw E.VALUE
  const i = hay.indexOf(needle, from - 1)
  if (i < 0) throw E.VALUE
  return i + 1
}, { scalar: true })
def('SEARCH', 2, 3, ([f, t, st], c) => {
  const needle = s(f, c), hay = s(t, c), from = opt(st) ? 1 : int(st!, c)
  if (from < 1 || from > hay.length + 1) throw E.VALUE
  const re = new RegExp(wildcardRegex(needle).source.slice(1, -1), 'i')
  const m = re.exec(hay.slice(from - 1))
  if (!m) throw E.VALUE
  return m.index + from
}, { scalar: true })
def('SUBSTITUTE', 3, 4, ([t, o, n, k], c) => {
  const text = s(t, c), from = s(o, c), to = s(n, c)
  if (!from) return text
  if (opt(k)) return text.split(from).join(to)
  const nth = int(k!, c)
  if (nth < 1) throw E.VALUE
  let idx = -1
  for (let i = 0; i < nth; i++) { idx = text.indexOf(from, idx + 1); if (idx < 0) return text }
  return text.slice(0, idx) + to + text.slice(idx + from.length)
}, { scalar: true })
def('REPLACE', 4, 4, ([t, st, n, r], c) => {
  const text = [...s(t, c)], i = int(st, c), k = int(n, c)
  if (i < 1 || k < 0) throw E.VALUE
  return text.slice(0, i - 1).join('') + s(r, c) + text.slice(i - 1 + k).join('')
}, { scalar: true })

def('TEXT', 2, 2, ([v, f], c) => { const x = scalar(v, c); return formatValue(x, s(f, c)).text }, { scalar: true })
def('VALUE', 1, 1, ([a], c) => {
  const v = scalar(a, c)
  if (typeof v === 'number') return v
  if (typeof v === 'boolean' || v === null) return toNumber(v)
  if (typeof v !== 'string') throw v
  const n = parseNumberText(v)
  if (n !== null) return n
  const d = parseDateTime(v)
  if (d) return d.serial
  throw E.VALUE
}, { scalar: true })
def('NUMBERVALUE', 1, 3, ([a, dec, grp], c) => {
  let t = s(a, c).replace(/\s/g, '')
  const d = opt(dec) ? '.' : s(dec!, c)[0], g = opt(grp) ? ',' : s(grp!, c)[0]
  if (!t) return 0
  t = t.split(g).join('').replace(d, '.')
  const pct = (t.match(/%+$/) ?? [''])[0].length
  const n = Number(t.replace(/%+$/, ''))
  if (isNaN(n)) throw E.VALUE
  return n / 100 ** pct
}, { scalar: true })
def('FIXED', 1, 3, ([a, d, nc], c) => {
  const x = num(a, c), dec = opt(d) ? 2 : int(d!, c)
  const t = formatValue(x, (opt(nc) || num(nc!, c) === 0 ? '#,##0' : '0') + (dec > 0 ? '.' + '0'.repeat(dec) : '')).text
  return t
}, { scalar: true })
def('DOLLAR', 1, 2, ([a, d], c) => { const dec = opt(d) ? 2 : int(d!, c); return formatValue(num(a, c), `$#,##0${dec > 0 ? '.' + '0'.repeat(dec) : ''};($#,##0${dec > 0 ? '.' + '0'.repeat(dec) : ''})`).text }, { scalar: true })

// ---- splitting (the newer array-returning forms and the older Sheets form)
function splitBy(text: string, delims: string[], ignoreEmpty: boolean, caseSens = true) {
  if (!delims.length || delims.every((d) => d === '')) return [text]
  const re = new RegExp(delims.filter(Boolean).map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), caseSens ? 'g' : 'gi')
  const parts = text.split(re)
  return ignoreEmpty ? parts.filter((p) => p !== '') : parts
}
def('SPLIT', 2, 4, ([a, d, each, rm], c) => {
  const text = s(a, c), delim = s(d, c)
  const byEach = opt(each) || scalar(each!, c) !== false
  const parts = byEach ? splitBy(text, [...delim], !(!opt(rm) && scalar(rm!, c) === false)) : splitBy(text, [delim], !(!opt(rm) && scalar(rm!, c) === false))
  return new Arr([parts])
})
def('TEXTSPLIT', 2, 6, ([a, cd, rd, ign, mm, pad], c) => {
  const text = s(a, c), colD = flat(cd, c).map(toText), rowD = opt(rd) ? [] : flat(rd!, c).map(toText)
  const ignoreEmpty = !opt(ign) && scalar(ign!, c) === true
  const ci = !opt(mm) && int(mm!, c) === 1
  const rows = (rowD.length ? splitBy(text, rowD, ignoreEmpty, !ci) : [text]).map((r) => splitBy(r, colD, ignoreEmpty, !ci))
  const w = Math.max(...rows.map((r) => r.length))
  const fill: Scalar = opt(pad) ? E.NA : scalar(pad!, c)
  return new Arr(rows.map((r) => [...r, ...Array(w - r.length).fill(fill)]))
})
for (const [name, before] of [['TEXTBEFORE', true], ['TEXTAFTER', false]] as const) def(name, 2, 6, ([a, d, ins, ins2, mm, ifnf], c) => {
  const text = s(a, c), delim = s(d, c), nth = opt(ins) ? 1 : int(ins!, c)
  const ci = !opt(mm) && int(mm!, c) === 1
  const hay = ci ? text.toLowerCase() : text, nd = ci ? delim.toLowerCase() : delim
  void ins2
  if (nth === 0 || !nd) throw E.VALUE
  let idx = -1
  if (nth > 0) { for (let i = 0; i < nth; i++) { idx = hay.indexOf(nd, idx + 1); if (idx < 0) break } }
  else { idx = hay.length; for (let i = 0; i < -nth; i++) { idx = hay.lastIndexOf(nd, idx - 1); if (idx < 0) break } }
  if (idx < 0) { if (!opt(ifnf)) return scalar(ifnf!, c); throw E.NA }
  return before ? text.slice(0, idx) : text.slice(idx + delim.length)
}, { scalar: true })

// ---- regular expressions (the Sheets functions)
const rx = (p: string, flags = '') => { try { return new RegExp(p, flags) } catch { throw E.VALUE } }
def('REGEXMATCH', 2, 2, ([a, p], c) => rx(s(p, c)).test(s(a, c)), { scalar: true })
def('REGEXEXTRACT', 2, 2, ([a, p], c) => {
  const m = rx(s(p, c)).exec(s(a, c))
  if (!m) throw E.NA
  return m.length > 1 ? (m[1] ?? '') : m[0]
}, { scalar: true })
def('REGEXREPLACE', 3, 3, ([a, p, r], c) => s(a, c).replace(rx(s(p, c), 'g'), s(r, c).replace(/\\(\d)/g, '$$$1')), { scalar: true })

// ---- type conversions (Sheets)
def('TO_TEXT', 1, 1, ([a], c) => toText(scalar(a, c)), { scalar: true })
def('TO_PURE_NUMBER', 1, 1, ([a], c) => toNumber(scalar(a, c)), { scalar: true })
def('TO_DATE', 1, 1, ([a], c) => Math.floor(num(a, c)), { scalar: true })
def('TO_PERCENT', 1, 1, ([a], c) => num(a, c), { scalar: true })
def('TO_DOLLARS', 1, 1, ([a], c) => num(a, c), { scalar: true })
def('ARRAYTOTEXT', 1, 2, ([a, f], c) => { const m = toArr(a, c); return opt(f) || int(f!, c) === 0 ? m.a.flat().map(toText).join(', ') : '{' + m.a.map((r) => r.map((x) => (typeof x === 'string' ? `"${x}"` : toText(x))).join(',')).join(';') + '}' })
def('VALUETOTEXT', 1, 2, ([a, f], c) => { const x = scalar(a, c); return !opt(f) && int(f!, c) === 1 && typeof x === 'string' ? `"${x}"` : toText(x) }, { scalar: true })
def('ASC', 1, 1, ([a], c) => s(a, c), { scalar: true })
def('NUMBERTEXT', 1, 1, ([a], c) => numToText(num(a, c)), { scalar: true })
export { compareValues, isArrayArg }
