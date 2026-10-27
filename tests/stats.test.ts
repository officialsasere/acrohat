import { describe, expect, it } from 'vitest'
import { PRODUCTS, publicStats, recordDownload, recordLaunch, validLaunch, type KV, type Stats } from '../netlify/functions/lib/counters'

/** An in-memory store with the same compare-and-swap behaviour as Netlify Blobs, plus a delay so requests overlap. */
function memoryKv(): KV & { data: Map<string, { v: Stats; n: number }> } {
  const data = new Map<string, { v: Stats; n: number }>()
  return {
    data,
    async read(key) {
      await new Promise((r) => setTimeout(r, Math.random() * 3))
      const e = data.get(key)
      return e ? { value: structuredClone(e.v), etag: String(e.n) } : { value: null }
    },
    async write(key, value, etag) {
      await new Promise((r) => setTimeout(r, Math.random() * 3))
      const e = data.get(key)
      if (etag === undefined ? e : !e || String(e.n) !== etag) return false
      data.set(key, { v: structuredClone(value), n: (e?.n ?? 0) + 1 })
      return true
    },
  }
}

describe('counters', () => {
  it('counts every download and launch, even when many arrive at once', async () => {
    const kv = memoryKv()
    await Promise.all([
      ...Array.from({ length: 40 }, () => recordDownload(kv, 'paper', 'KwiivaPaper-Windows-Setup.exe')),
      ...Array.from({ length: 25 }, (_, i) => recordLaunch(kv, 'paper', i < 10)),
      ...Array.from({ length: 5 }, () => recordDownload(kv, 'write', 'KwiivaWrite-Linux.deb')),
    ])
    const paper = publicStats((await kv.read('paper')).value)
    expect(paper).toMatchObject({ downloads: 40, opens: 25, devices: 10 })
    expect(publicStats((await kv.read('write')).value).downloads).toBe(5)
  })

  it('tracks launches per day and reports the last 30 days', async () => {
    const kv = memoryKv()
    const now = new Date('2026-06-30T12:00:00Z')
    await recordLaunch(kv, 'write', true, new Date('2026-04-01T09:00:00Z'))
    await recordLaunch(kv, 'write', false, new Date('2026-06-20T09:00:00Z'))
    await recordLaunch(kv, 'write', false, now)
    expect(publicStats((await kv.read('write')).value, now)).toMatchObject({ opens: 3, devices: 1, opens30: 2 })
  })

  it('stores nothing that identifies a person', async () => {
    const kv = memoryKv()
    await recordLaunch(kv, 'paper', true)
    await recordDownload(kv, 'paper', 'KwiivaPaper-Linux.deb')
    const stored = JSON.stringify([...kv.data.values()])
    expect(Object.keys((await kv.read('paper')).value!).sort()).toEqual(['byFile', 'daily', 'devices', 'downloads', 'opens'])
    expect(stored).not.toMatch(/ip|agent|address|id"/i)
  })

  it('only accepts known apps in a launch message', () => {
    expect(validLaunch({ product: 'paper', first: true })).toEqual({ product: 'paper', first: true })
    expect(validLaunch({ product: 'write' })).toEqual({ product: 'write', first: false })
    expect(validLaunch({ product: 'evil' })).toBeNull()
    expect(validLaunch(null)).toBeNull()
  })

  it('offers the same installers the release workflow publishes and the website lists', async () => {
    const { readFileSync } = await import('node:fs')
    const site = readFileSync('public/site.js', 'utf8')
    for (const [k, p] of Object.entries(PRODUCTS)) {
      expect(site).toContain(`${k}: {`)
      expect(site).toContain(`'${p.tag}'`)
      // Installer names are PREFIX + a fixed ending; the caller sets the prefix and the shared workflow the endings.
      const caller = readFileSync(`.github/workflows/release-${k}.yml`, 'utf8')
      const shared = readFileSync('.github/workflows/desktop-release.yml', 'utf8')
      const prefix = /prefix: (\w+)/.exec(caller)![1]
      for (const f of p.files) {
        expect(f.startsWith(prefix + '-'), f).toBe(true)
        expect(shared, f).toContain('$PREFIX' + f.slice(prefix.length))
      }
    }
  })
})
