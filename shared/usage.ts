/**
 * The anonymous launch counter shown on the Kwiiva website.
 *
 * What is sent when an app opens: the app name, "web" or "desktop", and whether this is the first launch on this device.
 * Nothing else: no ID, no file names, no text. The server counts and does not keep addresses.
 * Anyone can switch it off (Help → Privacy), and the app works the same either way.
 */
export type Product = 'paper' | 'write'

/** Where the counters live. The web apps use their own site; the desktop apps need the full address. */
export const STATS_ORIGIN = 'https://kwiiva.netlify.app'

const OFF = 'kwiiva.usage'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode: nothing to remember */ } }

export const isUsageEnabled = () => read(OFF) !== 'off'
export const setUsageEnabled = (on: boolean) => write(OFF, on ? 'on' : 'off')

export async function reportLaunch(product: Product): Promise<void> {
  if (!isUsageEnabled() || typeof window === 'undefined') return
  const desktop = '__TAURI_INTERNALS__' in window
  const host = location.hostname
  // Never count developers running the app locally, or automated tests.
  if (!desktop && (host === 'localhost' || host === '127.0.0.1' || host === '' || navigator.webdriver)) return
  const key = `kwiiva.${product}.seen`
  const first = read(key) === null
  try {
    const res = await fetch((desktop ? STATS_ORIGIN : '') + '/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ product, first, platform: desktop ? 'desktop' : 'web' }),
      keepalive: true,
    })
    if (res.ok) write(key, '1')
  } catch {
    /* offline or blocked: that is fine, try again next launch */
  }
}
