import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { PRODUCTS, REPO, publicStats, recordDownload, recordLaunch, validLaunch, type KV, type Stats } from './lib/counters.ts'

// Netlify Blobs keeps the counters. Free, and nothing in them identifies anyone.
function kv(): KV {
  const store = getStore({ name: 'kwiiva-stats', consistency: 'strong' })
  return {
    async read(key) {
      const r = await store.getWithMetadata(key, { type: 'json' })
      return r ? { value: r.data as Stats, etag: r.etag } : { value: null }
    },
    async write(key, value, etag) {
      const r = await store.setJSON(key, value, etag ? { onlyIfMatch: etag } : { onlyIfNew: true })
      return r.modified
    },
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' }
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } })

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, '')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  // POST /api/usage  { product, first }   one anonymous launch
  if (path === '/api/usage' && req.method === 'POST') {
    const body = validLaunch(await req.json().catch(() => null))
    if (!body) return json({ error: 'bad request' }, 400)
    try { await recordLaunch(kv(), body.product, body.first) } catch { return json({ error: 'busy' }, 503) }
    return new Response(null, { status: 204, headers: CORS })
  }

  // GET /api/download/<product>/<installer>   counts the download, then sends the visitor to GitHub
  const m = /^\/api\/download\/([^/]+)\/([^/]+)$/.exec(path)
  if (m && req.method === 'GET') {
    const [, product, file] = m
    const p = PRODUCTS[product]
    if (!p || !p.files.includes(decodeURIComponent(file))) return new Response('Unknown download', { status: 404 })
    // A counting hiccup must never stop a download.
    await recordDownload(kv(), product, decodeURIComponent(file)).catch(() => undefined)
    return Response.redirect(`https://github.com/${REPO.owner}/${REPO.name}/releases/download/${p.tag}/${file}`, 302)
  }

  // GET /api/stats   the public totals shown on the website
  if (path === '/api/stats' && req.method === 'GET') {
    const store = kv()
    const entries = await Promise.all(Object.keys(PRODUCTS).map(async (k) => [k, publicStats((await store.read(k).catch(() => ({ value: null }))).value)] as const))
    return json({ products: Object.fromEntries(entries), updated: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=120' })
  }
  return new Response('Not found', { status: 404 })
}

export const config: Config = { path: ['/api/stats', '/api/usage', '/api/download/:product/:file'] }
