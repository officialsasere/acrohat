/**
 * Builds a small, valid ICC v2 sRGB display profile (matrix/TRC type) so PDF/A files can declare their
 * colours without bundling a third-party profile. Primaries are sRGB's, adapted to the D50 profile
 * connection space; the tone curve is the sRGB transfer function sampled at 1024 points.
 */

const s15 = (v: number) => Math.round(v * 65536)

function xyzTag(x: number, y: number, z: number): Uint8Array {
  const b = new Uint8Array(20)
  const dv = new DataView(b.buffer)
  b.set([0x58, 0x59, 0x5a, 0x20]) // 'XYZ '
  dv.setInt32(8, s15(x))
  dv.setInt32(12, s15(y))
  dv.setInt32(16, s15(z))
  return b
}

function curveTag(): Uint8Array {
  const n = 1024
  const b = new Uint8Array(12 + n * 2)
  const dv = new DataView(b.buffer)
  b.set([0x63, 0x75, 0x72, 0x76]) // 'curv'
  dv.setUint32(8, n)
  for (let i = 0; i < n; i++) {
    const c = i / (n - 1)
    const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    dv.setUint16(12 + i * 2, Math.round(lin * 65535))
  }
  return b
}

function textTag(s: string): Uint8Array {
  const b = new Uint8Array(8 + s.length + 1)
  b.set([0x74, 0x65, 0x78, 0x74]) // 'text'
  for (let i = 0; i < s.length; i++) b[8 + i] = s.charCodeAt(i)
  return b
}

function descTag(s: string): Uint8Array {
  // v2 'desc': ASCII count (incl. NUL), ASCII string, then empty Unicode and ScriptCode parts.
  const n = s.length + 1
  const b = new Uint8Array(12 + n + 4 + 4 + 2 + 1 + 67)
  const dv = new DataView(b.buffer)
  b.set([0x64, 0x65, 0x73, 0x63]) // 'desc'
  dv.setUint32(8, n)
  for (let i = 0; i < s.length; i++) b[12 + i] = s.charCodeAt(i)
  return b
}

export function srgbIccProfile(): Uint8Array {
  const trc = curveTag()
  const tags: [string, Uint8Array][] = [
    ['desc', descTag('sRGB IEC61966-2.1 (Kwiiva Paper)')],
    ['cprt', textTag('Public domain')],
    ['wtpt', xyzTag(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyzTag(0.4360, 0.2225, 0.0139)],
    ['gXYZ', xyzTag(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyzTag(0.1431, 0.0606, 0.7141)],
    ['rTRC', trc],
    ['gTRC', trc],
    ['bTRC', trc],
  ]
  const pad4 = (n: number) => (n + 3) & ~3
  const tableSize = 4 + tags.length * 12
  let offset = 128 + tableSize
  const placed = new Map<Uint8Array, number>()
  const layout = tags.map(([sig, data]) => {
    let off = placed.get(data)
    if (off === undefined) {
      off = offset
      placed.set(data, off)
      offset += pad4(data.length)
    }
    return { sig, data, off }
  })
  const out = new Uint8Array(offset)
  const dv = new DataView(out.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)))
  dv.setUint32(0, offset) // profile size
  dv.setUint32(8, 0x02100000) // version 2.1.0
  ascii(12, 'mntr')
  ascii(16, 'RGB ')
  ascii(20, 'XYZ ')
  dv.setUint16(24, 2026)
  dv.setUint16(26, 1)
  dv.setUint16(28, 1)
  ascii(36, 'acsp')
  dv.setInt32(68, s15(0.9642)) // PCS illuminant D50
  dv.setInt32(72, s15(1.0))
  dv.setInt32(76, s15(0.8249))
  dv.setUint32(128, tags.length)
  layout.forEach(({ sig, data, off }, i) => {
    const at = 132 + i * 12
    ascii(at, sig)
    dv.setUint32(at + 4, off)
    dv.setUint32(at + 8, data.length)
    if (!out.subarray(off, off + 4).some(Boolean)) out.set(data, off)
  })
  return out
}
