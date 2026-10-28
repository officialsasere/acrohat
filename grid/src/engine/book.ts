import { parseA1, parseRange } from './address'
import { parseFormula, printNode, walk, type Node } from './ast'
import { evalFormula, FUNCS, type Ctx, type Host } from './eval'
import './functions'
import { StyleTable, newSheet, newWorkbook, type Cell, type CellStyle, type Sheet, type Workbook } from './model'
import { formatValue, type Formatted } from './numfmt'
import { parseInput } from './input'
import { renameSheetInFormula, rewriteFormula, shiftFormula, type StructuralOp } from './refactor'
import { Arr, E, MAX_COLS, MAX_ROWS, XlErr, isErr, key, type Rect, type Scalar } from './types'

const G = 2 ** 35
export const gkey = (sheet: number, r: number, c: number) => sheet * G + key(r, c)

interface FState {
  sheet: number; row: number; col: number
  text: string
  ast: Node | null
  value: Scalar | Arr
  dirty: boolean
  evaluating: boolean
  circular: boolean
  volatile: boolean
  cells: number[]
  ranges: { sheet: number; r1: number; c1: number; r2: number; c2: number }[]
  names: string[]
  spill?: { rows: number; cols: number }
  /** The rectangle an array result wants, even when something blocks it. */
  intent?: Rect
}

interface Parsed { ast: Node | null; error?: string }
type Change = { undo: () => void; redo: () => void }
interface Txn { label: string; changes: Change[] }

export class Book implements Host {
  wb: Workbook
  styles: StyleTable
  /** Bumped on every change; the interface watches it to redraw. */
  version = 0
  /** Bumped when sizes, hidden rows or columns, or merged cells change, so the grid recomputes its layout. */
  layoutVersion = 0
  private listeners = new Set<() => void>()
  private f = new Map<number, FState>()
  private cellDeps = new Map<number, Set<number>>()
  private rangeDeps = new Map<number, { rect: Rect; owner: number }[]>()
  private nameDeps = new Map<string, Set<number>>()
  private spillCells = new Map<number, number>()
  private anchors = new Set<number>()
  private dirty = new Set<number>()
  private changed = new Set<number>()
  private parseCache = new Map<string, Parsed>()
  private sheetsById = new Map<number, Sheet>()
  private usedCache = new Map<number, { rows: number; cols: number }>()
  private undoStack: Txn[] = []
  private redoStack: Txn[] = []
  private txn: Txn | null = null
  private batching = 0
  /** Set while loading a file: nothing is recorded for undo. */
  private silent = 0

  constructor(wb: Workbook = newWorkbook()) {
    this.wb = wb
    this.styles = new StyleTable(wb.styles)
    wb.styles = this.styles.list
    this.rebuild()
  }

  // ------------------------------------------------------------------ plumbing
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private notify() { this.version++; for (const l of this.listeners) l() }
  sheet(id: number): Sheet { return this.sheetsById.get(id)! }
  sheetByName(name: string): Sheet | undefined { return this.wb.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase()) }
  get activeSheet(): Sheet { return this.sheetsById.get(this.wb.active) ?? this.wb.sheets[0] }

  /** Reads every formula in a freshly loaded workbook and works out all values. */
  rebuild() {
    this.f.clear(); this.cellDeps.clear(); this.rangeDeps.clear(); this.nameDeps.clear(); this.spillCells.clear(); this.anchors.clear(); this.dirty.clear(); this.usedCache.clear()
    this.sheetsById = new Map(this.wb.sheets.map((s) => [s.id, s]))
    for (const s of this.wb.sheets) for (const [k, c] of s.cells) if (c.f) this.register(s.id, Math.floor(k / MAX_COLS), k % MAX_COLS, c.f)
    this.layoutVersion++
    this.recalc(true)
    this.notify()
  }

  // ---------------------------------------------------------------- transactions
  /** Groups everything done inside `fn` into one undo step. */
  transaction<T>(label: string, fn: () => T): T {
    if (this.txn) return fn()
    this.txn = { label, changes: [] }
    try {
      return fn()
    } finally {
      const t = this.txn
      this.txn = null
      if (t && t.changes.length && !this.silent) { this.undoStack.push(t); if (this.undoStack.length > 200) this.undoStack.shift(); this.redoStack = [] }
      this.recalc()
      this.notify()
    }
  }
  /** Runs `fn` without recording undo and without recalculating until the end (loading files). */
  load<T>(fn: () => T): T {
    this.silent++
    this.batching++
    try { return fn() } finally { this.batching--; this.silent--; this.recalc(true); this.notify() }
  }
  private rec(undo: () => void, redo: () => void) {
    if (this.silent) return
    if (this.txn) this.txn.changes.push({ undo, redo })
    else { this.undoStack.push({ label: '', changes: [{ undo, redo }] }); this.redoStack = [] }
  }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  undo() {
    const t = this.undoStack.pop()
    if (!t) return
    for (let i = t.changes.length - 1; i >= 0; i--) t.changes[i].undo()
    this.redoStack.push(t)
    this.recalc(); this.notify()
  }
  redo() {
    const t = this.redoStack.pop()
    if (!t) return
    for (const c of t.changes) c.redo()
    this.undoStack.push(t)
    this.recalc(); this.notify()
  }
  /** Records a change to any plain property, so it can be undone. */
  prop<T extends object, K extends keyof T>(obj: T, k: K, v: T[K]) {
    const prev = obj[k]
    if (prev === v) return
    obj[k] = v
    this.rec(() => { obj[k] = prev; this.touch() }, () => { obj[k] = v; this.touch() })
    this.touch()
  }
  mapSet<K, V>(m: Map<K, V>, k: K, v: V | undefined) {
    const had = m.has(k), prev = m.get(k)
    if (v === undefined) m.delete(k); else m.set(k, v)
    const restore = (x: V | undefined, has: boolean) => { if (has) m.set(k, x as V); else m.delete(k); this.touch() }
    this.rec(() => restore(prev, had), () => restore(v, v !== undefined))
    this.touch()
  }
  setAdd<T>(s: Set<T>, v: T, on: boolean) {
    const had = s.has(v)
    if (had === on) return
    if (on) s.add(v); else s.delete(v)
    this.rec(() => { if (had) s.add(v); else s.delete(v); this.touch() }, () => { if (on) s.add(v); else s.delete(v); this.touch() })
    this.touch()
  }
  private touch() { this.usedCache.clear(); this.layoutVersion++ }

  // ---------------------------------------------------------------------- Host
  private overrides = new Map<number, Scalar>()
  /** Works something out as if a cell already held `v` (checking what someone is about to type). */
  withValue<T>(sheet: number, row: number, col: number, v: Scalar, fn: () => T): T {
    const g = gkey(sheet, row, col)
    this.overrides.set(g, v)
    try { return fn() } finally { this.overrides.delete(g) }
  }

  cell(sheet: number, row: number, col: number): Scalar {
    const g = gkey(sheet, row, col)
    if (this.overrides.size && this.overrides.has(g)) return this.overrides.get(g)!
    const st = this.f.get(g)
    if (st) {
      if (st.dirty) { if (st.circular) return E.CIRC; if (st.evaluating) return E.CIRC; this.evalCell(g) }
      const v = st.value
      return v instanceof Arr ? v.a[0]?.[0] ?? null : v
    }
    const s = this.sheetsById.get(sheet)
    const c = s?.cells.get(key(row, col))
    if (c && c.v !== null) return c.v
    const anchor = this.spillCells.get(g)
    if (anchor !== undefined) {
      const a = this.f.get(anchor)!
      if (a.dirty && !a.evaluating && !a.circular) this.evalCell(anchor)
      const v = a.value
      if (v instanceof Arr) {
        const r = row - a.row, k = col - a.col
        return v.a[r]?.[k] ?? null
      }
    }
    return null
  }
  sheetId(name: string) { return this.sheetByName(name)?.id }
  sheetName(id: number) { return this.sheetsById.get(id)?.name ?? '' }
  sheetCount() { return this.wb.sheets.length }
  definedName(name: string, sheet: number): Node | undefined {
    const n = this.wb.names.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.scope === sheet) ?? this.wb.names.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.scope === undefined)
    if (!n) return undefined
    return this.parse(n.ref.startsWith('=') ? n.ref : '=' + n.ref).ast ?? undefined
  }
  usedRange(sheet: number) {
    let u = this.usedCache.get(sheet)
    if (!u) {
      let rows = 0, cols = 0
      for (const [k, c] of this.sheetsById.get(sheet)?.cells ?? []) { if (c.v === null && !c.f) continue; rows = Math.max(rows, Math.floor(k / MAX_COLS) + 1); cols = Math.max(cols, (k % MAX_COLS) + 1) }
      for (const g of this.spillCells.keys()) if (Math.floor(g / G) === sheet) { const k = g % G; rows = Math.max(rows, Math.floor(k / MAX_COLS) + 1); cols = Math.max(cols, (k % MAX_COLS) + 1) }
      u = { rows, cols }
      this.usedCache.set(sheet, u)
    }
    return u
  }
  formulaText(sheet: number, row: number, col: number) { return this.sheetsById.get(sheet)?.cells.get(key(row, col))?.f ?? null }
  now() { return Date.now() }
  hasSpill(sheet: number, row: number, col: number) { return this.f.get(gkey(sheet, row, col))?.spill ?? null }
  volatile() { /* tracked statically from the function table */ }
  rowHidden(sheet: number, row: number) { return this.sheetsById.get(sheet)?.hiddenRows.has(row) ?? false }
  colHidden(sheet: number, col: number) { return this.sheetsById.get(sheet)?.hiddenCols.has(col) ?? false }
  rowFiltered(sheet: number, row: number) { return this.filteredRows(sheet).has(row) }

  // -------------------------------------------------------------- formulas
  private parse(text: string): Parsed {
    let p = this.parseCache.get(text)
    if (!p) {
      try { p = { ast: parseFormula(text) } } catch (e) { p = { ast: null, error: (e as Error).message } }
      if (this.parseCache.size > 20000) this.parseCache.clear()
      this.parseCache.set(text, p)
    }
    return p
  }
  /** Works out a formula without putting it in a cell (conditional formats, data validation, find). */
  evalText(sheet: number, text: string, row = 0, col = 0): Scalar | Arr {
    const ast = this.parse(text.startsWith('=') ? text : '=' + text).ast
    if (!ast) return E.NAME
    try { return evalFormula(ast, { host: this, sheet, row, col }) } catch (e) { return e instanceof XlErr ? e : E.VALUE }
  }
  /** Checks a formula before it is accepted. Returns a message if it cannot be read. */
  checkFormula(text: string): string | null {
    const p = this.parse(text)
    if (p.error) return p.error
    let unknown: string | null = null
    walk(p.ast!, (n) => { if (n.t === 'call' && !FUNCS.has(n.name) && !unknown) unknown = n.name })
    return unknown && !this.letNames(p.ast!).has((unknown as string).toUpperCase()) ? `Unknown function ${unknown}` : null
  }
  private letNames(ast: Node): Set<string> {
    const out = new Set<string>()
    walk(ast, (n) => { if (n.t === 'call' && (n.name === 'LET' || n.name === 'LAMBDA')) for (let i = 0; i < n.args.length - 1; i += n.name === 'LET' ? 2 : 1) { const a = n.args[i]; if (a?.t === 'name') out.add(a.name.toUpperCase()) } })
    return out
  }

  private register(sheet: number, row: number, col: number, text: string) {
    const g = gkey(sheet, row, col)
    this.unregister(g)
    const p = this.parse(text)
    const st: FState = { sheet, row, col, text, ast: p.ast, value: p.ast ? null : E.NAME, dirty: true, evaluating: false, circular: false, volatile: false, cells: [], ranges: [], names: [] }
    this.f.set(g, st)
    if (p.ast) this.collectDeps(st, p.ast, g)
    this.dirty.add(g)
  }
  private collectDeps(st: FState, ast: Node, g: number, seen = new Set<string>()) {
    walk(ast, (n) => {
      if (n.t === 'ref') {
        const sid = n.sheet === undefined ? st.sheet : this.sheetId(n.sheet)
        if (sid === undefined) return
        if (n.kind === 'cell') { st.cells.push(gkey(sid, n.r1, n.c1)); this.addDep(gkey(sid, n.r1, n.c1), g) }
        else { const rect = { r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 }; st.ranges.push({ sheet: sid, ...rect }); this.addRange(sid, rect, g) }
      } else if (n.t === 'call') {
        const def = FUNCS.get(n.name)
        if (def?.volatile) st.volatile = true
      } else if (n.t === 'name') {
        const nm = n.name.toLowerCase()
        if (seen.has(nm)) return
        seen.add(nm)
        const dn = this.wb.names.find((x) => x.name.toLowerCase() === nm)
        if (dn) {
          st.names.push(nm)
          let set = this.nameDeps.get(nm)
          if (!set) this.nameDeps.set(nm, (set = new Set()))
          set.add(g)
          const sub = this.parse(dn.ref.startsWith('=') ? dn.ref : '=' + dn.ref).ast
          if (sub) this.collectDeps(st, sub, g, seen)
        }
      }
    })
  }
  private addDep(dep: number, owner: number) { let s = this.cellDeps.get(dep); if (!s) this.cellDeps.set(dep, (s = new Set())); s.add(owner) }
  private addRange(sheet: number, rect: Rect, owner: number) { let a = this.rangeDeps.get(sheet); if (!a) this.rangeDeps.set(sheet, (a = [])); a.push({ rect, owner }) }
  private unregister(g: number) {
    const st = this.f.get(g)
    if (!st) return
    for (const d of st.cells) this.cellDeps.get(d)?.delete(g)
    for (const r of st.ranges) { const a = this.rangeDeps.get(r.sheet); if (a) { const i = a.findIndex((x) => x.owner === g); if (i >= 0) a.splice(i, 1) } }
    for (const r of st.ranges) { const a = this.rangeDeps.get(r.sheet); if (a) this.rangeDeps.set(r.sheet, a.filter((x) => x.owner !== g)) }
    for (const n of st.names) this.nameDeps.get(n)?.delete(g)
    this.clearSpill(g, st)
    this.anchors.delete(g)
    this.f.delete(g)
    this.dirty.delete(g)
  }
  private clearSpill(g: number, st: FState) {
    if (!st.spill) return
    const changed: number[] = []
    for (let r = 0; r < st.spill.rows; r++) for (let c = 0; c < st.spill.cols; c++) {
      if (!r && !c) continue
      const cg = gkey(st.sheet, st.row + r, st.col + c)
      if (this.spillCells.get(cg) === g) { this.spillCells.delete(cg); changed.push(cg) }
    }
    st.spill = undefined
    for (const cg of changed) this.changed.add(cg)
  }

  // ------------------------------------------------------------ recalculation
  private propagate() {
    const seed = [...this.changed]
    this.changed.clear()
    const visited = new Set<number>()
    const queue = seed
    while (queue.length) {
      const g = queue.pop()!
      if (visited.has(g)) continue
      visited.add(g)
      const owners = this.cellDeps.get(g)
      const next: number[] = []
      if (owners) for (const o of owners) next.push(o)
      const sheet = Math.floor(g / G), k = g % G, r = Math.floor(k / MAX_COLS), c = k % MAX_COLS
      const ranges = this.rangeDeps.get(sheet)
      if (ranges) for (const x of ranges) if (r >= x.rect.r1 && r <= x.rect.r2 && c >= x.rect.c1 && c <= x.rect.c2) next.push(x.owner)
      // Something changed inside the area an array formula wants: it may now fit, or no longer fit.
      for (const a of this.anchors) {
        const st = this.f.get(a)
        if (st?.intent && st.sheet === sheet && r >= st.intent.r1 && r <= st.intent.r2 && c >= st.intent.c1 && c <= st.intent.c2 && a !== g) next.push(a)
      }
      for (const o of next) {
        const st = this.f.get(o)
        if (st && !st.dirty) { st.dirty = true; st.circular = false; this.dirty.add(o) }
        if (st && !visited.has(o)) queue.push(o)
        // An array formula's whole area changes with it.
        if (st?.spill) for (let i = 0; i < st.spill.rows; i++) for (let j = 0; j < st.spill.cols; j++) if (i || j) { const cg = gkey(st.sheet, st.row + i, st.col + j); if (!visited.has(cg)) queue.push(cg) }
      }
    }
  }
  /** Marks every formula that depends on a changed cell, then works out the new values. */
  recalc(all = false) {
    if (this.batching && !all) return
    if (all) for (const [g, st] of this.f) { st.dirty = true; st.circular = false; this.dirty.add(g) }
    for (const [g, st] of this.f) if (st.volatile && !st.dirty) { st.dirty = true; this.dirty.add(g) }
    this.propagate()
    for (let round = 0; round < 12 && (this.dirty.size || this.changed.size); round++) {
      if (this.changed.size) this.propagate()
      const batch = [...this.dirty]
      for (const g of batch) this.evalCell(g)
    }
  }

  private evalCell(g: number) {
    const root = this.f.get(g)
    if (!root || !root.dirty) return
    const stack: { g: number; deps: number[]; i: number }[] = []
    const color = new Map<number, number>([[g, 1]])
    stack.push({ g, deps: this.dirtyDeps(g), i: 0 })
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top.i < top.deps.length) {
        const d = top.deps[top.i++]
        const dst = this.f.get(d)
        if (!dst || !dst.dirty) continue
        const c = color.get(d)
        if (c === 1) { dst.circular = true; continue }
        if (c === 2) continue
        color.set(d, 1)
        stack.push({ g: d, deps: this.dirtyDeps(d), i: 0 })
      } else {
        stack.pop()
        color.set(top.g, 2)
        this.compute(top.g)
      }
    }
  }
  private dirtyDeps(g: number): number[] {
    const st = this.f.get(g)!
    const out: number[] = []
    for (const d of st.cells) {
      if (this.f.get(d)?.dirty) out.push(d)
      else { const a = this.spillCells.get(d); if (a !== undefined && this.f.get(a)?.dirty) out.push(a) }
    }
    for (const r of st.ranges) {
      const area = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1)
      if (area <= 4000) {
        for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) { const d = gkey(r.sheet, i, j); if (this.f.get(d)?.dirty) out.push(d) }
      } else {
        for (const [d, fs] of this.f) if (fs.dirty && fs.sheet === r.sheet && fs.row >= r.r1 && fs.row <= r.r2 && fs.col >= r.c1 && fs.col <= r.c2) out.push(d)
      }
      for (const a of this.anchors) { const fs = this.f.get(a)!; if (fs.dirty && fs.sheet === r.sheet && fs.intent && !(fs.intent.r2 < r.r1 || fs.intent.r1 > r.r2 || fs.intent.c2 < r.c1 || fs.intent.c1 > r.c2)) out.push(a) }
    }
    return out
  }

  private compute(g: number) {
    const st = this.f.get(g)
    if (!st || !st.dirty) return
    st.evaluating = true
    const before = st.value
    let result: Scalar | Arr
    try {
      if (st.circular) result = E.CIRC
      else if (!st.ast) result = E.NAME
      else {
        const ctx: Ctx = { host: this, sheet: st.sheet, row: st.row, col: st.col }
        result = evalFormula(st.ast, ctx)
      }
    } catch (e) {
      result = e instanceof XlErr ? e : E.VALUE
      if (!(e instanceof XlErr)) console.error('Formula error', st.text, e)
    }
    st.evaluating = false
    st.dirty = false
    this.dirty.delete(g)
    // Array results spill into the cells around the formula.
    const oldSpill = st.spill
    if (result instanceof Arr && (result.rows > 1 || result.cols > 1)) {
      const rect = { r1: st.row, c1: st.col, r2: st.row + result.rows - 1, c2: st.col + result.cols - 1 }
      st.intent = rect
      this.anchors.add(g)
      let blocked = rect.r2 >= MAX_ROWS || rect.c2 >= MAX_COLS
      const sheet = this.sheetsById.get(st.sheet)!
      for (let r = rect.r1; r <= rect.r2 && !blocked; r++) for (let c = rect.c1; c <= rect.c2; c++) {
        if (r === st.row && c === st.col) continue
        const cell = sheet.cells.get(key(r, c))
        const owner = this.spillCells.get(gkey(st.sheet, r, c))
        if ((cell && (cell.v !== null || cell.f)) || (owner !== undefined && owner !== g)) { blocked = true; break }
      }
      this.clearSpill(g, st)
      if (blocked) { result = E.SPILL }
      else {
        st.spill = { rows: result.rows, cols: result.cols }
        for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) if (r !== st.row || c !== st.col) { const cg = gkey(st.sheet, r, c); this.spillCells.set(cg, g); this.changed.add(cg) }
      }
    } else {
      if (result instanceof Arr) result = result.a[0]?.[0] ?? null
      this.clearSpill(g, st)
      st.intent = undefined
      this.anchors.delete(g)
    }
    st.value = result
    if (oldSpill || st.spill) this.usedCache.delete(st.sheet)
    void before
  }

  // ------------------------------------------------------------------ reading
  getCell(sheet: number, row: number, col: number): Cell | undefined { return this.sheetsById.get(sheet)?.cells.get(key(row, col)) }
  /** The value a formula cell computed, or the typed value of a plain cell. */
  value(sheet: number, row: number, col: number): Scalar { return this.cell(sheet, row, col) }
  styleOf(sheet: number, row: number, col: number): CellStyle {
    const c = this.sheetsById.get(sheet)?.cells.get(key(row, col))
    return this.styles.get(c?.s ?? 0)
  }
  /** Text as it appears in the grid. */
  display(sheet: number, row: number, col: number): Formatted {
    const v = this.cell(sheet, row, col)
    return formatValue(v, this.styleOf(sheet, row, col).fmt ?? 'General')
  }
  arrayAt(sheet: number, row: number, col: number): { rows: number; cols: number } | null { return this.f.get(gkey(sheet, row, col))?.spill ?? null }
  /** The anchor cell if (row, col) is part of an array formula's result. */
  spillOwner(sheet: number, row: number, col: number): { row: number; col: number } | null {
    const a = this.spillCells.get(gkey(sheet, row, col))
    if (a === undefined) return null
    const st = this.f.get(a)!
    return { row: st.row, col: st.col }
  }

  private filteredCache = new Map<number, { v: number; rows: Set<number> }>()
  /** Rows an active filter hides. */
  filteredRows(sheetId: number): Set<number> {
    const hit = this.filteredCache.get(sheetId)
    if (hit && hit.v === this.version) return hit.rows
    const s = this.sheetsById.get(sheetId)
    const rows = new Set<number>()
    const flt = s?.filter
    if (s && flt) {
      for (let r = flt.range.r1 + 1; r <= flt.range.r2; r++) {
        for (const [col, fc] of Object.entries(flt.cols)) {
          const v = this.cell(sheetId, r, Number(col))
          if (!filterPasses(v, fc, formatValue(v, this.styleOf(sheetId, r, Number(col)).fmt ?? 'General').text)) { rows.add(r); break }
        }
      }
    }
    this.filteredCache.set(sheetId, { v: this.version, rows })
    return rows
  }

  // ------------------------------------------------------------------ writing
  /** The primitive every cell change goes through. */
  setCellRaw(sheet: number, row: number, col: number, next: Cell | undefined) {
    const s = this.sheetsById.get(sheet)
    if (!s) return
    const k = key(row, col)
    const prev = s.cells.get(k)
    if (prev === next) return
    const apply = (c: Cell | undefined) => {
      if (c) s.cells.set(k, c); else s.cells.delete(k)
      const g = gkey(sheet, row, col)
      if (c?.f) this.register(sheet, row, col, c.f); else this.unregister(g)
      this.changed.add(g)
      this.usedCache.delete(sheet)
      if (row >= s.rows) s.rows = Math.min(MAX_ROWS, row + 1)
      if (col >= s.cols) s.cols = Math.min(MAX_COLS, col + 1)
    }
    apply(next)
    this.rec(() => { apply(prev); }, () => { apply(next) })
  }

  /** Types something into a cell the way a person would: formulas, numbers, dates, text. */
  setInput(sheet: number, row: number, col: number, text: string) {
    this.transaction('Edit cell', () => {
      const prev = this.getCell(sheet, row, col)
      const p = parseInput(text)
      let s = prev?.s ?? 0
      const style = this.styles.get(s)
      if (p.fmt && (!style.fmt || style.fmt === 'General')) s = this.styles.patch(s, { fmt: p.fmt })
      // Plain text typed into a text-formatted cell stays text.
      if (style.fmt === '@' && !p.formula) { this.put(sheet, row, col, { v: text, s, link: prev?.link, note: prev?.note }); return }
      if (p.formula) this.put(sheet, row, col, { v: null, f: p.formula, s, link: prev?.link, note: prev?.note })
      else if (p.value === null && !prev?.link && !prev?.note && s === 0) this.setCellRaw(sheet, row, col, undefined)
      else this.put(sheet, row, col, { v: p.value, s, link: prev?.link, note: prev?.note })
    })
  }
  private put(sheet: number, row: number, col: number, c: Cell) {
    this.setCellRaw(sheet, row, col, c.v === null && !c.f && c.s === 0 && !c.link && !c.note ? undefined : c)
  }
  /** Sets just the value (no parsing), keeping style. */
  setValue(sheet: number, row: number, col: number, v: Scalar, f?: string) {
    const prev = this.getCell(sheet, row, col)
    this.put(sheet, row, col, { v: f ? null : v, f, s: prev?.s ?? 0, link: prev?.link, note: prev?.note })
  }
  patchCell(sheet: number, row: number, col: number, patch: Partial<Cell>) {
    const prev = this.getCell(sheet, row, col)
    this.put(sheet, row, col, { v: null, s: 0, ...prev, ...patch })
  }
  /** Changes the look of every cell in the rectangles. */
  setStyle(sheet: number, rects: Rect[], patch: CellStyle, label = 'Format') {
    this.transaction(label, () => {
      for (const r of rects) this.eachStyled(sheet, r, (row, col, cell) => {
        const next = { v: null, ...cell, s: this.styles.patch(cell?.s ?? 0, patch) } as Cell
        this.put(sheet, row, col, next)
      })
    })
  }
  /** Visits each cell of a rectangle; for huge selections (whole columns) only the cells that exist or the used area. */
  eachStyled(sheet: number, r: Rect, f: (row: number, col: number, cell: Cell | undefined) => void) {
    const s = this.sheetsById.get(sheet)!
    const area = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1)
    if (area > 200_000) {
      // Whole rows or columns: style the cells that exist and a sensible visible area.
      const rows = Math.min(r.r2, Math.max(s.rows - 1, 0)), cols = Math.min(r.c2, Math.max(s.cols - 1, 0))
      for (let i = r.r1; i <= rows; i++) for (let j = r.c1; j <= cols; j++) f(i, j, s.cells.get(key(i, j)))
      return
    }
    for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) f(i, j, s.cells.get(key(i, j)))
  }
  clear(sheet: number, rects: Rect[], what: 'all' | 'contents' | 'formats' = 'contents') {
    this.transaction('Clear', () => {
      const s = this.sheetsById.get(sheet)!
      for (const r of rects) {
        const cells = [...s.cells.entries()].filter(([k]) => { const i = Math.floor(k / MAX_COLS), j = k % MAX_COLS; return i >= r.r1 && i <= r.r2 && j >= r.c1 && j <= r.c2 })
        for (const [k, c] of cells) {
          const i = Math.floor(k / MAX_COLS), j = k % MAX_COLS
          if (what === 'all') this.setCellRaw(sheet, i, j, undefined)
          else if (what === 'contents') this.put(sheet, i, j, { v: null, s: c.s })
          else this.put(sheet, i, j, { ...c, s: 0 })
        }
      }
    })
  }

  // ------------------------------------------------------------------ structure
  addSheet(name?: string, at?: number): Sheet {
    return this.transaction('Add sheet', () => {
      const id = this.wb.nextSheetId++
      let nm = name ?? `Sheet${this.wb.sheets.length + 1}`
      for (let i = 2; this.sheetByName(nm); i++) nm = `${name ?? 'Sheet'}${i}`
      const sh = newSheet(id, nm)
      const idx = at ?? this.wb.sheets.length
      const prevActive = this.wb.active
      const apply = () => { this.wb.sheets.splice(idx, 0, sh); this.sheetsById.set(id, sh); this.wb.active = id }
      const undo = () => { this.wb.sheets.splice(this.wb.sheets.indexOf(sh), 1); this.sheetsById.delete(id); this.wb.active = prevActive }
      apply()
      this.rec(undo, apply)
      return sh
    })
  }
  removeSheet(id: number) {
    if (this.wb.sheets.length <= 1) return
    this.transaction('Delete sheet', () => {
      const sh = this.sheet(id), idx = this.wb.sheets.indexOf(sh), prevActive = this.wb.active
      const saved = [...sh.cells.entries()]
      const apply = () => {
        for (const [k] of sh.cells) this.unregister(sh.id * G + k)
        this.wb.sheets.splice(this.wb.sheets.indexOf(sh), 1); this.sheetsById.delete(id)
        if (this.wb.active === id) this.wb.active = this.wb.sheets[Math.max(0, idx - 1)].id
        // Formulas that pointed here now show #REF!
        this.rebuildRefs()
      }
      const undo = () => {
        this.wb.sheets.splice(idx, 0, sh); this.sheetsById.set(id, sh); this.wb.active = prevActive
        for (const [k, c] of saved) if (c.f) this.register(id, Math.floor(k / MAX_COLS), k % MAX_COLS, c.f)
        this.rebuildRefs()
      }
      apply()
      this.rec(undo, apply)
    })
  }
  /** After sheets come and go, every formula's dependency list must be read again. */
  private rebuildRefs() {
    for (const s of this.wb.sheets) for (const [k, c] of s.cells) if (c.f) this.register(s.id, Math.floor(k / MAX_COLS), k % MAX_COLS, c.f)
    for (const [g, st] of [...this.f]) if (!this.sheetsById.has(st.sheet)) this.unregister(g)
    for (const k of this.f.keys()) this.changed.add(k)
    this.usedCache.clear()
  }
  renameSheet(id: number, name: string): boolean {
    const t = name.trim()
    if (!t || t.length > 100 || /[\\/?*[\]:]/.test(t)) return false
    const other = this.sheetByName(t)
    if (other && other.id !== id) return false
    const sh = this.sheet(id), old = sh.name
    if (old === t) return true
    this.transaction('Rename sheet', () => {
      const apply = (from: string, to: string) => {
        sh.name = to
        for (const s of this.wb.sheets) for (const [k, c] of s.cells) if (c.f && c.f.includes(from) || (c?.f && /!/.test(c.f))) {
          const nf = renameSheetInFormula(c.f!, from, to)
          if (nf !== c.f) { c.f = nf; this.register(s.id, Math.floor(k / MAX_COLS), k % MAX_COLS, nf) }
        }
        for (const n of this.wb.names) n.ref = renameSheetInFormula('=' + n.ref, from, to).slice(1)
        for (const s of this.wb.sheets) for (const ch of s.charts) ch.range = renameSheetInFormula('=' + ch.range, from, to).slice(1)
        this.rebuildRefs()
      }
      apply(old, t)
      this.rec(() => apply(t, old), () => apply(old, t))
    })
    return true
  }
  moveSheet(id: number, to: number) {
    this.transaction('Move sheet', () => {
      const sh = this.sheet(id), from = this.wb.sheets.indexOf(sh)
      if (from === to || to < 0 || to >= this.wb.sheets.length) return
      const apply = (a: number, b: number) => { this.wb.sheets.splice(b, 0, this.wb.sheets.splice(a, 1)[0]) }
      apply(from, to)
      this.rec(() => apply(to, from), () => apply(from, to))
    })
  }
  duplicateSheet(id: number): Sheet {
    return this.transaction('Duplicate sheet', () => {
      const src = this.sheet(id)
      const copy = this.addSheet(`Copy of ${src.name}`, this.wb.sheets.indexOf(src) + 1)
      for (const [k, c] of src.cells) this.setCellRaw(copy.id, Math.floor(k / MAX_COLS), k % MAX_COLS, { ...c, f: c.f ? c.f : undefined })
      for (const k of ['colW', 'rowH'] as const) for (const [i, v] of src[k]) copy[k].set(i, v)
      copy.merges = src.merges.map((m) => ({ ...m })); copy.frozenRows = src.frozenRows; copy.frozenCols = src.frozenCols
      copy.hiddenCols = new Set(src.hiddenCols); copy.hiddenRows = new Set(src.hiddenRows); copy.cf = structuredClone(src.cf); copy.validations = structuredClone(src.validations)
      copy.tabColor = src.tabColor; copy.gridlines = src.gridlines; copy.rows = src.rows; copy.cols = src.cols
      return copy
    })
  }
  setActive(id: number) { if (this.sheetsById.has(id) && this.wb.active !== id) { this.wb.active = id; this.notify() } }

  /** Inserts or deletes whole rows or columns, moving cells and rewriting every formula that points at them. */
  structural(sheetId: number, op: StructuralOp) {
    this.transaction(op.kind === 'insert' ? 'Insert' : 'Delete', () => {
      const sh = this.sheet(sheetId)
      const before = { cells: new Map(sh.cells), colW: new Map(sh.colW), rowH: new Map(sh.rowH), hr: new Set(sh.hiddenRows), hc: new Set(sh.hiddenCols), merges: sh.merges, rows: sh.rows, cols: sh.cols, fr: sh.frozenRows, fc: sh.frozenCols, cf: sh.cf, val: sh.validations, filter: sh.filter, charts: sh.charts }
      // Formulas elsewhere that change: remember to undo.
      const touched: { sheet: number; k: number; old: string }[] = []
      const moveIdx = (i: number) => (op.kind === 'insert' ? (i >= op.at ? i + op.count : i) : i < op.at ? i : i >= op.at + op.count ? i - op.count : -1)
      const next = new Map<number, Cell>()
      for (const [k, c] of sh.cells) {
        let r = Math.floor(k / MAX_COLS), cc = k % MAX_COLS
        if (op.axis === 'row') r = moveIdx(r); else cc = moveIdx(cc)
        if (r < 0 || cc < 0) continue
        next.set(key(r, cc), c)
      }
      const remap = <V,>(m: Map<number, V>) => { const n = new Map<number, V>(); for (const [i, v] of m) { const j = moveIdx(i); if (j >= 0) n.set(j, v) } return n }
      const remapSet = (s: Set<number>) => { const n = new Set<number>(); for (const i of s) { const j = moveIdx(i); if (j >= 0) n.add(j) } return n }
      const rect = (r: Rect): Rect | null => {
        const a = op.axis === 'row' ? [r.r1, r.r2] : [r.c1, r.c2]
        const lo = op.kind === 'insert' ? (a[0] >= op.at ? a[0] + op.count : a[0]) : a[0] < op.at ? a[0] : a[0] >= op.at + op.count ? a[0] - op.count : op.at
        const hi = op.kind === 'insert' ? (a[1] >= op.at ? a[1] + op.count : a[1]) : a[1] < op.at ? a[1] : a[1] >= op.at + op.count ? a[1] - op.count : op.at - 1
        if (hi < lo) return null
        return op.axis === 'row' ? { ...r, r1: lo, r2: hi } : { ...r, c1: lo, c2: hi }
      }
      sh.cells = next
      if (op.axis === 'row') { sh.rowH = remap(sh.rowH); sh.hiddenRows = remapSet(sh.hiddenRows); sh.rows = Math.max(sh.rows + (op.kind === 'insert' ? op.count : 0), 1) }
      else { sh.colW = remap(sh.colW); sh.hiddenCols = remapSet(sh.hiddenCols); sh.cols = Math.max(sh.cols + (op.kind === 'insert' ? op.count : 0), 1) }
      sh.merges = sh.merges.map(rect).filter((x): x is Rect => !!x && (x.r1 !== x.r2 || x.c1 !== x.c2))
      sh.cf = sh.cf.map((c) => ({ ...c, ranges: c.ranges.map(rect).filter((x): x is Rect => !!x) })).filter((c) => c.ranges.length)
      sh.validations = sh.validations.map((c) => ({ ...c, ranges: c.ranges.map(rect).filter((x): x is Rect => !!x) })).filter((c) => c.ranges.length)
      if (sh.filter) { const fr = rect(sh.filter.range); sh.filter = fr ? { ...sh.filter, range: fr } : undefined }
      if (op.axis === 'row' && op.kind === 'insert' && op.at < sh.frozenRows) sh.frozenRows += op.count
      if (op.axis === 'col' && op.kind === 'insert' && op.at < sh.frozenCols) sh.frozenCols += op.count
      // Every formula in the workbook that mentions this sheet.
      for (const s of this.wb.sheets) for (const [k, c] of s.cells) {
        if (!c.f) continue
        const nf = rewriteFormula(c.f, s.name, sh.name, op)
        if (nf !== c.f) { touched.push({ sheet: s.id, k, old: c.f }); s.cells.set(k, { ...c, f: nf }) }
      }
      for (const n of this.wb.names) n.ref = rewriteFormula('=' + n.ref, sh.name, sh.name, op).slice(1)
      this.rebuildRefs()
      const after = { cells: sh.cells, colW: sh.colW, rowH: sh.rowH, hr: sh.hiddenRows, hc: sh.hiddenCols, merges: sh.merges, rows: sh.rows, cols: sh.cols, fr: sh.frozenRows, fc: sh.frozenCols, cf: sh.cf, val: sh.validations, filter: sh.filter, charts: sh.charts }
      const afterFormulas = touched.map((t) => ({ ...t, nw: this.sheet(t.sheet).cells.get(t.k)?.f ?? '' }))
      const set = (st: typeof before) => { sh.cells = st.cells; sh.colW = st.colW; sh.rowH = st.rowH; sh.hiddenRows = st.hr; sh.hiddenCols = st.hc; sh.merges = st.merges; sh.rows = st.rows; sh.cols = st.cols; sh.frozenRows = st.fr; sh.frozenCols = st.fc; sh.cf = st.cf; sh.validations = st.val; sh.filter = st.filter }
      this.rec(
        () => { set(before); for (const t of afterFormulas) { const c = this.sheet(t.sheet).cells.get(t.k); if (c) c.f = t.old }; this.rebuildRefs() },
        () => { set(after); for (const t of afterFormulas) { const c = this.sheet(t.sheet).cells.get(t.k); if (c) c.f = t.nw }; this.rebuildRefs() },
      )
    })
  }

  /** Sets a size without recording it (used while a column edge is being dragged); the final size is recorded separately. */
  rawSize(sheet: number, axis: 'col' | 'row', i: number, size: number | undefined) {
    const s = this.sheetsById.get(sheet)!
    const m = axis === 'col' ? s.colW : s.rowH
    if (size === undefined) m.delete(i); else m.set(i, size)
    this.layoutVersion++
    this.notify()
  }

  // -------------------------------------------------------------------- misc
  /** Copies cells (values, formulas, styles) so they can be pasted: formulas move with the offset. */
  readBlock(sheet: number, r: Rect): (Cell | undefined)[][] {
    const out: (Cell | undefined)[][] = []
    const s = this.sheetsById.get(sheet)!
    for (let i = r.r1; i <= r.r2; i++) { const row: (Cell | undefined)[] = []; for (let j = r.c1; j <= r.c2; j++) { const c = s.cells.get(key(i, j)); row.push(c ? { ...c, v: c.f ? this.cell(sheet, i, j) : c.v } : undefined) } out.push(row) }
    return out
  }
  /** Writes a block (values and/or formulas and/or formats) with its top-left at (row, col). */
  writeBlock(sheet: number, row: number, col: number, block: (Cell | undefined)[][], from: { row: number; col: number }, what: { values: boolean; formats: boolean; formulas: boolean } = { values: true, formats: true, formulas: true }) {
    for (let i = 0; i < block.length; i++) for (let j = 0; j < block[i].length; j++) {
      const src = block[i][j]
      const r = row + i, c = col + j
      if (r >= MAX_ROWS || c >= MAX_COLS) continue
      const prev = this.getCell(sheet, r, c)
      const f = src?.f && what.formulas ? shiftFormula(src.f, r - (from.row + i), c - (from.col + j)) : undefined
      const next: Cell = {
        v: what.values ? (f ? null : src?.v ?? null) : prev?.f ? null : prev?.v ?? null,
        f: what.values ? f : prev?.f,
        s: what.formats ? src?.s ?? 0 : prev?.s ?? 0,
        link: what.values ? src?.link : prev?.link, note: what.values ? src?.note : prev?.note,
      }
      if (!what.values && !what.formats) continue
      this.put(sheet, r, c, next)
    }
  }
  /** Names of functions, for autocomplete. */
  static functionNames(): string[] { return [...FUNCS.keys()].sort() }

  addrToRef(text: string): { sheet: number; rect: Rect } | null {
    const p = parseRange(text)
    if (!p) { const n = this.wb.names.find((x) => x.name.toLowerCase() === text.trim().toLowerCase()); return n ? this.addrToRef(n.ref) : null }
    const sh = p.sheet ? this.sheetByName(p.sheet) : this.activeSheet
    return sh ? { sheet: sh.id, rect: { r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 } } : null
  }
  parseCell(text: string) { return parseA1(text) }
  print(ast: Node) { return printNode(ast) }
}

/** Does a value pass one column's filter? */
export function filterPasses(v: Scalar, fc: { hide?: string[]; cond?: { op: string; v1: string; v2?: string } }, shown: string): boolean {
  if (fc.hide && fc.hide.includes(shown)) return false
  const c = fc.cond
  if (!c) return true
  const num = (s: string) => Number(s)
  const t = (typeof v === 'string' ? v : shown).toLowerCase()
  const n = typeof v === 'number' ? v : NaN
  switch (c.op) {
    case 'empty': return v === null || v === ''
    case 'notEmpty': return !(v === null || v === '')
    case 'contains': return t.includes(c.v1.toLowerCase())
    case 'notContains': return !t.includes(c.v1.toLowerCase())
    case 'begins': return t.startsWith(c.v1.toLowerCase())
    case 'ends': return t.endsWith(c.v1.toLowerCase())
    case '=': return isNaN(num(c.v1)) ? t === c.v1.toLowerCase() : n === num(c.v1)
    case '<>': return isNaN(num(c.v1)) ? t !== c.v1.toLowerCase() : n !== num(c.v1)
    case '>': return n > num(c.v1)
    case '>=': return n >= num(c.v1)
    case '<': return n < num(c.v1)
    case '<=': return n <= num(c.v1)
    case 'between': return n >= num(c.v1) && n <= num(c.v2 ?? c.v1)
    case 'notBetween': return n < num(c.v1) || n > num(c.v2 ?? c.v1)
    default: return true
  }
}
export { isErr }
