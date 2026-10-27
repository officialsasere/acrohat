/** Paragraph defaults shared by the page styles, the file readers and the file writers. */
export const DEFAULT_LINE_HEIGHT = 1.15
export const DEFAULT_SPACE_AFTER = 8 // pt
export const DEFAULT_SPACE_BEFORE = 0 // pt
export const INDENT_STEP = 36 // pt: one press of "increase indent"

/** Sizes (pt) of built-in styles, so the same numbers draw the page and fill the saved file. */
export const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 16, 3: 14, 4: 12, 5: 11, 6: 11 }
export const TITLE_SIZE = 26
export const SUBTITLE_SIZE = 15
