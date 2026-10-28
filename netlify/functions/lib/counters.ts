/**
 * Anonymous counters for the Kwiiva website: how many times each app was downloaded from the site, and how many
 * times it was launched. Pure logic, so it can be tested without Netlify; `stats.mts` plugs in the real storage.
 */
export interface Day { opens: number; devices: number }
export interface Stats {
  downloads: number
  byFile: Record<string, number>
  opens: number
  /** Devices that launched the app for the first time (a count, never a list). */
  devices: number
  daily: Record<string, Day>
}

export const emptyStats = (): Stats => ({ downloads: 0, byFile: {}, opens: 0, devices: 0, daily: {} })

/** The apps and the installers the site offers. A download or launch for anything else is ignored. */
export const PRODUCTS: Record<string, { tag: string; files: string[] }> = {
  paper: {
    tag: 'paper-latest',
    files: ['KwiivaPaper-Windows-Setup.exe', 'KwiivaPaper-Windows.msi', 'KwiivaPaper-macOS-AppleSilicon.dmg', 'KwiivaPaper-macOS-Intel.dmg', 'KwiivaPaper-Linux.AppImage', 'KwiivaPaper-Linux.deb'],
  },
  write: {
    tag: 'write-latest',
    files: ['KwiivaWrite-Windows-Setup.exe', 'KwiivaWrite-Windows.msi', 'KwiivaWrite-macOS-AppleSilicon.dmg', 'KwiivaWrite-macOS-Intel.dmg', 'KwiivaWrite-Linux.AppImage', 'KwiivaWrite-Linux.deb'],
  },
  grid: {
    tag: 'grid-latest',
    files: ['KwiivaGrid-Windows-Setup.exe', 'KwiivaGrid-Windows.msi', 'KwiivaGrid-macOS-AppleSilicon.dmg', 'KwiivaGrid-macOS-Intel.dmg', 'KwiivaGrid-Linux.AppImage', 'KwiivaGrid-Linux.deb'],
  },
}
export const REPO = { owner: 'officialsasere', name: 'kwiiva' }

/** A key-value store that can refuse a write if someone else changed the value first (an ETag check). */
export interface KV {
  read(key: string): Promise<{ value: Stats | null; etag?: string }>
  /** Resolves false if the value changed since `etag` (or, with no etag, if it already exists). */
  write(key: string, value: Stats, etag?: string): Promise<boolean>
}

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10)

/** Reads, changes and writes a product's counters, retrying when two requests collide, so no count is lost. */
export async function update(kv: KV, product: string, change: (s: Stats) => void, attempts = 12): Promise<Stats> {
  for (let i = 0; i < attempts; i++) {
    const { value, etag } = await kv.read(product)
    const s = value ?? emptyStats()
    change(s)
    // Keep about three months of daily numbers.
    const days = Object.keys(s.daily).sort()
    for (const d of days.slice(0, Math.max(0, days.length - 90))) delete s.daily[d]
    if (await kv.write(product, s, etag)) return s
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 40 * (i + 1)))
  }
  throw new Error('counter busy')
}

export const recordDownload = (kv: KV, product: string, file: string) =>
  update(kv, product, (s) => { s.downloads++; s.byFile[file] = (s.byFile[file] ?? 0) + 1 })

export const recordLaunch = (kv: KV, product: string, first: boolean, now = new Date()) =>
  update(kv, product, (s) => {
    const d = (s.daily[dayKey(now)] ??= { opens: 0, devices: 0 })
    s.opens++; d.opens++
    if (first) { s.devices++; d.devices++ }
  })

export interface PublicStats { downloads: number; opens: number; devices: number; opens30: number }
export function publicStats(s: Stats | null, now = new Date()): PublicStats {
  if (!s) return { downloads: 0, opens: 0, devices: 0, opens30: 0 }
  const since = dayKey(new Date(now.getTime() - 30 * 86400_000))
  const opens30 = Object.entries(s.daily).filter(([d]) => d >= since).reduce((n, [, v]) => n + v.opens, 0)
  return { downloads: s.downloads, opens: s.opens, devices: s.devices, opens30 }
}

export function validLaunch(body: unknown): { product: string; first: boolean } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.product !== 'string' || !(b.product in PRODUCTS)) return null
  return { product: b.product, first: b.first === true }
}
