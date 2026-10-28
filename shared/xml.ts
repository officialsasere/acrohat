/** A tiny XML reader, enough for the files inside a .docx. Works in any JavaScript runtime (no DOM needed). */
export interface XEl {
  name: string
  attrs: Record<string, string>
  children: XEl[]
  text: string
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
export const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENT[e.toLowerCase()]
  })
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function parseXml(src: string): XEl {
  const root: XEl = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XEl[] = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (m[3] !== undefined) {
      const el: XEl = { name: m[3], attrs: {}, children: [], text: '' }
      const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let a: RegExpExecArray | null
      while ((a = ar.exec(m[4] ?? ''))) el.attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '')
      top.children.push(el)
      if (!m[5]) stack.push(el)
    } else if (m[6] !== undefined) top.text += unescapeXml(m[6])
  }
  return root.children[0] ?? root
}

export const kids = (e: XEl | undefined, name: string) => (e ? e.children.filter((c) => c.name === name) : [])
export const kid = (e: XEl | undefined, name: string) => e?.children.find((c) => c.name === name)
/** Attribute lookup that ignores the namespace prefix, so `w:val` matches `val`. */
export const attr = (e: XEl | undefined, name: string) => {
  if (!e) return undefined
  if (e.attrs[name] !== undefined) return e.attrs[name]
  for (const k in e.attrs) if (k.endsWith(':' + name.split(':').pop())) return e.attrs[k]
  return undefined
}
