import { shiftFormula } from './refactor'
import { compareValues, parseNumberText } from './coerce'
import { formatValue } from './numfmt'
import type { Book } from './book'
import type { CellStyle, CfColor, CfRule, Sheet } from './model'
import { Arr, MAX_COLS, isErr, key, type Rect, type Scalar } from './types'
import { nowSerial } from './dates'

export interface CfResult {
  style?: CellStyle
  bg?: string
  /** Data bar: fraction of the cell width, and its colour. */
  bar?: { frac: number; color: string; negative?: boolean; zero?: number; gradient?: boolean }
}

const inRects = (rects: Rect[], r: number, c: number) => rects.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2)
const hex = (c: string) => { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const mix = (a: string, b: string, t: number) => {
  const x = hex(a), y = hex(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

/** Works out the conditional formatting of cells on one sheet. Results are cached until something changes. */
export class CfEvaluator {
  private version = -1
  private cache = new Map<number, CfResult | null>()
  private stats = new Map<string, unknown>()
  constructor(private book: Book, private sheet: Sheet) {}

  private reset() {
    if (this.version !== this.book.version) { this.version = this.book.version; this.cache.clear(); this.stats.clear() }
  }
  has(): boolean { return this.sheet.cf.length > 0 }

  styleFor(r: number, c: number): CfResult | null {
    if (!this.sheet.cf.length) return null
    this.reset()
    const k = key(r, c)
    const hit = this.cache.get(k)
    if (hit !== undefined) return hit
    let out: CfResult = {}
    let any = false
    for (const rule of this.sheet.cf) {
      if (!inRects(rule.ranges, r, c)) continue
      const res = this.apply(rule, r, c)
      if (res) { any = true; out = { ...out, ...res, style: { ...out.style, ...res.style } }; if (rule.stop) break }
    }
    const final = any ? out : null
    this.cache.set(k, final)
    return final
  }

  private values(rule: CfRule): number[] {
    const id = `v:${rule.id}`
    let v = this.stats.get(id) as number[] | undefined
    if (!v) {
      v = []
      for (const g of rule.ranges) for (let r = g.r1; r <= Math.min(g.r2, this.sheet.rows - 1); r++) for (let c = g.c1; c <= Math.min(g.c2, this.sheet.cols - 1); c++) { const x = this.book.value(this.sheet.id, r, c); if (typeof x === 'number') v.push(x) }
      this.stats.set(id, v)
    }
    return v
  }
  private dupCounts(rule: CfRule): Map<string, number> {
    const id = `d:${rule.id}`
    let m = this.stats.get(id) as Map<string, number> | undefined
    if (!m) {
      m = new Map()
      for (const g of rule.ranges) for (let r = g.r1; r <= Math.min(g.r2, this.sheet.rows - 1); r++) for (let c = g.c1; c <= Math.min(g.c2, this.sheet.cols - 1); c++) {
        const x = this.book.value(this.sheet.id, r, c)
        if (x === null || x === '') continue
        const kk = typeof x === 'string' ? x.toLowerCase() : String(x)
        m.set(kk, (m.get(kk) ?? 0) + 1)
      }
      this.stats.set(id, m)
    }
    return m
  }
  private operand(text: string | undefined, r: number, c: number): Scalar {
    if (text === undefined) return null
    if (text.startsWith('=')) { const v = this.book.evalText(this.sheet.id, text, r, c); return v instanceof Arr ? v.a[0][0] : v }
    const n = parseNumberText(text)
    return n ?? text
  }
  private threshold(spec: CfColor, vals: number[]): number {
    const s = [...vals].sort((a, b) => a - b)
    if (!s.length) return 0
    switch (spec.type) {
      case 'min': return s[0]
      case 'max': return s[s.length - 1]
      case 'num': return spec.value ?? 0
      case 'percent': return s[0] + ((s[s.length - 1] - s[0]) * (spec.value ?? 50)) / 100
      case 'percentile': { const i = ((spec.value ?? 50) / 100) * (s.length - 1); const lo = Math.floor(i); return s[lo] + (i - lo) * ((s[Math.min(lo + 1, s.length - 1)]) - s[lo]) }
    }
  }

  private apply(rule: CfRule, r: number, c: number): CfResult | null {
    const v = this.book.value(this.sheet.id, r, c)
    const yes = (ok: boolean): CfResult | null => (ok ? { style: rule.style } : null)
    switch (rule.type) {
      case 'blanks': return yes(v === null || v === '')
      case 'noblanks': return yes(!(v === null || v === ''))
      case 'errors': return yes(isErr(v))
      case 'noerrors': return yes(!isErr(v))
      case 'duplicates': case 'unique': {
        if (v === null || v === '') return null
        const n = this.dupCounts(rule).get(typeof v === 'string' ? v.toLowerCase() : String(v)) ?? 0
        return yes(rule.type === 'duplicates' ? n > 1 : n === 1)
      }
      case 'text': {
        const t = formatValue(v, this.book.styleOf(this.sheet.id, r, c).fmt ?? 'General').text.toLowerCase(), q = (rule.v1 ?? '').toLowerCase()
        return yes(rule.op === 'notContains' ? !t.includes(q) : rule.op === 'begins' ? t.startsWith(q) : rule.op === 'ends' ? t.endsWith(q) : t.includes(q))
      }
      case 'cell': {
        const a = this.operand(rule.v1, r, c), b = this.operand(rule.v2, r, c)
        if (v === null && rule.op !== '=' && rule.op !== '<>') return null
        try {
          const cmp = (x: Scalar) => compareValues(v, x)
          switch (rule.op) {
            case '>': return yes(typeof v === typeof a && cmp(a) > 0)
            case '>=': return yes(typeof v === typeof a && cmp(a) >= 0)
            case '<': return yes(typeof v === typeof a && cmp(a) < 0)
            case '<=': return yes(typeof v === typeof a && cmp(a) <= 0)
            case '=': return yes(cmp(a) === 0)
            case '<>': return yes(cmp(a) !== 0)
            case 'between': return yes(typeof v === 'number' && cmp(a) >= 0 && cmp(b) <= 0)
            case 'notBetween': return yes(typeof v === 'number' && (cmp(a) < 0 || cmp(b) > 0))
          }
        } catch { return null }
        return null
      }
      case 'top': {
        if (typeof v !== 'number') return null
        const vals = [...this.values(rule)].sort((x, y) => (rule.op === 'bottom' ? x - y : y - x))
        const n = rule.percent ? Math.max(1, Math.round((vals.length * (rule.n ?? 10)) / 100)) : Math.min(rule.n ?? 10, vals.length)
        const edge = vals[n - 1]
        return yes(rule.op === 'bottom' ? v <= edge : v >= edge)
      }
      case 'above': {
        if (typeof v !== 'number') return null
        const vals = this.values(rule)
        const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
        return yes(rule.op === 'below' ? v < avg : v > avg)
      }
      case 'date': {
        if (typeof v !== 'number') return null
        const today = Math.floor(nowSerial()), d = Math.floor(v)
        const wk = (x: number) => Math.floor((x + 6) / 7)
        switch (rule.op) {
          case 'today': return yes(d === today)
          case 'yesterday': return yes(d === today - 1)
          case 'tomorrow': return yes(d === today + 1)
          case 'thisweek': return yes(wk(d) === wk(today))
          case 'lastweek': return yes(wk(d) === wk(today) - 1)
          case 'thismonth': return yes(Math.floor((d - 1) / 30.4375) === Math.floor((today - 1) / 30.4375))
          case 'past': return yes(d < today)
          case 'future': return yes(d > today)
        }
        return null
      }
      case 'formula': {
        const first = rule.ranges[0]
        const f = shiftFormula(rule.formula?.startsWith('=') ? rule.formula : '=' + (rule.formula ?? ''), r - first.r1, c - first.c1)
        const x = this.book.evalText(this.sheet.id, f, r, c)
        const s = x instanceof Arr ? x.a[0][0] : x
        return yes(s === true || (typeof s === 'number' && s !== 0))
      }
      case 'scale': {
        if (typeof v !== 'number' || !rule.scale) return null
        const vals = this.values(rule)
        const lo = this.threshold(rule.scale.min, vals), hi = this.threshold(rule.scale.max, vals)
        const t = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
        if (rule.scale.mid) {
          const mid = this.threshold(rule.scale.mid, vals)
          const bg = v <= mid ? mix(rule.scale.min.color, rule.scale.mid.color, mid === lo ? 1 : Math.max(0, Math.min(1, (v - lo) / (mid - lo)))) : mix(rule.scale.mid.color, rule.scale.max.color, hi === mid ? 1 : Math.max(0, Math.min(1, (v - mid) / (hi - mid))))
          return { bg }
        }
        return { bg: mix(rule.scale.min.color, rule.scale.max.color, t) }
      }
      case 'bar': {
        if (typeof v !== 'number' || !rule.bar) return null
        const vals = this.values(rule)
        const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
        const span = hi - lo || 1
        return { bar: { frac: Math.abs(v) / span, color: v < 0 ? rule.bar.negative ?? '#e57373' : rule.bar.color, negative: v < 0, zero: -lo / span, gradient: rule.bar.gradient } }
      }
    }
    return null
  }
}
export { MAX_COLS }
