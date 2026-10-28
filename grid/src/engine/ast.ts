import { colIndex, colName, quoteSheet } from './address'
import { E, MAX_COLS, MAX_ROWS, XlErr, type ErrCode } from './types'

export interface RefNode {
  t: 'ref'
  sheet?: string
  /** 0-based, inclusive. Whole-column references have r1 = 0, r2 = MAX_ROWS - 1; whole-row, c1 = 0, c2 = MAX_COLS - 1. */
  r1: number; c1: number; r2: number; c2: number
  absR1: boolean; absC1: boolean; absR2: boolean; absC2: boolean
  kind: 'cell' | 'range' | 'cols' | 'rows'
}
export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: XlErr }
  | RefNode
  | { t: 'name'; name: string }
  | { t: 'un'; op: '-' | '+'; a: Node }
  | { t: 'pct'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: (Node | null)[] }
  | { t: 'arr'; rows: Node[][] }
  | { t: 'range'; a: Node; b: Node }
  | { t: 'spill'; a: Node }

export class ParseError extends Error {}

const ERRORS: ErrCode[] = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#CIRC!']
const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!`
const RE = {
  ws: /\s+/y,
  num: /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y,
  str: /"(?:[^"]|"")*"/y,
  err: new RegExp(`(${ERRORS.map((e) => e.replace(/[.*+?^${}()|[\]\\!]/g, '\\$&')).join('|')})|#REF!`, 'iy'),
  cellRange: new RegExp(String.raw`(${SHEET})?(\$?[A-Za-z]{1,3}\$?\d{1,7})(?::(\$?[A-Za-z]{1,3}\$?\d{1,7}))?(?![\w(.])`, 'y'),
  colRange: new RegExp(String.raw`(${SHEET})?(\$?[A-Za-z]{1,3}):(\$?[A-Za-z]{1,3})(?![\w(.])`, 'y'),
  rowRange: new RegExp(String.raw`(${SHEET})?(\$?\d{1,7}):(\$?\d{1,7})(?![\w(.])`, 'y'),
  ident: /[A-Za-z_À-￿\\][\w.À-￿]*/y,
  op: /<>|<=|>=|[-+*/^&=<>%(),;:{}]/y,
}

type Tok = { k: 'num' | 'str' | 'err' | 'ref' | 'name' | 'fn' | 'op' | 'end'; s: string; v?: unknown; pos: number; spill?: boolean }

function unquoteSheet(s: string): string {
  s = s.slice(0, -1)
  return s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s
}

function cellPart(s: string) {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(s)!
  return { col: colIndex(m[2]), row: parseInt(m[4], 10) - 1, absC: m[1] === '$', absR: m[3] === '$' }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const at = (re: RegExp) => { re.lastIndex = i; return re.exec(src) }
  while (i < src.length) {
    let m: RegExpExecArray | null
    if ((m = at(RE.ws))) { i += m[0].length; continue }
    const pos = i
    if (src[i] === '"') {
      if (!(m = at(RE.str))) throw new ParseError('Unterminated text')
      out.push({ k: 'str', s: m[0], v: m[0].slice(1, -1).replace(/""/g, '"'), pos }); i += m[0].length; continue
    }
    if (src[i] === '#' && (m = at(RE.err))) { out.push({ k: 'err', s: m[0], v: m[0].toUpperCase(), pos }); i += m[0].length; continue }
    // References come before numbers so "1:3" is a row range and "A1" is not a name.
    if ((m = at(RE.colRange)) || (m = at(RE.rowRange)) || (m = at(RE.cellRange))) {
      const next = src[i + m[0].length]
      // "LOG10(" and "A1(" are function calls, not cells.
      if (next !== '(') {
        const tok: Tok = { k: 'ref', s: m[0], v: m, pos }
        i += m[0].length
        // "A1#" means everything an array formula in A1 spilled into.
        if (src[i] === '#' && !/^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|CIRC!)/i.test(src.slice(i))) { tok.spill = true; i++ }
        out.push(tok)
        continue
      }
    }
    if ((m = at(RE.num))) { out.push({ k: 'num', s: m[0], v: parseFloat(m[0]), pos }); i += m[0].length; continue }
    if (src[i] === "'") {
      // 'Sheet name'!A1 where the cell part is a name or a function: only whole references are supported.
      throw new ParseError('Bad sheet reference')
    }
    if ((m = at(RE.ident))) {
      const next = src[i + m[0].length]
      out.push({ k: next === '(' ? 'fn' : 'name', s: m[0], pos }); i += m[0].length; continue
    }
    if ((m = at(RE.op))) { out.push({ k: 'op', s: m[0], pos }); i += m[0].length; continue }
    throw new ParseError(`Unexpected "${src[i]}"`)
  }
  out.push({ k: 'end', s: '', pos: src.length })
  return out
}

function refFromMatch(m: RegExpExecArray): RefNode {
  const sheet = m[1] ? unquoteSheet(m[1]) : undefined
  // colRange: groups (sheet, A, B). rowRange: (sheet, 1, 3). cellRange: (sheet, A1, B2?)
  const a = m[2], b = m[3]
  if (/^\$?[A-Za-z]{1,3}$/.test(a) && b !== undefined) {
    const c1 = colIndex(a.replace('$', '')), c2 = colIndex(b.replace('$', ''))
    return { t: 'ref', sheet, r1: 0, r2: MAX_ROWS - 1, c1: Math.min(c1, c2), c2: Math.max(c1, c2), absR1: true, absR2: true, absC1: a.startsWith('$'), absC2: b.startsWith('$'), kind: 'cols' }
  }
  if (/^\$?\d+$/.test(a) && b !== undefined) {
    const r1 = parseInt(a.replace('$', ''), 10) - 1, r2 = parseInt(b.replace('$', ''), 10) - 1
    return { t: 'ref', sheet, r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: 0, c2: MAX_COLS - 1, absR1: a.startsWith('$'), absR2: b.startsWith('$'), absC1: true, absC2: true, kind: 'rows' }
  }
  const p = cellPart(a)
  if (p.col >= MAX_COLS || p.row >= MAX_ROWS) throw new ParseError('Reference out of range')
  if (b === undefined) return { t: 'ref', sheet, r1: p.row, c1: p.col, r2: p.row, c2: p.col, absR1: p.absR, absC1: p.absC, absR2: p.absR, absC2: p.absC, kind: 'cell' }
  const q = cellPart(b)
  if (q.col >= MAX_COLS || q.row >= MAX_ROWS) throw new ParseError('Reference out of range')
  return {
    t: 'ref', sheet, r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col),
    absR1: p.row <= q.row ? p.absR : q.absR, absR2: p.row <= q.row ? q.absR : p.absR, absC1: p.col <= q.col ? p.absC : q.absC, absC2: p.col <= q.col ? q.absC : p.absC, kind: 'range',
  }
}

const BIN: Record<string, [number, boolean]> = {
  '=': [10, false], '<>': [10, false], '<': [10, false], '>': [10, false], '<=': [10, false], '>=': [10, false],
  '&': [20, false], '+': [30, false], '-': [30, false], '*': [40, false], '/': [40, false], '^': [50, false],
}

export function parseFormula(src: string): Node {
  if (src.startsWith('=')) src = src.slice(1)
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const isOp = (s: string) => peek().k === 'op' && peek().s === s

  function expr(min: number): Node {
    let left = prefix()
    for (;;) {
      const t = peek()
      if (t.k !== 'op') break
      if (t.s === '%') { next(); left = { t: 'pct', a: left }; continue }
      if (t.s === ':') {
        next()
        left = { t: 'range', a: left, b: prefix() }
        continue
      }
      const info = BIN[t.s]
      if (!info || info[0] < min) break
      next()
      const right = expr(t.s === '^' ? info[0] + 1 : info[0] + 1)
      left = { t: 'bin', op: t.s, a: left, b: right }
    }
    // A1# : the spilled range of an array formula (the tokenizer cannot see "#" after a reference).
    return left
  }

  function prefix(): Node {
    const t = next()
    switch (t.k) {
      case 'num': return { t: 'num', v: t.v as number }
      case 'str': return { t: 'str', v: t.v as string }
      case 'err': return { t: 'err', v: new XlErr(t.v as ErrCode) }
      case 'ref': {
        const n = refFromMatch(t.v as RegExpExecArray)
        return t.spill ? { t: 'spill', a: n } : n
      }
      case 'name': {
        const up = t.s.toUpperCase()
        if (up === 'TRUE') return { t: 'bool', v: true }
        if (up === 'FALSE') return { t: 'bool', v: false }
        return { t: 'name', name: t.s }
      }
      case 'fn': {
        next() // (
        const args: (Node | null)[] = []
        if (isOp(')')) { next(); return { t: 'call', name: cleanName(t.s), args } }
        for (;;) {
          if (isOp(',') || isOp(')')) args.push(null); else args.push(expr(0))
          if (isOp(',')) { next(); continue }
          if (isOp(')')) { next(); break }
          throw new ParseError(`Expected "," or ")" near "${peek().s}"`)
        }
        return { t: 'call', name: cleanName(t.s), args }
      }
      case 'op':
        if (t.s === '-' || t.s === '+') return { t: 'un', op: t.s, a: expr(60) }
        if (t.s === '(') {
          const e = expr(0)
          if (!isOp(')')) throw new ParseError('Missing ")"')
          next()
          return e
        }
        if (t.s === '{') {
          const rows: Node[][] = [[]]
          for (;;) {
            rows[rows.length - 1].push(expr(0))
            if (isOp(',')) { next(); continue }
            if (isOp(';')) { next(); rows.push([]); continue }
            if (isOp('}')) { next(); break }
            throw new ParseError('Bad array constant')
          }
          return { t: 'arr', rows }
        }
        throw new ParseError(`Unexpected "${t.s}"`)
      default:
        throw new ParseError('Formula ended too soon')
    }
  }

  const n = expr(0)
  if (peek().k !== 'end') throw new ParseError(`Unexpected "${peek().s}"`)
  return n
}

const cleanName = (n: string) => n.replace(/^_xl(?:fn|ws)\./i, '').replace(/^_xlfn\./i, '').toUpperCase()

// ---------------------------------------------------------------- printing

export interface PrintOpts {
  /** Move relative references by this much (copy/paste, fill). */
  shift?: { dr: number; dc: number }
  /** Text for references on the sheet with this name when the formula moves to another sheet. */
  sheetOf?: (name: string | undefined) => string | undefined
}

function printCell(r: number, c: number, absR: boolean, absC: boolean) {
  return `${absC ? '$' : ''}${colName(c)}${absR ? '$' : ''}${r + 1}`
}

export function printRef(n: RefNode, o: PrintOpts = {}): string {
  const dr = o.shift?.dr ?? 0, dc = o.shift?.dc ?? 0
  const mv = (v: number, abs: boolean, d: number) => (abs ? v : v + d)
  const r1 = mv(n.r1, n.absR1, dr), r2 = mv(n.r2, n.absR2, dr), c1 = mv(n.c1, n.absC1, dc), c2 = mv(n.c2, n.absC2, dc)
  const sheet = n.sheet ? quoteSheet(n.sheet) + '!' : ''
  if (n.kind === 'cols') {
    if (c1 < 0 || c2 >= MAX_COLS || c1 > c2) return '#REF!'
    return `${sheet}${n.absC1 ? '$' : ''}${colName(c1)}:${n.absC2 ? '$' : ''}${colName(c2)}`
  }
  if (n.kind === 'rows') {
    if (r1 < 0 || r2 >= MAX_ROWS) return '#REF!'
    return `${sheet}${n.absR1 ? '$' : ''}${r1 + 1}:${n.absR2 ? '$' : ''}${r2 + 1}`
  }
  if (r1 < 0 || c1 < 0 || r2 >= MAX_ROWS || c2 >= MAX_COLS) return '#REF!'
  const a = printCell(r1, c1, n.absR1, n.absC1)
  return n.kind === 'cell' ? sheet + a : `${sheet}${a}:${printCell(r2, c2, n.absR2, n.absC2)}`
}

export function printNode(n: Node, o: PrintOpts = {}, parentPrec = 0): string {
  switch (n.t) {
    case 'num': return String(n.v)
    case 'str': return `"${n.v.replace(/"/g, '""')}"`
    case 'bool': return n.v ? 'TRUE' : 'FALSE'
    case 'err': return n.v.code
    case 'ref': return printRef(n, o)
    case 'name': return n.name
    case 'pct': return printNode(n.a, o, 70) + '%'
    case 'un': return n.op + printNode(n.a, o, 60)
    case 'range': return `${printNode(n.a, o, 80)}:${printNode(n.b, o, 80)}`
    case 'spill': return printNode(n.a, o) + '#'
    case 'call': return `${n.name}(${n.args.map((a) => (a ? printNode(a, o) : '')).join(',')})`
    case 'arr': return `{${n.rows.map((r) => r.map((x) => printNode(x, o)).join(',')).join(';')}}`
    case 'bin': {
      const p = BIN[n.op][0]
      const s = `${printNode(n.a, o, p)}${n.op}${printNode(n.b, o, p + 1)}`
      return p < parentPrec ? `(${s})` : s
    }
  }
}

/** Walks the tree, calling f on every node. */
export function walk(n: Node, f: (n: Node) => void) {
  f(n)
  switch (n.t) {
    case 'un': case 'pct': case 'spill': walk(n.a, f); break
    case 'bin': case 'range': walk(n.a, f); walk(n.b, f); break
    case 'call': for (const a of n.args) if (a) walk(a, f); break
    case 'arr': for (const r of n.rows) for (const x of r) walk(x, f); break
  }
}

/** Rebuilds the tree, letting `f` replace any node (return undefined to keep it). */
export function mapNodes(n: Node, f: (n: Node) => Node | undefined): Node {
  const r = f(n)
  if (r) return r
  switch (n.t) {
    case 'un': return { ...n, a: mapNodes(n.a, f) }
    case 'pct': case 'spill': return { ...n, a: mapNodes(n.a, f) }
    case 'bin': case 'range': return { ...n, a: mapNodes(n.a, f), b: mapNodes(n.b, f) }
    case 'call': return { ...n, args: n.args.map((a) => (a ? mapNodes(a, f) : null)) }
    case 'arr': return { ...n, rows: n.rows.map((row) => row.map((x) => mapNodes(x, f))) }
    default: return n
  }
}

export const REF_ERROR: Node = { t: 'err', v: E.REF }
