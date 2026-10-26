import type { DRect, } from './space'

export interface DocInfo {
  pageCount: number
  sizes: { width: number; height: number }[]
  rev: number
  canUndo: boolean
  canRedo: boolean
}

/** A text block as the UI sees it, in device points (top-left origin). */
export interface BlockInfo {
  id: string
  text: string
  rect: DRect
  fontSize: number
  fontName: string
  lines: number
  color: [number, number, number, number]
}

/** A fillable form field, with widget rectangles in device points. */
export interface FieldInfo {
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list'
  widgets: { page: number; rect: DRect; option?: string }[]
  value: string | boolean
  options: string[]
  multiline: boolean
  readOnly: boolean
  maxLength?: number
}

export interface ImageInfo {
  index: number
  rect: DRect
  transformed: boolean
}
