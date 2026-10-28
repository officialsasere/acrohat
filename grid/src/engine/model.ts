import type { Rect, Scalar } from './types'

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'
export interface Border { style: BorderStyle; color: string }

/** How a cell looks. Every field is optional: missing means "the default". */
export interface CellStyle {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean
  color?: string; bg?: string; size?: number; font?: string
  h?: 'left' | 'center' | 'right' | 'justify'
  v?: 'top' | 'middle' | 'bottom'
  wrap?: boolean | 'clip' | 'overflow'
  fmt?: string
  indent?: number
  rotate?: number
  bt?: Border; br?: Border; bb?: Border; bl?: Border
  /** false = unlocked, editable even when the sheet is protected. */
  locked?: boolean
}

export interface Cell {
  /** The typed value, or null for a formula cell (its result lives in the engine). */
  v: Scalar
  f?: string
  s: number
  link?: string
  note?: string
}

export interface CfColor { type: 'min' | 'max' | 'num' | 'percent' | 'percentile'; value?: number; color: string }
export interface CfRule {
  id: string
  ranges: Rect[]
  type:
    | 'cell' | 'text' | 'blanks' | 'noblanks' | 'errors' | 'noerrors' | 'duplicates' | 'unique'
    | 'top' | 'above' | 'date' | 'formula' | 'scale' | 'bar'
  op?: string // cell: > < >= <= = <> between notBetween; text: contains notContains begins ends; top: top|bottom; date: today|yesterday|tomorrow|thisweek|lastweek|thismonth|lastmonth|thisyear
  v1?: string
  v2?: string
  /** top/bottom N, as a count or a percent. */
  n?: number
  percent?: boolean
  formula?: string
  style?: CellStyle
  scale?: { min: CfColor; mid?: CfColor; max: CfColor }
  bar?: { color: string; negative?: string; gradient?: boolean }
  stop?: boolean
}

export interface Validation {
  id: string
  ranges: Rect[]
  type: 'list' | 'listRange' | 'number' | 'integer' | 'date' | 'textLength' | 'text' | 'custom' | 'checkbox'
  op?: 'between' | 'notBetween' | '=' | '<>' | '>' | '<' | '>=' | '<='
  v1?: string
  v2?: string
  list?: string[]
  allowBlank?: boolean
  dropdown?: boolean
  onInvalid?: 'stop' | 'warning'
  help?: string
  checked?: string
  unchecked?: string
}

export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'combo' | 'histogram' | 'radar'
export interface Chart {
  id: string
  kind: ChartKind
  /** Source data, e.g. "Sheet1!A1:D10". */
  range: string
  /** First row holds series names / first column holds categories. */
  headerRow: boolean
  headerCol: boolean
  byRows: boolean
  title: string
  xTitle: string
  yTitle: string
  legend: 'none' | 'top' | 'bottom' | 'right' | 'left'
  stacked: boolean
  percent: boolean
  smooth: boolean
  points: boolean
  colors?: string[]
  gridlines: boolean
  /** Position and size on the sheet, in pixels from the top-left cell A1. */
  x: number; y: number; w: number; h: number
}

export interface FilterCol {
  /** Values that are hidden. */
  hide?: string[]
  /** Or a condition. */
  cond?: { op: string; v1: string; v2?: string }
}
export interface Filter { range: Rect; cols: Record<number, FilterCol> }

export interface Picture { id: string; src: string; x: number; y: number; w: number; h: number; alt?: string }

export interface Sheet {
  id: number
  name: string
  cells: Map<number, Cell>
  colW: Map<number, number>
  rowH: Map<number, number>
  hiddenCols: Set<number>
  hiddenRows: Set<number>
  frozenRows: number
  frozenCols: number
  merges: Rect[]
  rows: number
  cols: number
  tabColor?: string
  gridlines: boolean
  cf: CfRule[]
  validations: Validation[]
  filter?: Filter
  charts: Chart[]
  pictures: Picture[]
  protected?: boolean
  hidden?: boolean
  defaultColW: number
  defaultRowH: number
  /** Row heights worked out from wrapped text; never saved. */
  autoH?: Map<number, number>
}

export interface DefinedName { name: string; ref: string; /** Sheet id if local to a sheet. */ scope?: number }

export interface Workbook {
  sheets: Sheet[]
  styles: CellStyle[]
  names: DefinedName[]
  nextSheetId: number
  active: number
  title: string
}

export const DEFAULT_COL_W = 100
export const DEFAULT_ROW_H = 22
export const DEFAULT_ROWS = 1000
export const DEFAULT_COLS = 26

export function newSheet(id: number, name: string): Sheet {
  return {
    id, name, cells: new Map(), colW: new Map(), rowH: new Map(), hiddenCols: new Set(), hiddenRows: new Set(),
    frozenRows: 0, frozenCols: 0, merges: [], rows: DEFAULT_ROWS, cols: DEFAULT_COLS, gridlines: true, cf: [], validations: [], charts: [], pictures: [],
    defaultColW: DEFAULT_COL_W, defaultRowH: DEFAULT_ROW_H,
  }
}

export function newWorkbook(title = 'Untitled spreadsheet'): Workbook {
  return { sheets: [newSheet(1, 'Sheet1')], styles: [{}], names: [], nextSheetId: 2, active: 1, title }
}

const styleKey = (s: CellStyle) => JSON.stringify(Object.entries(s).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))

export class StyleTable {
  private index = new Map<string, number>()
  constructor(public list: CellStyle[]) { list.forEach((s, i) => this.index.set(styleKey(s), i)) }
  /** The number to store in a cell for this exact look. */
  intern(s: CellStyle): number {
    const clean: CellStyle = {}
    for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== false && v !== '' || (k === 'locked' && v === false)) (clean as Record<string, unknown>)[k] = v
    const key = styleKey(clean)
    let i = this.index.get(key)
    if (i === undefined) { i = this.list.length; this.list.push(clean); this.index.set(key, i) }
    return i
  }
  get(i: number): CellStyle { return this.list[i] ?? this.list[0] }
  /** A style with some properties changed. */
  patch(i: number, p: CellStyle): number { return this.intern({ ...this.get(i), ...p }) }
}
