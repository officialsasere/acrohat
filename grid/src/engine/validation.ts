import type { Book } from './book'
import { parseInput } from './input'
import type { Sheet, Validation } from './model'
import { Arr, type Rect, type Scalar } from './types'
import { parseNumberText, toText } from './coerce'

const inRects = (rects: Rect[], r: number, c: number) => rects.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2)

export function validationAt(sheet: Sheet, r: number, c: number): Validation | undefined {
  for (let i = sheet.validations.length - 1; i >= 0; i--) if (inRects(sheet.validations[i].ranges, r, c)) return sheet.validations[i]
  return undefined
}

/** The choices of a drop-down list. */
export function listOptions(book: Book, sheet: Sheet, v: Validation): string[] {
  if (v.type === 'list') return v.list ?? []
  if (v.type === 'listRange' && v.v1) {
    const res = book.evalText(sheet.id, v.v1.startsWith('=') ? v.v1 : '=' + v.v1)
    const arr = res instanceof Arr ? res.a.flat() : [res]
    return arr.filter((x) => x !== null && x !== '').map(toText)
  }
  return []
}

const num = (book: Book, sheet: Sheet, t: string | undefined, r: number, c: number): number | null => {
  if (t === undefined || t === '') return null
  if (t.startsWith('=')) { const x = book.evalText(sheet.id, t, r, c); const s = x instanceof Arr ? x.a[0][0] : x; return typeof s === 'number' ? s : null }
  const n = parseNumberText(t)
  if (n !== null) return n
  const p = parseInput(t).value
  return typeof p === 'number' ? p : null
}

/** Is `text` (what someone typed) allowed in this cell? */
export function checkInput(book: Book, sheet: Sheet, r: number, c: number, text: string): { ok: boolean; message?: string; warn?: boolean } {
  const v = validationAt(sheet, r, c)
  if (!v) return { ok: true }
  if (text === '' ) return { ok: v.allowBlank !== false }
  const parsed = text.startsWith('=') ? null : parseInput(text).value as Scalar
  const bad = (): { ok: false; message: string; warn: boolean } => ({ ok: false, warn: v.onInvalid === 'warning', message: v.help || 'This value is not allowed in this cell.' })
  const between = (x: number, a: number | null, b: number | null) => (a === null ? true : v.op === 'between' ? x >= a && x <= (b ?? a) : v.op === 'notBetween' ? x < a || x > (b ?? a) : v.op === '=' ? x === a : v.op === '<>' ? x !== a : v.op === '>' ? x > a : v.op === '<' ? x < a : v.op === '>=' ? x >= a : v.op === '<=' ? x <= a : true)
  switch (v.type) {
    case 'list': case 'listRange': return listOptions(book, sheet, v).some((o) => o.toLowerCase() === text.toLowerCase()) ? { ok: true } : bad()
    case 'checkbox': return [v.checked ?? 'TRUE', v.unchecked ?? 'FALSE'].some((o) => o.toLowerCase() === text.toLowerCase()) ? { ok: true } : bad()
    case 'number': case 'integer': {
      if (typeof parsed !== 'number') return bad()
      if (v.type === 'integer' && !Number.isInteger(parsed)) return bad()
      return between(parsed, num(book, sheet, v.v1, r, c), num(book, sheet, v.v2, r, c)) ? { ok: true } : bad()
    }
    case 'date': {
      if (typeof parsed !== 'number') return bad()
      return between(parsed, num(book, sheet, v.v1, r, c), num(book, sheet, v.v2, r, c)) ? { ok: true } : bad()
    }
    case 'textLength': return between(text.length, num(book, sheet, v.v1, r, c), num(book, sheet, v.v2, r, c)) ? { ok: true } : bad()
    case 'text': {
      const q = (v.v1 ?? '').toLowerCase(), t = text.toLowerCase()
      const ok = v.op === '=' ? t === q : v.op === '<>' ? t !== q : v.op === '>' ? t.includes(q) : v.op === '<' ? !t.includes(q) : t.includes(q)
      return ok ? { ok: true } : bad()
    }
    case 'custom': {
      const typed = parseInput(text).value
      const x = book.withValue(sheet.id, r, c, typed, () => book.evalText(sheet.id, v.v1 ?? 'TRUE', r, c))
      const s = x instanceof Arr ? x.a[0][0] : x
      return s === true || (typeof s === 'number' && s !== 0) ? { ok: true } : bad()
    }
  }
}
