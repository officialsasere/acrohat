import { parseNumberText } from './coerce'
import { parseDateTime } from './dates'
import { editText } from './numfmt'
import { E, XlErr, type ErrCode, type Scalar } from './types'

export interface Parsed {
  value: Scalar
  formula?: string
  /** A number format to apply if the cell has none yet ("12%" gets a percent format). */
  fmt?: string
}

const ERR = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!'])

/** Reads what someone typed into a cell: a formula, a number, a date, TRUE/FALSE, an error, or text. */
export function parseInput(text: string): Parsed {
  if (text === '') return { value: null }
  if (text[0] === "'") return { value: text.slice(1) }
  if (text[0] === '=' && text.length > 1) return { value: null, formula: text }
  if (text[0] === '+' && /^\+[A-Za-z(]/.test(text) && false) return { value: null, formula: '=' + text.slice(1) }
  const t = text.trim()
  if (!t) return { value: text }
  const up = t.toUpperCase()
  if (up === 'TRUE') return { value: true }
  if (up === 'FALSE') return { value: false }
  if (ERR.has(up)) return { value: new XlErr(up as ErrCode) }
  const n = parseNumberText(t)
  if (n !== null) {
    if (t.endsWith('%')) { const dec = /\.(\d+)%$/.exec(t); return { value: n, fmt: dec ? '0.' + '0'.repeat(dec[1].length) + '%' : '0%' } }
    const cur = /^\(?-?\s*([$€£¥₹])/.exec(t) ?? /([$€£¥₹])\s*\)?$/.exec(t)
    if (cur) { const dec = /\.(\d+)/.exec(t); return { value: n, fmt: `${cur[1]}#,##0${dec ? '.' + '0'.repeat(dec[1].length) : '.00'}` } }
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) { const dec = /\.(\d+)$/.exec(t); return { value: n, fmt: '#,##0' + (dec ? '.' + '0'.repeat(dec[1].length) : '') } }
    return { value: n }
  }
  const d = parseDateTime(t)
  if (d) {
    const iso = /^\d{4}-\d{2}-\d{2}/.test(t)
    const fmt = d.hasDate && d.hasTime ? (iso ? 'yyyy-mm-dd hh:mm' : 'm/d/yyyy h:mm') : d.hasDate ? (iso ? 'yyyy-mm-dd' : /[A-Za-z]/.test(t) ? 'mmm d, yyyy' : 'm/d/yyyy') : /[ap]m/i.test(t) ? 'h:mm AM/PM' : /:\d{2}:\d{2}/.test(t) ? 'h:mm:ss' : 'h:mm'
    return { value: d.serial, fmt }
  }
  return { value: text }
}

/** What the edit box shows for an existing cell. Text that would be read as something else gets a leading apostrophe. */
export function editStringOf(v: Scalar, formula: string | undefined, fmt: string): string {
  if (formula) return formula
  if (typeof v === 'string') {
    if (v === '') return ''
    const p = parseInput(v)
    return typeof p.value === 'string' && !p.formula && v[0] !== "'" ? v : "'" + v
  }
  return editText(v, fmt)
}
export { E }
