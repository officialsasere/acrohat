/**
 * Fonts. A document stores the font NAME a person chose ("Calibri"), and the page draws it with a stack that
 * falls back to a bundled, same-width font (Carlito, Caladea, Liberation). So a file looks and wraps the same
 * on a computer that has no such font, and the name survives when the file is saved as .docx.
 */
export interface FontDef {
  name: string
  stack: string
}

const SANS = '"Liberation Sans", Arial, Helvetica, sans-serif'
const SERIF = '"Liberation Serif", "Times New Roman", Times, serif'
const MONO = '"Liberation Mono", "Courier New", Courier, monospace'

export const FONTS: FontDef[] = [
  { name: 'Calibri', stack: 'Calibri, Carlito, "Liberation Sans", sans-serif' },
  { name: 'Cambria', stack: 'Cambria, Caladea, "Liberation Serif", serif' },
  { name: 'Arial', stack: `Arial, ${SANS}` },
  { name: 'Helvetica', stack: `Helvetica, Arial, ${SANS}` },
  { name: 'Verdana', stack: `Verdana, "DejaVu Sans", ${SANS}` },
  { name: 'Tahoma', stack: `Tahoma, "DejaVu Sans", ${SANS}` },
  { name: 'Trebuchet MS', stack: `"Trebuchet MS", ${SANS}` },
  { name: 'Times New Roman', stack: `"Times New Roman", ${SERIF}` },
  { name: 'Georgia', stack: `Georgia, ${SERIF}` },
  { name: 'Garamond', stack: `Garamond, ${SERIF}` },
  { name: 'Palatino Linotype', stack: `"Palatino Linotype", Palatino, ${SERIF}` },
  { name: 'Courier New', stack: `"Courier New", ${MONO}` },
  { name: 'Consolas', stack: `Consolas, "DejaVu Sans Mono", ${MONO}` },
  { name: 'Liberation Sans', stack: SANS },
  { name: 'Liberation Serif', stack: SERIF },
  { name: 'Liberation Mono', stack: MONO },
]

export const DEFAULT_FONT = 'Calibri'
export const DEFAULT_SIZE = 11 // pt

const byName = new Map(FONTS.map((f) => [f.name.toLowerCase(), f]))

/** CSS font-family for a font name; unknown names keep themselves first and fall back to a sans-serif. */
export function fontStack(name: string): string {
  const hit = byName.get(name.toLowerCase())
  if (hit) return hit.stack
  const generic = /mono|courier|consolas/i.test(name) ? MONO : /serif|times|georgia|garamond|palatino|book|cambria|minion/i.test(name) && !/sans/i.test(name) ? SERIF : SANS
  return `"${name.replace(/"/g, '')}", ${generic}`
}

/** The first family of a CSS stack, without quotes: what we write to a .docx. */
export function fontNameOf(css: string | null | undefined): string | null {
  if (!css) return null
  const first = css.split(',')[0].trim().replace(/^["']|["']$/g, '')
  return first || null
}
