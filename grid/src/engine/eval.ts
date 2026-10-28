import { printNode, type Node, type RefNode } from './ast'
import { compareValues, toBool, toNumber, toText } from './coerce'
import { Arr, E, isErr, Ref, XlErr, type Scalar, type Value, MAX_COLS, MAX_ROWS } from './types'

/** What the evaluator needs from the workbook. */
export interface Host {
  /** The computed value of a cell (evaluating it first if it is out of date). */
  cell(sheet: number, row: number, col: number): Scalar
  sheetId(name: string): number | undefined
  sheetName(id: number): string
  sheetCount(): number
  /** A defined name: its formula, or undefined. */
  definedName(name: string, sheet: number): Node | undefined
  /** Last used row and column (0-based, or -1 if the sheet is empty), so whole-column references stay small. */
  usedRange(sheet: number): { rows: number; cols: number }
  formulaText(sheet: number, row: number, col: number): string | null
  now(): number
  /** Extra information a few functions need. */
  hasSpill?(sheet: number, row: number, col: number): { rows: number; cols: number } | null
  /** Records that a formula looked at something it cannot name in advance (OFFSET, INDIRECT). */
  volatile?(): void
  rowHidden?(sheet: number, row: number): boolean
  colHidden?(sheet: number, col: number): boolean
  /** Row filtered out by an active filter. */
  rowFiltered?(sheet: number, row: number): boolean
}

export class Lambda {
  constructor(public params: string[], public body: Node, public closure: Map<string, Value>) {}
}

export interface Ctx {
  host: Host
  sheet: number
  row: number
  col: number
  vars?: Map<string, Value>
  depth?: number
}

export type Fn = (args: Value[], ctx: Ctx) => Value
export type LazyFn = (args: (Node | null)[], ctx: Ctx) => Value
export interface FnDef { name: string; min: number; max: number; fn?: Fn; lazy?: LazyFn; scalar?: boolean; volatile?: boolean }

export const FUNCS = new Map<string, FnDef>()
export function def(name: string, min: number, max: number, fn: Fn, o: { scalar?: boolean; volatile?: boolean } = {}) {
  FUNCS.set(name, { name, min, max, fn, ...o })
}
export function lazy(name: string, min: number, max: number, fn: LazyFn, o: { volatile?: boolean } = {}) {
  FUNCS.set(name, { name, min, max, lazy: fn, ...o })
}

// ------------------------------------------------------------ value helpers

export const cellOf = (ctx: Ctx, ref: Ref, r: number, c: number): Scalar => ctx.host.cell(ref.sheet, ref.r1 + r, ref.c1 + c)

/** Whole-column and whole-row references only cover the part of the sheet that has data. */
export function clipRef(ctx: Ctx, ref: Ref): Ref {
  if (ref.r2 < MAX_ROWS - 1 && ref.c2 < MAX_COLS - 1) return ref
  const u = ctx.host.usedRange(ref.sheet)
  const r2 = ref.r2 >= MAX_ROWS - 1 ? Math.max(ref.r1, Math.min(ref.r2, u.rows - 1)) : ref.r2
  const c2 = ref.c2 >= MAX_COLS - 1 ? Math.max(ref.c1, Math.min(ref.c2, u.cols - 1)) : ref.c2
  return new Ref(ref.sheet, ref.r1, ref.c1, r2, c2)
}

export function toArr(v: Value, ctx: Ctx): Arr {
  if (v instanceof Arr) return v
  if (v instanceof Ref) {
    const r = clipRef(ctx, v)
    return Arr.of(r.rows, r.cols, (i, j) => ctx.host.cell(r.sheet, r.r1 + i, r.c1 + j))
  }
  return new Arr([[v]])
}

/** One value from anything: a single cell, the first item of an array, or the cell a range shares a row or column with. */
export function scalar(v: Value, ctx: Ctx): Scalar {
  if (v instanceof Ref) {
    if (v.single) return ctx.host.cell(v.sheet, v.r1, v.c1)
    // Implicit intersection with the formula's own row or column.
    if (v.cols === 1 && ctx.row >= v.r1 && ctx.row <= v.r2) return ctx.host.cell(v.sheet, ctx.row, v.c1)
    if (v.rows === 1 && ctx.col >= v.c1 && ctx.col <= v.c2) return ctx.host.cell(v.sheet, v.r1, ctx.col)
    return ctx.host.cell(v.sheet, v.r1, v.c1)
  }
  if (v instanceof Arr) return v.a[0]?.[0] ?? null
  if (v instanceof Lambda) throw E.CALC
  return v
}

export const num = (v: Value, ctx: Ctx) => toNumber(scalar(v, ctx))
export const int = (v: Value, ctx: Ctx) => Math.trunc(toNumber(scalar(v, ctx)))
export const str = (v: Value, ctx: Ctx) => toText(scalar(v, ctx))
export const bool = (v: Value, ctx: Ctx) => toBool(scalar(v, ctx))
export const isArrayArg = (v: Value): v is Arr | Ref => v instanceof Arr || (v instanceof Ref && !v.single)

/** The scalars of one argument, row by row. */
export function flat(v: Value, ctx: Ctx): Scalar[] {
  if (v instanceof Ref) {
    const r = clipRef(ctx, v)
    const out: Scalar[] = []
    for (let i = 0; i < r.rows; i++) for (let j = 0; j < r.cols; j++) out.push(ctx.host.cell(r.sheet, r.r1 + i, r.c1 + j))
    return out
  }
  if (v instanceof Arr) return v.a.flat()
  return [v as Scalar]
}

/** The numbers inside the arguments of SUM and friends. Text and booleans inside ranges are skipped; errors are thrown. */
export function numbers(args: Value[], ctx: Ctx, o: { text?: boolean } = {}): number[] {
  const out: number[] = []
  for (const a of args) {
    if (isArrayArg(a)) {
      for (const x of flat(a, ctx)) {
        if (typeof x === 'number') out.push(x)
        else if (isErr(x)) throw x
        else if (o.text && typeof x === 'boolean') out.push(x ? 1 : 0)
      }
    } else {
      const x = scalar(a, ctx)
      if (isErr(x)) throw x
      if (x === null) continue
      out.push(toNumber(x))
    }
  }
  return out
}

export function elementwise(args: Value[], ctx: Ctx, f: (xs: Scalar[]) => Scalar): Value {
  const arrs = args.map((a) => (isArrayArg(a) ? toArr(a, ctx) : null))
  const rows = Math.max(1, ...arrs.map((a) => a?.rows ?? 1)), cols = Math.max(1, ...arrs.map((a) => a?.cols ?? 1))
  const sc = args.map((a, i) => (arrs[i] ? null : scalar(a, ctx)))
  return Arr.of(rows, cols, (r, c) =>
    f(args.map((_, i) => {
      const a = arrs[i]
      if (!a) return sc[i] as Scalar
      return a.a[a.rows === 1 ? 0 : r]?.[a.cols === 1 ? 0 : c] ?? E.NA
    })),
  )
}

// ------------------------------------------------------------ operators

function arith(op: string, a: Scalar, b: Scalar): Scalar {
  if (isErr(a)) return a
  if (isErr(b)) return b
  try {
    switch (op) {
      case '&': return toText(a) + toText(b)
      case '+': return snap(toNumber(a), toNumber(b), toNumber(a) + toNumber(b))
      case '-': return snap(toNumber(a), toNumber(b), toNumber(a) - toNumber(b))
      case '*': return toNumber(a) * toNumber(b)
      case '/': { const d = toNumber(b); if (d === 0) return E.DIV0; return toNumber(a) / d }
      case '^': {
        const x = toNumber(a), y = toNumber(b)
        if (x === 0 && y < 0) return E.DIV0
        const r = Math.pow(x, y)
        return isNaN(r) ? E.NUM : r
      }
      case '=': return eqValues(a, b)
      case '<>': return !eqValues(a, b)
      case '<': return compareValues(a, b) < 0
      case '>': return compareValues(a, b) > 0
      case '<=': return compareValues(a, b) <= 0
      case '>=': return compareValues(a, b) >= 0
    }
  } catch (e) {
    if (e instanceof XlErr) return e
    throw e
  }
  return E.VALUE
}

/** A result that is zero up to rounding noise (0.1+0.2-0.3) shows as zero, as in other spreadsheets. */
function snap(a: number, b: number, r: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b))
  return r !== 0 && Math.abs(r) < m * 1e-15 ? 0 : r
}

function eqValues(a: Scalar, b: Scalar): boolean {
  if (a === null && b === null) return true
  return compareValues(a, b) === 0
}

function binary(op: string, a: Value, b: Value, ctx: Ctx): Value {
  if (!isArrayArg(a) && !isArrayArg(b)) {
    const r = arith(op, scalar(a, ctx), scalar(b, ctx))
    return typeof r === 'number' && !isFinite(r) ? E.NUM : r
  }
  return elementwise([a, b], ctx, (x) => arith(op, x[0], x[1]))
}

// ------------------------------------------------------------ evaluation

function refValue(n: RefNode, ctx: Ctx): Value {
  let sheet = ctx.sheet
  if (n.sheet !== undefined) {
    const id = ctx.host.sheetId(n.sheet)
    if (id === undefined) return E.REF
    sheet = id
  }
  return new Ref(sheet, n.r1, n.c1, n.r2, n.c2)
}

export function evalNode(n: Node, ctx: Ctx): Value {
  switch (n.t) {
    case 'num': return n.v
    case 'str': return n.v
    case 'bool': return n.v
    case 'err': return n.v
    case 'ref': return refValue(n, ctx)
    case 'name': {
      const v = ctx.vars?.get(n.name.toUpperCase())
      if (v !== undefined) return v
      const dn = ctx.host.definedName(n.name, ctx.sheet)
      if (!dn) return E.NAME
      if ((ctx.depth ?? 0) > 50) return E.CIRC
      return evalNode(dn, { ...ctx, depth: (ctx.depth ?? 0) + 1 })
    }
    case 'un': {
      const v = evalNode(n.a, ctx)
      if (n.op === '+') return v
      if (isArrayArg(v)) return elementwise([v], ctx, (x) => arith('-', 0, x[0]))
      return arith('-', 0, scalar(v, ctx))
    }
    case 'pct': {
      const v = evalNode(n.a, ctx)
      return isArrayArg(v) ? elementwise([v], ctx, (x) => arith('/', x[0], 100)) : arith('/', scalar(v, ctx), 100)
    }
    case 'bin': return binary(n.op, evalNode(n.a, ctx), evalNode(n.b, ctx), ctx)
    case 'range': {
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx)
      if (!(a instanceof Ref) || !(b instanceof Ref) || a.sheet !== b.sheet) return E.VALUE
      return new Ref(a.sheet, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2))
    }
    case 'spill': {
      const r = evalNode(n.a, ctx)
      if (!(r instanceof Ref)) return E.REF
      const sp = ctx.host.hasSpill?.(r.sheet, r.r1, r.c1)
      return sp ? new Ref(r.sheet, r.r1, r.c1, r.r1 + sp.rows - 1, r.c1 + sp.cols - 1) : E.REF
    }
    case 'arr': {
      const rows = n.rows.map((row) => row.map((x) => scalar(evalNode(x, ctx), ctx)))
      const w = Math.max(...rows.map((r) => r.length))
      return new Arr(rows.map((r) => [...r, ...Array(w - r.length).fill(E.NA)]))
    }
    case 'call': return callFn(n.name, n.args, ctx)
  }
}

/** Applies a LAMBDA (or a name bound to one) to values. */
export function applyLambda(l: Lambda, args: Value[], ctx: Ctx): Value {
  const vars = new Map(l.closure)
  l.params.forEach((p, i) => vars.set(p.toUpperCase(), args[i] ?? null))
  return evalNode(l.body, { ...ctx, vars, depth: (ctx.depth ?? 0) + 1 })
}

const KEEPS_ERRORS = new Set(['ERROR.TYPE', 'IFERROR', 'IFNA', 'NA', 'TYPE', 'COUNT', 'COUNTA', 'COUNTBLANK', 'ROW', 'COLUMN', 'ROWS', 'COLUMNS', 'ARRAYFORMULA', 'LET'])

export function callFn(name: string, argNodes: (Node | null)[], ctx: Ctx): Value {
  const bound = ctx.vars?.get(name.toUpperCase())
  if (bound instanceof Lambda) {
    try { return applyLambda(bound, argNodes.map((a) => (a ? evalNode(a, ctx) : null)), ctx) } catch (e) { if (e instanceof XlErr) return e; throw e }
  }
  const f = FUNCS.get(name)
  if (!f) return E.NAME
  if (argNodes.length < f.min || argNodes.length > f.max) return E.VALUE
  if (f.volatile) ctx.host.volatile?.()
  try {
    if (f.lazy) return f.lazy(argNodes, ctx)
    const args = argNodes.map((a) => (a ? evalNode(a, ctx) : null))
    // An error passed straight in makes the result that error, except for the functions that exist to look at errors.
    if (!KEEPS_ERRORS.has(f.name) && !f.name.startsWith('IS')) for (const a of args) if (a instanceof XlErr) return a
    if (f.scalar && args.some(isArrayArg)) return elementwise(args, ctx, (xs) => {
      try { const r = f.fn!(xs, ctx); return r instanceof Arr || r instanceof Ref ? scalar(r, ctx) : (r as Scalar) } catch (e) { if (e instanceof XlErr) return e; throw e }
    })
    return f.fn!(args, ctx)
  } catch (e) {
    if (e instanceof XlErr) return e
    throw e
  }
}

/** Evaluates a parsed formula to what a cell shows: a single value, or an array that will spill. */
export function evalFormula(ast: Node, ctx: Ctx): Scalar | Arr {
  let v: Value
  try { v = evalNode(ast, ctx) } catch (e) { if (e instanceof XlErr) return e; throw e }
  return finalize(v, ctx)
}

export function finalize(v: Value, ctx: Ctx): Scalar | Arr {
  if (v instanceof Ref) {
    if (v.single) return ctx.host.cell(v.sheet, v.r1, v.c1)
    return toArr(v, ctx)
  }
  if (v instanceof Lambda) return E.CALC
  if (v instanceof Arr) return v.rows === 1 && v.cols === 1 ? v.a[0][0] : v
  return v
}

export { printNode }
