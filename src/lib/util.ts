export type RGBA = [number, number, number, number]

export function hexToRgba(hex: string, alpha = 255): RGBA {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]
}

export function rgbaToCss(c: RGBA): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] / 255})`
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

export function fontFamilyFor(name: string): string {
  const n = name.toLowerCase()
  if (/courier|mono|consolas/.test(n)) return '"Liberation Mono", ui-monospace, monospace'
  if (/times|serif|georgia|garamond|palatino|minion/.test(n) && !/sans/.test(n)) return '"Liberation Serif", Georgia, serif'
  return '"Liberation Sans", Arial, Helvetica, sans-serif'
}

export function normRect(a: [number, number], b: [number, number]) {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }
}
