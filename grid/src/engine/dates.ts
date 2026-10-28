/** Date serial numbers in the 1900 system, including its famous "1900 was a leap year" quirk (serial 60 is the day that never existed). */
const MS_DAY = 86_400_000
const EPOCH = Date.UTC(1899, 11, 30)

export function ymdToSerial(y: number, m: number, d: number): number {
  // Date.UTC normalises month and day overflow (month 13, day 0, ...).
  const t = new Date(Date.UTC(2000, 0, 1))
  t.setUTCFullYear(y, m - 1, d)
  const days = Math.round((t.getTime() - EPOCH) / MS_DAY)
  return days < 61 ? days - 1 : days
}

export function serialToYmd(serial: number): { y: number; m: number; d: number } {
  const s = Math.floor(serial)
  if (s === 60) return { y: 1900, m: 2, d: 29 }
  const days = s < 60 ? s + 1 : s
  const t = new Date(EPOCH + days * MS_DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** Day of the week for a serial: 0 = Sunday. */
export function serialWeekday(serial: number): number {
  const s = Math.floor(serial)
  return (((s - 1) % 7) + 7) % 7 // serial 1 (1900-01-01) counts as a Sunday, as the file format does
}

export function serialToTime(serial: number): { h: number; mi: number; s: number; ms: number } {
  let f = serial - Math.floor(serial)
  let total = Math.round(f * MS_DAY)
  if (total >= MS_DAY) total = MS_DAY - 1
  f = total
  const h = Math.floor(f / 3_600_000)
  const mi = Math.floor((f % 3_600_000) / 60_000)
  const s = Math.floor((f % 60_000) / 1000)
  return { h, mi, s, ms: f % 1000 }
}

export const timeToSerial = (h: number, mi: number, s: number) => (h * 3600 + mi * 60 + s) / 86400

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInMonth = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

export function nowSerial(d = new Date()): number {
  return ymdToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) / 86400
}

/** Reads text such as "2026-03-14", "3/14/2026", "14 Mar 2026", "March 14, 2026", "13:45", "1:30 PM", "2026-03-14 13:45". Returns a serial or null. */
export function parseDateTime(text: string): { serial: number; hasDate: boolean; hasTime: boolean } | null {
  const s = text.trim()
  if (!s) return null
  let rest = s
  let date: number | null = null
  let time: number | null = null
  const tm = /(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*([AaPp][Mm]?)?$/.exec(rest)
  if (tm) {
    let h = parseInt(tm[1], 10)
    const mi = parseInt(tm[2], 10), sec = tm[3] ? parseInt(tm[3], 10) : 0
    const ap = tm[5]?.[0].toLowerCase()
    if (ap) { if (h < 1 || h > 12) return null; if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0 }
    if (h > 31 || mi > 59 || sec > 59) return null
    time = timeToSerial(h, mi, sec) + (tm[4] ? parseFloat('0.' + tm[4]) / 86400 : 0)
    rest = rest.slice(0, tm.index).trim()
  } else {
    const ap = /^(\d{1,2})\s*([AaPp])[Mm]$/.exec(rest)
    if (ap) {
      let h = parseInt(ap[1], 10)
      if (h < 1 || h > 12) return null
      if (ap[2].toLowerCase() === 'p' && h < 12) h += 12
      if (ap[2].toLowerCase() === 'a' && h === 12) h = 0
      return { serial: h / 24, hasDate: false, hasTime: true }
    }
  }
  if (rest) {
    let m: RegExpExecArray | null
    const mon = (n: string) => { const i = MONTHS.findIndex((x) => x.toLowerCase().startsWith(n.toLowerCase().slice(0, 3))); return i < 0 ? 0 : i + 1 }
    const fixYear = (y: number, len: number) => (len <= 2 ? (y < 30 ? 2000 + y : 1900 + y) : y)
    const valid = (y: number, mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) && y >= 1900 && y <= 9999
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(rest))) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; if (valid(y, mo, d)) date = ymdToSerial(y, mo, d) }
    else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(rest))) { const mo = +m[1], d = +m[2], y = fixYear(+m[3], m[3].length); if (valid(y, mo, d)) date = ymdToSerial(y, mo, d) }
    else if ((m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ ,-]+(\d{2}|\d{4})$/.exec(rest))) { const mo = mon(m[2]), d = +m[1], y = fixYear(+m[3], m[3].length); if (mo && valid(y, mo, d)) date = ymdToSerial(y, mo, d) }
    else if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{2}|\d{4})$/.exec(rest))) { const mo = mon(m[1]), d = +m[2], y = fixYear(+m[3], m[3].length); if (mo && valid(y, mo, d)) date = ymdToSerial(y, mo, d) }
    else if ((m = /^([A-Za-z]{3,9}) (\d{4})$/.exec(rest))) { const mo = mon(m[1]); if (mo) date = ymdToSerial(+m[2], mo, 1) }
    if (date === null) return null
  }
  if (date === null && time === null) return null
  return { serial: (date ?? 0) + (time ?? 0), hasDate: date !== null, hasTime: time !== null }
}
