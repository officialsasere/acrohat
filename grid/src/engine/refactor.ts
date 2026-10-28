import { mapNodes, parseFormula, printNode, type Node, type RefNode } from './ast'
import { MAX_COLS, MAX_ROWS, XlErr } from './types'

/** Moves the relative references of a formula, as when it is copied or filled to another cell. */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula
  try {
    return '=' + printNode(parseFormula(formula), { shift: { dr, dc } })
  } catch {
    return formula
  }
}

export interface StructuralOp { axis: 'row' | 'col'; kind: 'insert' | 'delete'; at: number; count: number }

function adjust(lo: number, hi: number, op: StructuralOp): [number, number] | null {
  const { at, count } = op
  if (op.kind === 'insert') return [lo >= at ? lo + count : lo, hi >= at ? hi + count : hi]
  const nlo = lo < at ? lo : lo >= at + count ? lo - count : at
  const nhi = hi < at ? hi : hi >= at + count ? hi - count : at - 1
  return nhi < nlo ? null : [nlo, nhi]
}

/** Rewrites a reference after rows or columns were inserted or deleted. Returns null if the whole reference was deleted. */
export function adjustRef(n: RefNode, op: StructuralOp): RefNode | null {
  if (op.axis === 'row') {
    if (n.kind === 'cols') return n
    const r = adjust(n.r1, n.r2, op)
    return r ? { ...n, r1: r[0], r2: Math.min(r[1], MAX_ROWS - 1) } : null
  }
  if (n.kind === 'rows') return n
  const c = adjust(n.c1, n.c2, op)
  return c ? { ...n, c1: c[0], c2: Math.min(c[1], MAX_COLS - 1) } : null
}

/**
 * Rewrites every reference in a formula that points at sheet `target`.
 * `ownerSheet` is the sheet the formula lives on (references without a sheet name point there).
 */
export function rewriteFormula(formula: string, ownerSheet: string, target: string, op: StructuralOp): string {
  let ast: Node
  try { ast = parseFormula(formula) } catch { return formula }
  const out = mapNodes(ast, (n) => {
    if (n.t !== 'ref') return undefined
    const sheet = n.sheet ?? ownerSheet
    if (sheet.toLowerCase() !== target.toLowerCase()) return n
    return adjustRef(n, op) ?? { t: 'err', v: new XlErr('#REF!') }
  })
  return '=' + printNode(out)
}

/** Renames a sheet inside a formula. */
export function renameSheetInFormula(formula: string, from: string, to: string): string {
  let ast: Node
  try { ast = parseFormula(formula) } catch { return formula }
  const out = mapNodes(ast, (n) => (n.t === 'ref' && n.sheet && n.sheet.toLowerCase() === from.toLowerCase() ? { ...n, sheet: to } : undefined))
  return '=' + printNode(out)
}
