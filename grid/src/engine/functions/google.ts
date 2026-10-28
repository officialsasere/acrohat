/** Functions that draw something in the cell (SPARKLINE) or run a mini query (QUERY). */
import { toNumber } from '../coerce'
import { E, isErr, type Scalar } from '../types'
import { def, flat, str } from '../eval'

/** A marker string the grid recognises and draws as a tiny chart. */
export const SPARK = '\u0000spark:'
def('SPARKLINE', 1, 2, ([d, o], c) => {
  const data = flat(d, c).map((x) => (typeof x === 'number' ? x : null))
  const options: Record<string, string> = {}
  if (o) {
    const cells = flat(o, c)
    if (cells.length && Array.isArray(cells)) {
      // Options arrive as an array of {"name","value"} pairs: {"charttype","column";"color","red"}
      const w = (o as { cols?: number }).cols ?? 2
      for (let i = 0; i + 1 < cells.length; i += w) options[String(cells[i]).toLowerCase()] = String(cells[i + 1])
    }
  }
  return SPARK + JSON.stringify({ data, ...options })
})
export type { Scalar }
export { E, isErr, str, toNumber }
