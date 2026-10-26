import type { FontSpec } from './edit'

/** Unicode coverage of a TrueType font, read from its cmap table (formats 4 and 12). */
export function coverage(ttf: Uint8Array): (cp: number) => boolean {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
  const numTables = v.getUint16(4)
  let cmapOff = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    const tag = String.fromCharCode(ttf[rec], ttf[rec + 1], ttf[rec + 2], ttf[rec + 3])
    if (tag === 'cmap') cmapOff = v.getUint32(rec + 8)
  }
  if (cmapOff < 0) return () => false

  const ranges: [number, number][] = []
  const n = v.getUint16(cmapOff + 2)
  for (let i = 0; i < n; i++) {
    const platform = v.getUint16(cmapOff + 4 + i * 8)
    const encoding = v.getUint16(cmapOff + 6 + i * 8)
    const off = cmapOff + v.getUint32(cmapOff + 8 + i * 8)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    const format = v.getUint16(off)
    if (format === 4) {
      const segX2 = v.getUint16(off + 6)
      const ends = off + 14
      const starts = ends + segX2 + 2
      const deltas = starts + segX2
      const rangeOffs = deltas + segX2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(ends + s * 2)
        const start = v.getUint16(starts + s * 2)
        if (start === 0xffff) continue
        const ro = v.getUint16(rangeOffs + s * 2)
        const delta = v.getInt16(deltas + s * 2)
        if (ro === 0) {
          // Glyph 0 (.notdef) means "missing"; with delta mapping a code maps to (cp + delta) & 0xffff.
          let runStart = -1
          for (let cp = start; cp <= end; cp++) {
            const ok = ((cp + delta) & 0xffff) !== 0
            if (ok && runStart < 0) runStart = cp
            if (!ok && runStart >= 0) {
              ranges.push([runStart, cp - 1])
              runStart = -1
            }
          }
          if (runStart >= 0) ranges.push([runStart, end])
        } else {
          for (let cp = start; cp <= end; cp++) {
            const g = v.getUint16(rangeOffs + s * 2 + ro + (cp - start) * 2)
            if (g !== 0) ranges.push([cp, cp])
          }
        }
      }
    } else if (format === 12) {
      const groups = v.getUint32(off + 12)
      for (let g = 0; g < groups; g++) {
        const base = off + 16 + g * 12
        ranges.push([v.getUint32(base), v.getUint32(base + 4)])
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  return (cp) => {
    let lo = 0
    let hi = ranges.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [a, b] = ranges[mid]
      if (cp < a) hi = mid - 1
      else if (cp > b) lo = mid + 1
      else return true
    }
    return false
  }
}

/** Font files to try, best stylistic match first. All are bundled under /fonts and freely licensed. */
export function candidates(spec: FontSpec): string[] {
  const style = spec.bold && spec.italic ? 'BoldItalic' : spec.bold ? 'Bold' : spec.italic ? 'Italic' : 'Regular'
  const dejavuSans = spec.bold && spec.italic ? 'DejaVuSans-BoldOblique' : spec.bold ? 'DejaVuSans-Bold' : spec.italic ? 'DejaVuSans-Oblique' : 'DejaVuSans'
  return [`Liberation${spec.family}-${style}.ttf`, `${dejavuSans}.ttf`]
}

export interface ChosenFont {
  file: string
  data: Uint8Array
}

/** Picks the first candidate font that has every character; reports characters nobody can draw. */
export async function chooseFont(
  spec: FontSpec,
  text: string,
  load: (file: string) => Promise<Uint8Array>,
): Promise<{ font?: ChosenFont; missing: string[] }> {
  const chars = [...new Set([...text].filter((c) => c !== '\n'))]
  let best: { font: ChosenFont; missing: string[] } | undefined
  for (const file of candidates(spec)) {
    const data = await load(file)
    const has = coverage(data)
    const missing = chars.filter((c) => c.trim() !== '' && !has(c.codePointAt(0)!))
    if (!missing.length) return { font: { file, data }, missing: [] }
    if (!best || missing.length < best.missing.length) best = { font: { file, data }, missing }
  }
  return { missing: best?.missing ?? chars }
}
