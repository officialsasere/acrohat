import { describe, expect, it } from 'vitest'
import { fromMarkdown, fromText, toMarkdown, toText } from '../write/src/formats/markdown'
import { PRODUCTS } from '../netlify/functions/lib/counters'
import type { PMDoc } from '../write/src/formats/types'

const SRC = `# Title

Some **bold**, *italic*, ~~gone~~ and \`code\` with a [link](https://example.org).

- one
  - nested
- two

1. first
2. second

- [x] done
- [ ] todo

> quoted

\`\`\`
let a = 1
\`\`\`

---

| a | b |
| --- | --- |
| 1 | 2 |
`

describe('markdown', () => {
  const doc = fromMarkdown(SRC)
  it('reads headings, emphasis, links, lists, quotes, code, rules and tables', () => {
    const types = doc.content.map((n) => n.type)
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table'])
    const marks = doc.content[1].content!.flatMap((n) => n.marks?.map((m) => m.type) ?? [])
    expect(marks).toEqual(['bold', 'italic', 'strike', 'code', 'link'])
    expect(doc.content[2].content![0].content!.some((c) => c.type === 'bulletList')).toBe(true)
    expect(doc.content[4].content!.map((i) => i.attrs!.checked)).toEqual([true, false])
    expect(doc.content[8].content).toHaveLength(2)
  })
  it('round-trips through its own writer', () => {
    const again = fromMarkdown(toMarkdown(doc))
    expect(again.content.map((n) => n.type)).toEqual(doc.content.map((n) => n.type))
  })
  it('plain text keeps every line', () => {
    const t = fromText('one\n\ntwo')
    expect(t.content).toHaveLength(3)
    expect(toText(t as PMDoc)).toBe('one\n\ntwo\n')
  })
})

describe('download function', () => {
  it('sends visitors only to files the release workflow publishes', async () => {
    const { vi } = await import('vitest')
    const store = new Map<string, { data: unknown; etag: string }>()
    vi.doMock('@netlify/blobs', () => ({
      getStore: () => ({
        getWithMetadata: async (k: string) => store.get(k) ?? null,
        setJSON: async (k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean }) => {
          const cur = store.get(k)
          if (o.onlyIfNew && cur) return { modified: false }
          if (o.onlyIfMatch && cur?.etag !== o.onlyIfMatch) return { modified: false }
          store.set(k, { data: v, etag: String(Math.random()) })
          return { modified: true }
        },
      }),
    }))
    const { default: handler } = await import('../netlify/functions/stats.mts')
    const ok = await handler(new Request('https://x.test/api/download/write/KwiivaWrite-Linux.deb'))
    expect(ok.status).toBe(302)
    expect(ok.headers.get('location')).toBe(`https://github.com/officialsasere/kwiiva/releases/download/${PRODUCTS.write.tag}/KwiivaWrite-Linux.deb`)
    expect((await handler(new Request('https://x.test/api/download/write/evil.exe'))).status).toBe(404)
    expect((await handler(new Request('https://x.test/api/download/nope/x'))).status).toBe(404)

    const post = (body: unknown) => handler(new Request('https://x.test/api/usage', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
    expect((await post({ product: 'paper', first: true })).status).toBe(204)
    expect((await post({ product: 'paper', first: false })).status).toBe(204)
    expect((await post({ product: 'bad' })).status).toBe(400)
    const opt = await handler(new Request('https://x.test/api/usage', { method: 'OPTIONS' }))
    expect(opt.status).toBe(204)
    expect(opt.headers.get('access-control-allow-origin')).toBe('*')

    const stats = await (await handler(new Request('https://x.test/api/stats'))).json()
    expect(stats.products.paper).toMatchObject({ opens: 2, devices: 1, downloads: 0 })
    expect(stats.products.write.downloads).toBe(1)
  })
})
