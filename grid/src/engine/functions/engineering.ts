import { E, type Value } from '../types'
import { def, int, num, str } from '../eval'

const opt = (v: Value | undefined | null) => v === undefined || v === null

// ---- number bases
function parseBase(s: string, base: number, maxLen = 10): number {
  const t = s.trim().toUpperCase()
  if (!t || t.length > maxLen || [...t].some((ch) => isNaN(parseInt(ch, 36)) || parseInt(ch, 36) >= base)) throw E.NUM
  const v = parseInt(t, base)
  const bits = Math.log2(base) * maxLen
  return v >= 2 ** (bits - 1) && t.length === maxLen ? v - 2 ** bits : v
}
function toBase(n: number, base: number, places: Value | undefined | null, c: Parameters<typeof int>[1], maxLen = 10): string {
  n = Math.trunc(n)
  const bits = Math.log2(base) * maxLen
  if (n < -(2 ** (bits - 1)) || n >= 2 ** (bits - 1)) throw E.NUM
  const v = n < 0 ? n + 2 ** bits : n
  let t = v.toString(base).toUpperCase()
  if (!opt(places)) { const p = int(places!, c); if (n >= 0) { if (p < t.length || p > 10) throw E.NUM; t = t.padStart(p, '0') } }
  return t
}
const bases: [string, number][] = [['BIN', 2], ['OCT', 8], ['DEC', 10], ['HEX', 16]]
for (const [fromName, fromBase] of bases) for (const [toName, tb] of bases) {
  if (fromName === toName) continue
  const maxLen = (fromName === 'DEC' ? 10 : 10)
  def(`${fromName}2${toName}`, 1, 2, ([a, p], c) => {
    const v = fromName === 'DEC' ? Math.trunc(num(a, c)) : parseBase(str(a, c), fromBase, maxLen)
    if (toName === 'DEC') return v
    return toBase(v, tb, p, c)
  }, { scalar: true })
}
def('DELTA', 1, 2, ([a, b], c) => (num(a, c) === (opt(b) ? 0 : num(b, c)) ? 1 : 0), { scalar: true })
def('GESTEP', 1, 2, ([a, b], c) => (num(a, c) >= (opt(b) ? 0 : num(b, c)) ? 1 : 0), { scalar: true })

// ---- units
const U: Record<string, Record<string, number>> = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852, ang: 1e-10, um: 1e-6, ly: 9.4607304725808e15, pica: 0.0254 / 6 },
  mass: { g: 1, kg: 1000, mg: 0.001, lbm: 453.59237, oz: 28.349523125, ozm: 28.349523125, stone: 6350.29318, ton: 907184.74, sg: 14593.9029, u: 1.66053906660e-24 },
  time: { s: 1, sec: 1, mn: 60, min: 60, hr: 3600, day: 86400, d: 86400, yr: 31557600, ms: 0.001 },
  pressure: { pa: 1, atm: 101325, mmhg: 133.322368, torr: 133.322368, psi: 6894.757293168, bar: 100000, kpa: 1000 },
  force: { n: 1, dyn: 1e-5, lbf: 4.4482216152605, pond: 0.00980665 },
  energy: { j: 1, kj: 1000, e: 1e-7, cal: 4.184, c: 4.1868, ev: 1.602176634e-19, hph: 2684519.537696172792, wh: 3600, kwh: 3600000, btu: 1055.05585262, flb: 1.3558179483314004 },
  power: { w: 1, kw: 1000, hp: 745.69987158227022, ps: 735.49875 },
  speed: { 'm/s': 1, 'm/h': 1 / 3600, 'km/h': 1 / 3.6, mph: 0.44704, kn: 1852 / 3600, mach: 340.2933 },
  volume: { l: 0.001, lt: 0.001, ml: 1e-6, m3: 1, tsp: 4.92892159375e-6, tbs: 1.478676478125e-5, oz: 2.95735295625e-5, cup: 2.365882365e-4, pt: 4.73176473e-4, qt: 9.46352946e-4, gal: 3.785411784e-3, 'ft3': 0.028316846592, 'in3': 1.6387064e-5, 'cm3': 1e-6, 'mm3': 1e-9 },
  area: { 'm2': 1, 'cm2': 1e-4, 'mm2': 1e-6, 'km2': 1e6, 'in2': 6.4516e-4, 'ft2': 0.09290304, 'yd2': 0.83612736, 'mi2': 2589988.110336, ha: 10000, ar: 100, acre: 4046.8564224 },
  information: { bit: 1, byte: 8 },
}
const PREFIX: Record<string, number> = { Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 10, d: 0.1, c: 0.01, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 }
function unit(u: string): { kind: string; f: number } | null {
  for (const [kind, t] of Object.entries(U)) if (t[u] !== undefined) return { kind, f: t[u] }
  for (const [p, m] of Object.entries(PREFIX)) if (u.startsWith(p)) for (const [kind, t] of Object.entries(U)) if (t[u.slice(p.length)] !== undefined && ['length', 'mass', 'time', 'pressure', 'force', 'energy', 'power', 'volume'].includes(kind) && u.slice(p.length).length <= 3) return { kind, f: t[u.slice(p.length)] * m }
  return null
}
const TEMP = ['C', 'cel', 'F', 'fah', 'K', 'kel']
def('CONVERT', 3, 3, ([a, f, t], c) => {
  const x = num(a, c), from = str(f, c), to = str(t, c)
  if (TEMP.includes(from) && TEMP.includes(to)) {
    const k = /^(C|cel)$/.test(from) ? x + 273.15 : /^(F|fah)$/.test(from) ? ((x - 32) * 5) / 9 + 273.15 : x
    return /^(C|cel)$/.test(to) ? k - 273.15 : /^(F|fah)$/.test(to) ? ((k - 273.15) * 9) / 5 + 32 : k
  }
  const A = unit(from), B = unit(to)
  if (!A || !B || A.kind !== B.kind) throw E.NA
  return (x * A.f) / B.f
}, { scalar: true })
