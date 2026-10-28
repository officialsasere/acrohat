import { toBool, toNumber, toText } from '../coerce'
import type { Node } from '../ast'
import { Arr, E, isErr, Ref, XlErr, type Scalar, type Value } from '../types'
import { Lambda, applyLambda, bool, def, elementwise, evalNode, finalize, flat, int, isArrayArg, lazy, num, scalar, str, toArr, type Ctx } from '../eval'

const opt = (v: Value | undefined | null) => v === undefined || v === null

// ---- branching (lazy, so only the chosen branch is evaluated)
lazy('IF', 2, 3, ([c0, a, b], ctx) => {
  const cond = evalNode(c0!, ctx)
  if (isArrayArg(cond)) {
    const t = a ? evalNode(a, ctx) : true, f = b ? evalNode(b, ctx) : false
    const tr = isArrayArg(t) ? toArr(t, ctx) : null, fr = isArrayArg(f) ? toArr(f, ctx) : null
    const cc = toArr(cond, ctx)
    const pick = (arr: Arr | null, v: Value, i: number, j: number): Scalar => (arr ? arr.a[arr.rows === 1 ? 0 : i]?.[arr.cols === 1 ? 0 : j] ?? E.NA : scalar(v, ctx))
    return Arr.of(cc.rows, cc.cols, (i, j) => {
      const x = cc.a[i][j]
      if (isErr(x)) return x
      try { return toBool(x) ? pick(tr, t, i, j) : pick(fr, f, i, j) } catch (e) { if (e instanceof XlErr) return e; throw e }
    })
  }
  const x = scalar(cond, ctx)
  if (isErr(x)) return x
  if (toBool(x)) return a ? evalNode(a, ctx) : true
  return b ? evalNode(b, ctx) : false
})
lazy('IFS', 2, 254, (args, ctx) => {
  if (args.length % 2) throw E.NA
  for (let i = 0; i < args.length; i += 2) {
    const x = scalar(evalNode(args[i]!, ctx), ctx)
    if (isErr(x)) return x
    if (toBool(x)) return evalNode(args[i + 1]!, ctx)
  }
  throw E.NA
})
lazy('IFERROR', 2, 2, ([a, b], ctx) => {
  const v = evalNode(a!, ctx)
  if (isArrayArg(v)) { const alt = evalNode(b!, ctx); return elementwise([v, alt], ctx, (x) => (isErr(x[0]) ? x[1] : x[0])) }
  const x = scalar(v, ctx)
  return isErr(x) ? evalNode(b!, ctx) : v
})
lazy('IFNA', 2, 2, ([a, b], ctx) => {
  const v = evalNode(a!, ctx)
  if (isArrayArg(v)) { const alt = evalNode(b!, ctx); return elementwise([v, alt], ctx, (x) => (isErr(x[0]) && x[0].code === '#N/A' ? x[1] : x[0])) }
  const x = scalar(v, ctx)
  return isErr(x) && x.code === '#N/A' ? evalNode(b!, ctx) : v
})
lazy('SWITCH', 3, 254, (args, ctx) => {
  const target = scalar(evalNode(args[0]!, ctx), ctx)
  if (isErr(target)) return target
  let i = 1
  for (; i + 1 < args.length; i += 2) {
    const c = scalar(evalNode(args[i]!, ctx), ctx)
    if (typeof c === typeof target && (typeof c === 'string' ? c.toLowerCase() === (target as string).toLowerCase() : c === target)) return evalNode(args[i + 1]!, ctx)
  }
  if (i < args.length) return evalNode(args[i]!, ctx)
  throw E.NA
})
lazy('CHOOSE', 2, 255, (args, ctx) => {
  const i = int(evalNode(args[0]!, ctx), ctx)
  if (i < 1 || i >= args.length) throw E.VALUE
  return evalNode(args[i]!, ctx)
})

// ---- boolean logic
const boolsOf = (args: Value[], ctx: Ctx) => {
  const out: boolean[] = []
  for (const a of args) {
    if (isArrayArg(a)) { for (const x of flat(a, ctx)) { if (isErr(x)) throw x; if (typeof x === 'boolean') out.push(x); else if (typeof x === 'number') out.push(x !== 0) } }
    else { const x = scalar(a, ctx); if (isErr(x)) throw x; if (x !== null) out.push(toBool(x)) }
  }
  if (!out.length) throw E.VALUE
  return out
}
def('AND', 1, 255, (a, c) => boolsOf(a, c).every(Boolean))
def('OR', 1, 255, (a, c) => boolsOf(a, c).some(Boolean))
def('XOR', 1, 255, (a, c) => boolsOf(a, c).filter(Boolean).length % 2 === 1)
def('NOT', 1, 1, ([a], c) => !bool(a, c), { scalar: true })
def('TRUE', 0, 0, () => true)
def('FALSE', 0, 0, () => false)

// ---- LET, LAMBDA and the functions that take them
lazy('LET', 3, 254, (args, ctx) => {
  if (args.length % 2 === 0) throw E.VALUE
  const vars = new Map(ctx.vars ?? [])
  const inner: Ctx = { ...ctx, vars }
  for (let i = 0; i + 1 < args.length; i += 2) {
    const nm = args[i]
    if (!nm || nm.t !== 'name') throw E.NAME
    vars.set(nm.name.toUpperCase(), evalNode(args[i + 1]!, inner))
  }
  return evalNode(args[args.length - 1]!, inner)
})
lazy('LAMBDA', 1, 254, (args, ctx) => {
  const params = args.slice(0, -1).map((a) => { if (!a || a.t !== 'name') throw E.NAME; return a.name })
  return new Lambda(params, args[args.length - 1]!, new Map(ctx.vars ?? [])) as unknown as Value
})
const asLambda = (n: Node | null, ctx: Ctx): Lambda => {
  const v = n ? evalNode(n, ctx) : null
  if (!(v instanceof Lambda)) throw E.VALUE
  return v
}
const cellsOf = (n: Node | null, ctx: Ctx) => toArr(evalNode(n!, ctx), ctx)
const sc = (v: Value, ctx: Ctx): Scalar => { const f = finalize(v, ctx); return f instanceof Arr ? f.a[0][0] : f }
lazy('MAP', 2, 255, (args, ctx) => {
  const f = asLambda(args[args.length - 1]!, ctx)
  const arrs = args.slice(0, -1).map((a) => cellsOf(a, ctx))
  return Arr.of(arrs[0].rows, arrs[0].cols, (i, j) => { try { return sc(applyLambda(f, arrs.map((a) => a.a[i][j]), ctx), ctx) } catch (e) { if (e instanceof XlErr) return e; throw e } })
})
lazy('REDUCE', 3, 3, ([init, arr, fn], ctx) => {
  const f = asLambda(fn, ctx)
  let acc: Value = evalNode(init!, ctx)
  for (const x of cellsOf(arr, ctx).a.flat()) acc = finalize(applyLambda(f, [acc, x], ctx), ctx)
  return acc
})
lazy('SCAN', 3, 3, ([init, arr, fn], ctx) => {
  const f = asLambda(fn, ctx)
  const a = cellsOf(arr, ctx)
  let acc: Value = evalNode(init!, ctx)
  return Arr.of(a.rows, a.cols, (i, j) => { acc = finalize(applyLambda(f, [acc, a.a[i][j]], ctx), ctx); return sc(acc, ctx) })
})
lazy('BYROW', 2, 2, ([arr, fn], ctx) => {
  const f = asLambda(fn, ctx), a = cellsOf(arr, ctx)
  return new Arr(a.a.map((row) => [sc(applyLambda(f, [new Arr([row])], ctx), ctx)]))
})
lazy('BYCOL', 2, 2, ([arr, fn], ctx) => {
  const f = asLambda(fn, ctx), a = cellsOf(arr, ctx)
  return new Arr([Array.from({ length: a.cols }, (_, j) => sc(applyLambda(f, [new Arr(a.a.map((r) => [r[j]]))], ctx), ctx))])
})
lazy('MAKEARRAY', 3, 3, ([r, c, fn], ctx) => {
  const f = asLambda(fn, ctx), rows = int(evalNode(r!, ctx), ctx), cols = int(evalNode(c!, ctx), ctx)
  if (rows < 1 || cols < 1) throw E.CALC
  return Arr.of(rows, cols, (i, j) => sc(applyLambda(f, [i + 1, j + 1], ctx), ctx))
})
def('ARRAYFORMULA', 1, 1, ([a]) => a as Value)

// ---- information
const test = (name: string, f: (v: Scalar) => boolean) => def(name, 1, 1, ([a], c) => f(scalar(a, c)), { scalar: true })
test('ISBLANK', (v) => v === null)
test('ISNUMBER', (v) => typeof v === 'number')
test('ISTEXT', (v) => typeof v === 'string')
test('ISNONTEXT', (v) => typeof v !== 'string')
test('ISLOGICAL', (v) => typeof v === 'boolean')
test('ISERROR', (v) => isErr(v))
test('ISERR', (v) => isErr(v) && v.code !== '#N/A')
test('ISNA', (v) => isErr(v) && v.code === '#N/A')
def('ISEVEN', 1, 1, ([a], c) => Math.floor(Math.abs(num(a, c))) % 2 === 0, { scalar: true })
def('ISODD', 1, 1, ([a], c) => Math.floor(Math.abs(num(a, c))) % 2 === 1, { scalar: true })
def('ISREF', 1, 1, ([a]) => a instanceof Ref)
def('ISFORMULA', 1, 1, ([a], c) => a instanceof Ref && c.host.formulaText(a.sheet, a.r1, a.c1) !== null)
def('ISEMAIL', 1, 1, ([a], c) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str(a, c)), { scalar: true })
def('ISURL', 1, 1, ([a], c) => /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i.test(str(a, c)), { scalar: true })
def('ISDATE', 1, 1, ([a], c) => { const v = scalar(a, c); return typeof v === 'number' && v >= 1 && v < 2958466 }, { scalar: true })
def('FORMULATEXT', 1, 1, ([a], c) => { if (!(a instanceof Ref)) throw E.NA; const f = c.host.formulaText(a.sheet, a.r1, a.c1); if (f === null) throw E.NA; return f })
def('N', 1, 1, ([a], c) => { const v = scalar(a, c); return typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0 }, { scalar: true })
def('NA', 0, 0, () => E.NA)
def('TYPE', 1, 1, ([a], c) => { if (isArrayArg(a)) return 64; const v = scalar(a, c); return typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 4 : isErr(v) ? 16 : 1 })
def('ERROR.TYPE', 1, 1, ([a], c) => {
  const v = scalar(a, c)
  if (!isErr(v)) throw E.NA
  const codes = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']
  const i = codes.indexOf(v.code)
  if (i < 0) throw E.NA
  return i + 1
}, { scalar: true })
def('SHEET', 0, 1, ([a], c) => { if (opt(a)) return c.sheet + 1; if (a instanceof Ref) return a.sheet + 1; const id = c.host.sheetId(str(a!, c)); if (id === undefined) throw E.NA; return id + 1 })
def('SHEETS', 0, 1, () => 1, {})
def('CELL', 1, 2, ([t, r], c) => {
  const kind = str(t, c).toLowerCase()
  const ref = r instanceof Ref ? r : new Ref(c.sheet, c.row, c.col, c.row, c.col)
  switch (kind) {
    case 'row': return ref.r1 + 1
    case 'col': return ref.c1 + 1
    case 'contents': return c.host.cell(ref.sheet, ref.r1, ref.c1)
    case 'type': { const v = c.host.cell(ref.sheet, ref.r1, ref.c1); return v === null ? 'b' : typeof v === 'string' ? 'l' : 'v' }
    case 'address': return '$' + String.fromCharCode(65 + (ref.c1 % 26)) + '$' + (ref.r1 + 1)
    default: throw E.VALUE
  }
})
def('ROW', 0, 1, ([a], c) => {
  if (opt(a)) return c.row + 1
  if (!(a instanceof Ref)) throw E.VALUE
  return a.rows === 1 ? a.r1 + 1 : new Arr(Array.from({ length: a.rows }, (_, i) => [a.r1 + i + 1]))
})
def('COLUMN', 0, 1, ([a], c) => {
  if (opt(a)) return c.col + 1
  if (!(a instanceof Ref)) throw E.VALUE
  return a.cols === 1 ? a.c1 + 1 : new Arr([Array.from({ length: a.cols }, (_, i) => a.c1 + i + 1)])
})
def('ROWS', 1, 1, ([a], c) => (a instanceof Ref ? a.rows : toArr(a, c).rows))
def('COLUMNS', 1, 1, ([a], c) => (a instanceof Ref ? a.cols : toArr(a, c).cols))
export { toNumber, toText }
