import { compareValues, toBool, toNumber, toText } from '../coerce'
import { wildcardRegex } from '../criteria'
import { cellName, colName, parseRange, quoteSheet } from '../address'
import { Arr, E, isErr, Ref, type Scalar, type Value, MAX_COLS, MAX_ROWS } from '../types'
import { clipRef, def, flat, int, isArrayArg, num, scalar, str, toArr, type Ctx } from '../eval'

const opt = (v: Value | undefined | null) => v === undefined || v === null

/** Matches a lookup value against a cell: same kind, case-insensitive text, optional wildcards. */
function eq(look: Scalar, x: Scalar, wild: boolean): boolean {
  if (typeof look === 'string' && typeof x === 'string') return wild && /[*?~]/.test(look) ? wildcardRegex(look).test(x) : look.toLowerCase() === x.toLowerCase()
  if (typeof look !== typeof x) return false
  return look === x
}
const sameKind = (a: Scalar, b: Scalar) => typeof a === typeof b
/** Position of the last value <= look in sorted data (-1 = none), or the first value >= look when desc. */
function approx(vals: Scalar[], look: Scalar, desc = false): number {
  let lo = 0, hi = vals.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = vals[mid]
    if (v === null || !sameKind(v, look)) { // skip over blanks and other types: scan linearly from here
      let k = mid
      while (k >= lo && (vals[k] === null || !sameKind(vals[k], look))) k--
      if (k < lo) { lo = mid + 1; continue }
      const cmp = compareValues(vals[k], look)
      if (desc ? cmp >= 0 : cmp <= 0) { best = k; lo = mid + 1 } else hi = k - 1
      continue
    }
    const cmp = compareValues(v, look)
    if (desc ? cmp >= 0 : cmp <= 0) { best = mid; lo = mid + 1 } else hi = mid - 1
  }
  return best
}

function vlook(look: Scalar, tbl: Arr, idx: number, exact: boolean, byRow: boolean): Scalar {
  const vec = byRow ? tbl.a[0] : tbl.a.map((r) => r[0])
  const n = byRow ? tbl.cols : tbl.rows
  const limit = byRow ? tbl.rows : tbl.cols
  if (idx < 1) throw E.VALUE
  if (idx > limit) throw E.REF
  let i: number
  if (exact) { i = vec.findIndex((x) => eq(look, x, true)); if (i < 0) throw E.NA }
  else { i = approx(vec, look); if (i < 0) throw E.NA }
  void n
  return byRow ? tbl.a[idx - 1][i] : tbl.a[i][idx - 1]
}
def('VLOOKUP', 3, 4, ([l, t, i, e], c) => {
  const look = scalar(l, c)
  if (isErr(look)) throw look
  return vlook(look, toArr(t, c), int(i, c), !opt(e) && !toBool(scalar(e!, c)) , false)
}, { scalar: false })
def('HLOOKUP', 3, 4, ([l, t, i, e], c) => {
  const look = scalar(l, c)
  if (isErr(look)) throw look
  return vlook(look, toArr(t, c), int(i, c), !opt(e) && !toBool(scalar(e!, c)), true)
})
def('MATCH', 2, 3, ([l, a, t], c) => {
  const look = scalar(l, c)
  if (isErr(look)) throw look
  const vals = flat(a, c), type = opt(t) ? 1 : int(t!, c)
  let i: number
  if (type === 0) i = vals.findIndex((x) => eq(look, x, true))
  else i = approx(vals, look, type < 0)
  if (i < 0) throw E.NA
  return i + 1
})
def('XMATCH', 2, 4, ([l, a, mm, sm], c) => {
  const look = scalar(l, c)
  const vals = flat(a, c), mode = opt(mm) ? 0 : int(mm!, c), search = opt(sm) ? 1 : int(sm!, c)
  return xfind(look, vals, mode, search) + 1
})
function xfind(look: Scalar, vals: Scalar[], mode: number, search: number): number {
  const order = search < 0 ? vals.map((_, i) => vals.length - 1 - i) : vals.map((_, i) => i)
  if (search === 2 || search === -2) {
    // binary search on sorted data (assume ascending for 2, descending for -2)
    const i = mode === 0 ? vals.findIndex((x) => eq(look, x, false)) : approx(vals, look, search === -2)
    if (i < 0) throw E.NA
    return i
  }
  for (const i of order) if (eq(look, vals[i], mode === 2)) return i
  if (mode === -1 || mode === 1) {
    let best = -1
    for (const i of order) {
      const v = vals[i]
      if (v === null || !sameKind(v, look)) continue
      const cmp = compareValues(v, look)
      if (mode === -1 ? cmp < 0 : cmp > 0) if (best < 0 || (mode === -1 ? compareValues(v, vals[best]) > 0 : compareValues(v, vals[best]) < 0)) best = i
    }
    if (best >= 0) return best
  }
  throw E.NA
}
def('XLOOKUP', 3, 6, ([l, la, ra, nf, mm, sm], c) => {
  const look = scalar(l, c)
  const lookArr = toArr(la, c), ret = toArr(ra, c)
  const vals = lookArr.a.flat()
  const byCol = lookArr.rows === 1 && lookArr.cols > 1
  let i: number
  try { i = xfind(look, vals, opt(mm) ? 0 : int(mm!, c), opt(sm) ? 1 : int(sm!, c)) } catch (e) { if (!opt(nf)) return scalar(nf!, c); throw e }
  if (byCol) return new Arr(ret.a.map((r) => [r[i]]))
  return new Arr([ret.a[i]])
})
def('LOOKUP', 2, 3, ([l, a, r], c) => {
  const look = scalar(l, c)
  const arr = toArr(a, c)
  const wide = arr.cols > arr.rows
  const vec = wide ? arr.a[0] : arr.a.map((x) => x[0])
  const i = approx(vec, look)
  if (i < 0) throw E.NA
  if (!opt(r)) return flat(r!, c)[i] ?? E.NA
  return wide ? arr.a[arr.rows - 1][i] : arr.a[i][arr.cols - 1]
})

// ---- references
def('INDEX', 2, 4, ([a, r, k], c) => {
  const row = opt(r) ? 0 : int(r!, c), col = opt(k) ? 0 : int(k!, c)
  if (a instanceof Ref) {
    const ref = clipRef(c, a)
    let rr = row, cc = col
    if (ref.rows === 1 && !opt(r) && opt(k)) { cc = row; rr = 0 }
    if (rr < 0 || cc < 0 || rr > ref.rows || cc > ref.cols) throw E.REF
    const r1 = rr === 0 ? ref.r1 : ref.r1 + rr - 1, r2 = rr === 0 ? ref.r2 : r1
    const c1 = cc === 0 ? ref.c1 : ref.c1 + cc - 1, c2 = cc === 0 ? ref.c2 : c1
    return new Ref(ref.sheet, r1, c1, r2, c2)
  }
  const arr = toArr(a, c)
  let rr = row, cc = col
  if (arr.rows === 1 && !opt(r) && opt(k)) { cc = row; rr = 0 }
  if (rr < 0 || cc < 0 || rr > arr.rows || cc > arr.cols) throw E.REF
  if (rr === 0 && cc === 0) return arr
  if (rr === 0) return new Arr(arr.a.map((x) => [x[cc - 1]]))
  if (cc === 0) return new Arr([arr.a[rr - 1]])
  return arr.a[rr - 1][cc - 1]
})
def('OFFSET', 3, 5, ([a, r, k, h, w], c) => {
  if (!(a instanceof Ref)) throw E.VALUE
  const dr = int(r, c), dc = int(k, c)
  const rows = opt(h) ? a.rows : int(h!, c), cols = opt(w) ? a.cols : int(w!, c)
  if (rows < 1 || cols < 1) throw E.REF
  const r1 = a.r1 + dr, c1 = a.c1 + dc
  if (r1 < 0 || c1 < 0 || r1 + rows > MAX_ROWS || c1 + cols > MAX_COLS) throw E.REF
  return new Ref(a.sheet, r1, c1, r1 + rows - 1, c1 + cols - 1)
}, { volatile: true })
def('INDIRECT', 1, 2, ([t], c) => {
  const text = str(t, c).trim()
  const p = parseRange(text)
  if (!p) throw E.REF
  let sheet = c.sheet
  if (p.sheet) { const id = c.host.sheetId(p.sheet); if (id === undefined) throw E.REF; sheet = id }
  return new Ref(sheet, p.r1, p.c1, p.r2, p.c2)
}, { volatile: true })
def('ADDRESS', 2, 5, ([r, k, ab, a1, sh], c) => {
  const row = int(r, c), col = int(k, c), abs = opt(ab) ? 1 : int(ab!, c)
  if (row < 1 || col < 1 || row > MAX_ROWS || col > MAX_COLS) throw E.VALUE
  const style = opt(a1) ? true : toBool(scalar(a1!, c))
  let t: string
  if (style) t = `${abs === 1 || abs === 3 ? '$' : ''}${colName(col - 1)}${abs === 1 || abs === 2 ? '$' : ''}${row}`
  else t = `R${abs === 1 || abs === 2 ? row : `[${row}]`}C${abs === 1 || abs === 3 ? col : `[${col}]`}`
  return opt(sh) ? t : `${quoteSheet(str(sh!, c))}!${t}`
})
def('HYPERLINK', 1, 2, ([u, l], c) => (opt(l) ? str(u, c) : scalar(l!, c)), { scalar: true })

// ---- array shaping
const w = (a: Arr, f: (r: Scalar[]) => Scalar[][]) => new Arr(f(a.a.flat()))
void w
def('UNIQUE', 1, 3, ([a, bc, once], c) => {
  const arr = toArr(a, c), byCol = !opt(bc) && toBool(scalar(bc!, c)), exactlyOnce = !opt(once) && toBool(scalar(once!, c))
  const items = byCol ? Array.from({ length: arr.cols }, (_, j) => arr.a.map((r) => r[j])) : arr.a
  const keyOf = (v: Scalar[]) => v.map((x) => (typeof x === 'string' ? 's' + x.toLowerCase() : typeof x + String(x))).join('\u0001')
  const counts = new Map<string, number>()
  for (const it of items) counts.set(keyOf(it), (counts.get(keyOf(it)) ?? 0) + 1)
  const seen = new Set<string>()
  const out: Scalar[][] = []
  for (const it of items) { const k = keyOf(it); if (seen.has(k)) continue; seen.add(k); if (!exactlyOnce || counts.get(k) === 1) out.push(it) }
  if (!out.length) throw E.CALC
  return byCol ? new Arr(Array.from({ length: arr.rows }, (_, i) => out.map((col) => col[i]))) : new Arr(out)
})
function cmpCells(x: Scalar, y: Scalar): number {
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  if (isErr(x) || isErr(y)) return isErr(x) && isErr(y) ? 0 : isErr(x) ? 1 : -1
  return compareValues(x, y)
}
function sortRows(items: Scalar[][], keys: { col: number; dir: number }[]): Scalar[][] {
  return items.map((v, i) => ({ v, i })).sort((p, q) => { for (const k of keys) { const r = cmpCells(p.v[k.col], q.v[k.col]); if (r) return r * k.dir * (p.v[k.col] === null || q.v[k.col] === null ? k.dir : 1) } return p.i - q.i }).map((x) => x.v)
}
def('SORT', 1, 4, ([a, si, so, bc], c) => {
  const arr = toArr(a, c), byCol = !opt(bc) && toBool(scalar(bc!, c))
  const idx = opt(si) ? [1] : flat(si!, c).map((v) => toNumber(v)), ord = opt(so) ? [1] : flat(so!, c).map((v) => toNumber(v))
  const keys = idx.map((n, i) => ({ col: n - 1, dir: (ord[i] ?? ord[0]) === -1 ? -1 : 1 }))
  const items = byCol ? Array.from({ length: arr.cols }, (_, j) => arr.a.map((r) => r[j])) : arr.a
  if (keys.some((k) => k.col < 0 || k.col >= (items[0]?.length ?? 0))) throw E.VALUE
  const out = sortRows(items, keys)
  return byCol ? new Arr(Array.from({ length: arr.rows }, (_, i) => out.map((col) => col[i]))) : new Arr(out)
})
def('SORTBY', 2, 255, (args, c) => {
  const arr = toArr(args[0]!, c)
  const keys: { vals: Scalar[]; dir: number }[] = []
  for (let i = 1; i < args.length; i += 2) {
    const vals = flat(args[i]!, c)
    if (vals.length !== arr.rows) throw E.VALUE
    keys.push({ vals, dir: !opt(args[i + 1]) && int(args[i + 1]!, c) === -1 ? -1 : 1 })
  }
  const order = arr.a.map((_, i) => i).sort((p, q) => { for (const k of keys) { const r = cmpCells(k.vals[p], k.vals[q]); if (r) return r * k.dir }; return p - q })
  return new Arr(order.map((i) => arr.a[i]))
})
def('FILTER', 2, 3, ([a, inc, ie], c) => {
  const arr = toArr(a, c), cond = toArr(inc, c)
  let out: Scalar[][]
  if (cond.cols === 1 && cond.rows === arr.rows) out = arr.a.filter((_, i) => truthy(cond.a[i][0]))
  else if (cond.rows === 1 && cond.cols === arr.cols) { const keep = cond.a[0].map(truthy); out = arr.a.map((r) => r.filter((_, j) => keep[j])); if (out[0]?.length === 0) out = [] }
  else throw E.VALUE
  if (!out.length) { if (!opt(ie)) return scalar(ie!, c); throw E.CALC }
  return new Arr(out)
})
function truthy(x: Scalar): boolean { if (isErr(x)) throw x; return typeof x === 'boolean' ? x : typeof x === 'number' ? x !== 0 : false }
const stack = (args: Value[], c: Ctx, vertical: boolean) => {
  const arrs = args.map((a) => toArr(a, c))
  if (vertical) { const wd = Math.max(...arrs.map((a) => a.cols)); return new Arr(arrs.flatMap((a) => a.a.map((r) => [...r, ...Array(wd - r.length).fill(E.NA)]))) }
  const ht = Math.max(...arrs.map((a) => a.rows))
  return Arr.of(ht, arrs.reduce((s, a) => s + a.cols, 0), (i, j) => { let k = j; for (const a of arrs) { if (k < a.cols) return a.a[i]?.[k] ?? E.NA; k -= a.cols } return E.NA })
}
def('VSTACK', 1, 255, (a, c) => stack(a, c, true))
def('HSTACK', 1, 255, (a, c) => stack(a, c, false))
def('TAKE', 2, 3, ([a, r, k], c) => {
  const arr = toArr(a, c), rr = opt(r) ? arr.rows : int(r!, c), cc = opt(k) ? arr.cols : int(k!, c)
  const rows = rr >= 0 ? arr.a.slice(0, rr) : arr.a.slice(rr), out = rows.map((x) => (cc >= 0 ? x.slice(0, cc) : x.slice(cc)))
  if (!out.length || !out[0].length) throw E.CALC
  return new Arr(out)
})
def('DROP', 2, 3, ([a, r, k], c) => {
  const arr = toArr(a, c), rr = opt(r) ? 0 : int(r!, c), cc = opt(k) ? 0 : int(k!, c)
  const rows = rr >= 0 ? arr.a.slice(rr) : arr.a.slice(0, rr), out = rows.map((x) => (cc >= 0 ? x.slice(cc) : x.slice(0, cc)))
  if (!out.length || !out[0].length) throw E.CALC
  return new Arr(out)
})
def('CHOOSEROWS', 2, 255, ([a, ...ix], c) => { const arr = toArr(a, c); return new Arr(ix.flatMap((v) => flat(v!, c)).map((n) => { const i = toNumber(n); const k = i < 0 ? arr.rows + i : i - 1; if (k < 0 || k >= arr.rows) throw E.VALUE; return arr.a[k] })) })
def('CHOOSECOLS', 2, 255, ([a, ...ix], c) => { const arr = toArr(a, c); const cols = ix.flatMap((v) => flat(v!, c)).map((n) => { const i = toNumber(n); const k = i < 0 ? arr.cols + i : i - 1; if (k < 0 || k >= arr.cols) throw E.VALUE; return k }); return new Arr(arr.a.map((r) => cols.map((k) => r[k]))) })
const tovec = (a: Value, ig: Value | null | undefined, scan: Value | null | undefined, c: Ctx) => {
  const arr = toArr(a, c), mode = opt(ig) ? 0 : int(ig!, c), byCol = !opt(scan) && toBool(scalar(scan!, c))
  let v = byCol ? Array.from({ length: arr.cols }, (_, j) => arr.a.map((r) => r[j])).flat() : arr.a.flat()
  if (mode === 1 || mode === 3) v = v.filter((x) => x !== null)
  if (mode === 2 || mode === 3) v = v.filter((x) => !isErr(x))
  if (!v.length) throw E.CALC
  return v
}
def('TOCOL', 1, 3, ([a, ig, sc], c) => new Arr(tovec(a, ig, sc, c).map((x) => [x])))
def('TOROW', 1, 3, ([a, ig, sc], c) => new Arr([tovec(a, ig, sc, c)]))
def('FLATTEN', 1, 255, (args, c) => new Arr(args.flatMap((a) => flat(a, c)).map((x) => [x])))
def('WRAPROWS', 2, 3, ([a, n, p], c) => { const v = tovec(a, null, null, c), k = int(n, c), pad = opt(p) ? E.NA : scalar(p!, c); if (k < 1) throw E.NUM; const rows: Scalar[][] = []; for (let i = 0; i < v.length; i += k) { const r = v.slice(i, i + k); while (r.length < k) r.push(pad); rows.push(r) } return new Arr(rows) })
def('WRAPCOLS', 2, 3, ([a, n, p], c) => { const v = tovec(a, null, null, c), k = int(n, c), pad = opt(p) ? E.NA : scalar(p!, c); if (k < 1) throw E.NUM; const cols: Scalar[][] = []; for (let i = 0; i < v.length; i += k) { const r = v.slice(i, i + k); while (r.length < k) r.push(pad); cols.push(r) } return Arr.of(k, cols.length, (i, j) => cols[j][i]) })
def('EXPAND', 2, 4, ([a, r, k, p], c) => { const arr = toArr(a, c), rr = int(r, c), cc = opt(k) ? arr.cols : int(k!, c), pad = opt(p) ? E.NA : scalar(p!, c); if (rr < arr.rows || cc < arr.cols) throw E.VALUE; return Arr.of(rr, cc, (i, j) => (i < arr.rows && j < arr.cols ? arr.a[i][j] : pad)) })
def('ARRAY_CONSTRAIN', 3, 3, ([a, r, k], c) => { const arr = toArr(a, c); return new Arr(arr.a.slice(0, int(r, c)).map((x) => x.slice(0, int(k, c)))) })
def('SORTN', 1, 4, ([a, n, , o], c) => { const arr = toArr(a, c); const k = opt(n) ? 1 : int(n!, c); void o; return new Arr(sortRows(arr.a, [{ col: 0, dir: 1 }]).slice(0, k)) })
export { cellName, isArrayArg, num, toText }

// A whole column of lookup values gives a whole column of answers.
import { FUNCS } from '../eval'
for (const name of ['VLOOKUP', 'HLOOKUP', 'MATCH', 'XMATCH']) {
  const f = FUNCS.get(name)!
  const inner = f.fn!
  f.fn = (args, c) => {
    const first = args[0]
    if (!first || !isArrayArg(first)) return inner(args, c)
    const arr = toArr(first, c)
    return Arr.of(arr.rows, arr.cols, (i, j) => { try { const r = inner([arr.a[i][j], ...args.slice(1)], c); return r instanceof Arr || r instanceof Ref ? scalar(r, c) : (r as Scalar) } catch (e) { if (isErr(e)) return e; throw e } })
  }
}
