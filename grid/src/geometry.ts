import type { Book } from './engine/book'
import type { Sheet } from './engine/model'
import type { Rect } from './engine/types'

/**
 * Positions along rows or columns when most are the default size and a few are not (resized, hidden).
 * Works without storing a million offsets: `pos` and `indexAt` cost a binary search.
 */
export class Axis {
  private idx: number[] = []
  private pre: number[] = [] // sum of (size - default) over specials before position k
  constructor(readonly count: number, readonly def: number, sizes: Map<number, number>, hidden: Set<number>, auto?: Map<number, number>) {
    const all = new Map<number, number>()
    for (const [i, s] of auto ?? []) all.set(i, s)
    for (const [i, s] of sizes) all.set(i, s)
    for (const i of hidden) all.set(i, 0)
    const keys = [...all.keys()].filter((i) => i < count).sort((a, b) => a - b)
    let sum = 0
    for (const i of keys) { this.idx.push(i); this.pre.push(sum); sum += all.get(i)! - def; this.sizeAt.set(i, all.get(i)!) }
    this.sum = sum
  }
  private sizeAt = new Map<number, number>()
  private sum: number
  size(i: number): number { return this.sizeAt.get(i) ?? this.def }
  /** Number of special entries before index i. */
  private before(i: number): number { let lo = 0, hi = this.idx.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.idx[m] < i) lo = m + 1; else hi = m } return lo }
  pos(i: number): number { const k = this.before(i); return i * this.def + (k < this.idx.length ? this.pre[k] : this.sum) }
  get total() { return this.count * this.def + this.sum }
  /** The index whose span contains px (clamped to the valid range). Hidden entries are skipped. */
  indexAt(px: number): number {
    if (px <= 0) return 0
    let lo = 0, hi = this.count - 1
    while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (this.pos(m) <= px) lo = m; else hi = m - 1 }
    while (lo < this.count - 1 && this.size(lo) === 0) lo++
    return lo
  }
}

export class MergeIndex {
  private byRow = new Map<number, Rect[]>()
  constructor(merges: Rect[]) {
    for (const m of merges) for (let r = m.r1; r <= Math.min(m.r2, m.r1 + 5000); r++) { let a = this.byRow.get(r); if (!a) this.byRow.set(r, (a = [])); a.push(m) }
  }
  at(r: number, c: number): Rect | undefined { const a = this.byRow.get(r); if (a) for (const m of a) if (c >= m.c1 && c <= m.c2) return m }
}

export interface Layout { rows: Axis; cols: Axis; merges: MergeIndex; sig: string }
const cache = new WeakMap<Sheet, Layout>()

/** Row and column geometry for a sheet, rebuilt only when something about sizes changed. */
export function layoutOf(book: Book, sheet: Sheet): Layout {
  const filt = sheet.filter ? book.filteredRows(sheet.id) : undefined
  const sig = `${book.layoutVersion}:${sheet.rows}:${sheet.cols}:${sheet.autoH?.size ?? 0}:${filt ? [...filt].join(',') : ''}:${sheet.merges.length}`
  const hit = cache.get(sheet)
  if (hit && hit.sig === sig) return hit
  const hiddenRows = filt && filt.size ? new Set([...sheet.hiddenRows, ...filt]) : sheet.hiddenRows
  const l: Layout = {
    rows: new Axis(sheet.rows, sheet.defaultRowH, sheet.rowH, hiddenRows, sheet.autoH),
    cols: new Axis(sheet.cols, sheet.defaultColW, sheet.colW, sheet.hiddenCols),
    merges: new MergeIndex(sheet.merges),
    sig,
  }
  cache.set(sheet, l)
  return l
}
