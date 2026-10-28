/** The values a spreadsheet cell can hold, and the errors it can show. */
export type ErrCode = '#NULL!' | '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A' | '#SPILL!' | '#CALC!' | '#CIRC!'

export class XlErr {
  constructor(public readonly code: ErrCode, public readonly detail?: string) {}
  toString() { return this.code }
}
export const E = {
  NULL: new XlErr('#NULL!'), DIV0: new XlErr('#DIV/0!'), VALUE: new XlErr('#VALUE!'), REF: new XlErr('#REF!'),
  NAME: new XlErr('#NAME?'), NUM: new XlErr('#NUM!'), NA: new XlErr('#N/A'), SPILL: new XlErr('#SPILL!'), CALC: new XlErr('#CALC!'), CIRC: new XlErr('#CIRC!'),
}
export const isErr = (v: unknown): v is XlErr => v instanceof XlErr

/** null is an empty cell. */
export type Scalar = number | string | boolean | null | XlErr

/** A rectangle of values (rows of columns), the result of array formulas and the contents of ranges. */
export class Arr {
  constructor(public readonly a: Scalar[][]) {}
  get rows() { return this.a.length }
  get cols() { return this.a[0]?.length ?? 0 }
  static of(rows: number, cols: number, f: (r: number, c: number) => Scalar) {
    return new Arr(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => f(r, c))))
  }
}

/** A reference to cells on a sheet. All indexes are 0-based; r2/c2 are inclusive. */
export class Ref {
  constructor(public readonly sheet: number, public readonly r1: number, public readonly c1: number, public readonly r2: number, public readonly c2: number) {}
  get rows() { return this.r2 - this.r1 + 1 }
  get cols() { return this.c2 - this.c1 + 1 }
  get single() { return this.r1 === this.r2 && this.c1 === this.c2 }
}

export type Value = Scalar | Arr | Ref

export const MAX_ROWS = 1_048_576
export const MAX_COLS = 16_384
/** Cell key: unique number per row/column pair. */
export const key = (r: number, c: number) => r * MAX_COLS + c
export const keyRow = (k: number) => Math.floor(k / MAX_COLS)
export const keyCol = (k: number) => k % MAX_COLS

export interface Rect { r1: number; c1: number; r2: number; c2: number }
