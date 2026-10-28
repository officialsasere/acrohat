import { toNumber } from '../coerce'
import { DAYS, MONTHS, daysInMonth, isLeap, nowSerial, parseDateTime, serialToTime, serialToYmd, serialWeekday, timeToSerial, ymdToSerial } from '../dates'
import { Arr, E, type Scalar, type Value } from '../types'
import { def, flat, int, num, scalar, str, type Ctx } from '../eval'

const opt = (v: Value | undefined | null) => v === undefined || v === null
const dnum = (v: Value, c: Ctx) => {
  const x = scalar(v, c)
  if (typeof x === 'string') { const d = parseDateTime(x); if (d) return d.serial }
  const n = toNumber(x)
  if (n < 0) throw E.NUM
  return n
}

def('TODAY', 0, 0, () => Math.floor(nowSerial()), { volatile: true })
def('NOW', 0, 0, () => nowSerial(), { volatile: true })
def('DATE', 3, 3, ([y, m, d], c) => {
  let yy = int(y, c)
  const mm = int(m, c), dd = int(d, c)
  if (yy < 0 || yy > 9999) throw E.NUM
  if (yy < 1900) yy += 1900
  const s = ymdToSerial(yy, mm, dd)
  if (s < 0) throw E.NUM
  return s
}, { scalar: true })
def('TIME', 3, 3, ([h, m, s], c) => { const t = (int(h, c) * 3600 + int(m, c) * 60 + int(s, c)) / 86400; if (t < 0) throw E.NUM; return t - Math.floor(t) }, { scalar: true })
def('YEAR', 1, 1, ([a], c) => serialToYmd(dnum(a, c)).y, { scalar: true })
def('MONTH', 1, 1, ([a], c) => serialToYmd(dnum(a, c)).m, { scalar: true })
def('DAY', 1, 1, ([a], c) => serialToYmd(dnum(a, c)).d, { scalar: true })
def('HOUR', 1, 1, ([a], c) => serialToTime(dnum(a, c)).h, { scalar: true })
def('MINUTE', 1, 1, ([a], c) => serialToTime(dnum(a, c)).mi, { scalar: true })
def('SECOND', 1, 1, ([a], c) => serialToTime(dnum(a, c)).s, { scalar: true })
def('DATEVALUE', 1, 1, ([a], c) => { const d = parseDateTime(str(a, c)); if (!d || !d.hasDate) throw E.VALUE; return Math.floor(d.serial) }, { scalar: true })
def('TIMEVALUE', 1, 1, ([a], c) => { const d = parseDateTime(str(a, c)); if (!d || !d.hasTime) throw E.VALUE; return d.serial - Math.floor(d.serial) }, { scalar: true })
def('WEEKDAY', 1, 2, ([a, t], c) => {
  const wd = serialWeekday(dnum(a, c)), type = opt(t) ? 1 : int(t!, c)
  if (type === 1) return wd + 1
  if (type === 2) return ((wd + 6) % 7) + 1
  if (type === 3) return (wd + 6) % 7
  if (type >= 11 && type <= 17) return ((wd - ((type - 10) % 7) + 7) % 7) + 1
  throw E.NUM
}, { scalar: true })
function isoWeek(serial: number): { week: number; year: number } {
  const { y, m, d } = serialToYmd(serial)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() || 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1)
  return { week: Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7), year: dt.getUTCFullYear() }
}
def('ISOWEEKNUM', 1, 1, ([a], c) => isoWeek(dnum(a, c)).week, { scalar: true })
def('WEEKNUM', 1, 2, ([a, t], c) => {
  const s = dnum(a, c), type = opt(t) ? 1 : int(t!, c)
  if (type === 21) return isoWeek(s).week
  const first = ymdToSerial(serialToYmd(s).y, 1, 1)
  const startDay = type === 2 || type === 11 ? 1 : type === 12 ? 2 : type === 13 ? 3 : type === 14 ? 4 : type === 15 ? 5 : type === 16 ? 6 : type === 17 ? 0 : 0
  const offset = (serialWeekday(first) - startDay + 7) % 7
  return Math.floor((s - first + offset) / 7) + 1
}, { scalar: true })
def('DAYS', 2, 2, ([e, s], c) => Math.floor(dnum(e, c)) - Math.floor(dnum(s, c)), { scalar: true })
def('DAYS360', 2, 3, ([s, e, m], c) => {
  const a = serialToYmd(dnum(s, c)), b = serialToYmd(dnum(e, c)), us = opt(m) || !num(m!, c)
  let d1 = a.d, d2 = b.d
  if (us) { if (d1 === 31 || (a.m === 2 && d1 === daysInMonth(a.y, 2))) d1 = 30; if (d2 === 31 && d1 >= 30) d2 = 30 }
  else { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30 }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1)
}, { scalar: true })
function addMonths(serial: number, n: number): number {
  const { y, m, d } = serialToYmd(serial)
  const t = y * 12 + (m - 1) + n
  const ny = Math.floor(t / 12), nm = (t % 12) + 1
  return ymdToSerial(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
def('EDATE', 2, 2, ([a, n], c) => addMonths(Math.floor(dnum(a, c)), int(n, c)), { scalar: true })
def('EOMONTH', 2, 2, ([a, n], c) => { const s = addMonths(Math.floor(dnum(a, c)), int(n, c)); const { y, m } = serialToYmd(s); return ymdToSerial(y, m, daysInMonth(y, m)) }, { scalar: true })
def('DATEDIF', 3, 3, ([a, b, u], c) => {
  const s = Math.floor(dnum(a, c)), e = Math.floor(dnum(b, c)), unit = str(u, c).toUpperCase()
  if (s > e) throw E.NUM
  const A = serialToYmd(s), B = serialToYmd(e)
  let months = (B.y - A.y) * 12 + (B.m - A.m) - (B.d < A.d ? 1 : 0)
  switch (unit) {
    case 'Y': return Math.floor(months / 12)
    case 'M': return months
    case 'D': return e - s
    case 'MD': { const base = months < 0 ? 0 : addMonths(s, months); return e - base }
    case 'YM': return ((months % 12) + 12) % 12
    case 'YD': { let yy = B.y; let anchor = ymdToSerial(yy, A.m, Math.min(A.d, daysInMonth(yy, A.m))); if (anchor > e) { yy--; anchor = ymdToSerial(yy, A.m, Math.min(A.d, daysInMonth(yy, A.m))) } months = 0; return e - anchor }
    default: throw E.NUM
  }
}, { scalar: true })
const WEEKEND_MASKS: Record<number, number[]> = { 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6], 11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6] }
function weekendSet(w: Value | undefined | null, c: Ctx): Set<number> {
  if (opt(w)) return new Set([6, 0])
  const v = scalar(w!, c)
  if (typeof v === 'string' && /^[01]{7}$/.test(v)) return new Set([...v].map((ch, i) => (ch === '1' ? (i + 1) % 7 : -1)).filter((d) => d >= 0))
  const m = WEEKEND_MASKS[toNumber(v)]
  if (!m) throw E.NUM
  return new Set(m)
}
function holidays(h: Value | undefined | null, c: Ctx): Set<number> {
  const out = new Set<number>()
  if (!opt(h)) for (const x of flat(h!, c)) if (x !== null) out.add(Math.floor(toNumber(x)))
  return out
}
function networkdays(a: Value, b: Value, w: Value | undefined | null, h: Value | undefined | null, c: Ctx) {
  const s = Math.floor(dnum(a, c)), e = Math.floor(dnum(b, c)), wk = weekendSet(w, c), hol = holidays(h, c)
  const [lo, hi] = s <= e ? [s, e] : [e, s]
  let n = 0
  for (let d = lo; d <= hi; d++) if (!wk.has(serialWeekday(d)) && !hol.has(d)) n++
  return s <= e ? n : -n
}
def('NETWORKDAYS', 2, 3, ([a, b, h], c) => networkdays(a, b, null, h, c))
def('NETWORKDAYS.INTL', 2, 4, ([a, b, w, h], c) => networkdays(a, b, w, h, c))
function workday(a: Value, n: Value, w: Value | undefined | null, h: Value | undefined | null, c: Ctx) {
  let d = Math.floor(dnum(a, c)), left = int(n, c)
  const wk = weekendSet(w, c), hol = holidays(h, c), step = left < 0 ? -1 : 1
  while (left !== 0) { d += step; if (!wk.has(serialWeekday(d)) && !hol.has(d)) left -= step }
  return d
}
def('WORKDAY', 2, 3, ([a, n, h], c) => workday(a, n, null, h, c))
def('WORKDAY.INTL', 2, 4, ([a, n, w, h], c) => workday(a, n, w, h, c))
def('YEARFRAC', 2, 3, ([a, b, bs], c) => {
  let s = dnum(a, c), e = dnum(b, c)
  const basis = opt(bs) ? 0 : int(bs!, c)
  if (s > e) [s, e] = [e, s]
  const A = serialToYmd(s), B = serialToYmd(e)
  switch (basis) {
    case 0: { let d1 = A.d, d2 = B.d; if (d1 === 31 || (A.m === 2 && d1 === daysInMonth(A.y, 2))) d1 = 30; if (d2 === 31 && d1 >= 30) d2 = 30; return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + d2 - d1) / 360 }
    case 1: { const years = B.y - A.y + 1; let days = 0; for (let y = A.y; y <= B.y; y++) days += isLeap(y) ? 366 : 365; return (e - s) / (days / years) }
    case 2: return (e - s) / 360
    case 3: return (e - s) / 365
    case 4: { const d1 = Math.min(A.d, 30), d2 = Math.min(B.d, 30); return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + d2 - d1) / 360 }
    default: throw E.NUM
  }
}, { scalar: true })
def('EPOCHTODATE', 1, 2, ([a], c) => 25569 + num(a, c) / 86400, { scalar: true })
def('MONTHNAME', 1, 1, ([a], c) => MONTHS[int(a, c) - 1] ?? E.VALUE, { scalar: true })
def('DAYNAME', 1, 1, ([a], c) => DAYS[int(a, c) % 7] ?? E.VALUE, { scalar: true })
export { Arr, timeToSerial }
export type { Scalar }
