import type { PMNode, PMDoc } from './types'

/** Document -> Markdown. Things Markdown can't hold (colours, fonts, alignment) are dropped; the words and structure stay. */
export function toMarkdown(doc: PMDoc): string {
  const inline = (nodes: PMNode[] | undefined): string =>
    (nodes ?? [])
      .map((n) => {
        if (n.type === 'hardBreak') return '  \n'
        if (n.type === 'image') return `![${n.attrs?.alt ?? ''}](${String(n.attrs?.src ?? '').startsWith('data:') ? 'image' : n.attrs?.src})`
        let s = (n.text ?? '').replace(/([\\`*_[\]])/g, '\\$1')
        const has = (t: string) => n.marks?.some((m) => m.type === t)
        if (has('code')) s = '`' + (n.text ?? '') + '`'
        if (has('bold')) s = `**${s}**`
        if (has('italic')) s = `*${s}*`
        if (has('strike')) s = `~~${s}~~`
        const link = n.marks?.find((m) => m.type === 'link')
        if (link) s = `[${s}](${link.attrs?.href})`
        return s
      })
      .join('')
  const block = (n: PMNode, indent = ''): string => {
    switch (n.type) {
      case 'paragraph': return indent + inline(n.content)
      case 'heading': return '#'.repeat(Number(n.attrs?.level) || 1) + ' ' + inline(n.content)
      case 'blockquote': return (n.content ?? []).map((c) => block(c)).join('\n\n').split('\n').map((l) => '> ' + l).join('\n')
      case 'codeBlock': return '```\n' + (n.content ?? []).map((c) => c.text).join('') + '\n```'
      case 'horizontalRule': return '---'
      case 'pageBreak': return '<div style="page-break-after: always"></div>'
      case 'bulletList': case 'orderedList': case 'taskList':
        return (n.content ?? []).map((li, i) => {
          const mark = n.type === 'orderedList' ? `${(Number(n.attrs?.start) || 1) + i}. ` : n.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}] ` : '- '
          const parts = (li.content ?? []).map((c) => (c.type.endsWith('List') ? block(c, '  ') : inline(c.content)))
          return indent + mark + parts[0] + (parts.length > 1 ? '\n' + parts.slice(1).map((p) => (p.startsWith(indent + '  ') ? p : indent + '  ' + p)).join('\n') : '')
        }).join('\n')
      case 'table': {
        const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => inline(p.content)).join(' ').replace(/\|/g, '\\|')))
        if (!rows.length) return ''
        const w = Math.max(...rows.map((r) => r.length))
        const pad = (r: string[]) => '| ' + Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ') + ' |'
        return [pad(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(pad)].join('\n')
      }
      case 'tableOfContents': return ''
      default: return (n.content ?? []).map((c) => block(c)).join('\n\n')
    }
  }
  return doc.content.map((n) => block(n)).filter((s) => s !== '').join('\n\n') + '\n'
}

function inlineMd(src: string): PMNode[] {
  const out: PMNode[] = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\))/g
  let last = 0
  const txt = (s: string, marks?: PMNode['marks']) => { if (s) out.push({ type: 'text', text: s.replace(/\\([\\`*_[\]])/g, '$1'), marks }) }
  for (const m of src.matchAll(re)) {
    txt(src.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('![')) { const mm = /!\[([^\]]*)\]\(([^)]+)\)/.exec(t)!; if (/^(https?:|data:)/.test(mm[2])) out.push({ type: 'image', attrs: { src: mm[2], alt: mm[1] } }); else txt(mm[1]) }
    else if (t.startsWith('[')) { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!; txt(mm[1], [{ type: 'link', attrs: { href: mm[2] } }]) }
    else if (t.startsWith('**') || t.startsWith('__')) txt(t.slice(2, -2), [{ type: 'bold' }])
    else if (t.startsWith('~~')) txt(t.slice(2, -2), [{ type: 'strike' }])
    else if (t.startsWith('`')) txt(t.slice(1, -1), [{ type: 'code' }])
    else txt(t.slice(1, -1), [{ type: 'italic' }])
    last = m.index! + t.length
  }
  txt(src.slice(last))
  return out
}

/** Markdown -> document: headings, paragraphs, lists (nested), tasks, quotes, code, rules, tables, links, emphasis. */
export function fromMarkdown(src: string): PMDoc {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const content: PMNode[] = []
  const para = (text: string): PMNode => ({ type: 'paragraph', content: inlineMd(text) })
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = /^```/.exec(line)
    if (fence) {
      const buf: string[] = []
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i])
      i++
      content.push({ type: 'codeBlock', content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : undefined })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { content.push({ type: 'heading', attrs: { level: h[1].length }, content: inlineMd(h[2].trim()) }); i++; continue }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { content.push({ type: 'horizontalRule' }); i++; continue }
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ''))
      content.push({ type: 'blockquote', content: fromMarkdown(buf.join('\n')).content })
      continue
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      for (; i < lines.length && /^\|.*\|\s*$/.test(lines[i]); i++) rows.push(cells(lines[i]))
      const row = (r: string[], type: string): PMNode => ({ type: 'tableRow', content: head.map((_, k) => ({ type, attrs: { colspan: 1, rowspan: 1 }, content: [para(r[k] ?? '')] })) })
      content.push({ type: 'table', content: [row(head, 'tableHeader'), ...rows.map((r) => row(r, 'tableCell'))] })
      continue
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      const items: { depth: number; ordered: boolean; text: string; task: boolean | null; start: number }[] = []
      for (; i < lines.length; i++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (!m) break
        const tm = /^\[([ xX])\]\s+(.*)$/.exec(m[3])
        items.push({ depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), ordered: /\d/.test(m[2]), text: tm ? tm[2] : m[3], task: tm ? tm[1] !== ' ' : null, start: parseInt(m[2], 10) || 1 })
      }
      const build = (idx: { v: number }, depth: number): PMNode => {
        const first = items[idx.v]
        const type = first.task !== null ? 'taskList' : first.ordered ? 'orderedList' : 'bulletList'
        const list: PMNode = { type, content: [], ...(type === 'orderedList' && first.start !== 1 ? { attrs: { start: first.start } } : {}) }
        while (idx.v < items.length && items[idx.v].depth >= depth) {
          const it = items[idx.v]
          if (it.depth > depth) { const parent = list.content![list.content!.length - 1]; parent.content!.push(build(idx, it.depth)); continue }
          list.content!.push(it.task !== null ? { type: 'taskItem', attrs: { checked: it.task }, content: [para(it.text)] } : { type: 'listItem', content: [para(it.text)] })
          idx.v++
        }
        return list
      }
      const idx = { v: 0 }
      while (idx.v < items.length) content.push(build(idx, items[idx.v].depth))
      continue
    }
    const buf: string[] = [line.trim()]
    for (i++; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s|\|)/.test(lines[i]); i++) buf.push(lines[i].trim())
    const nodes: PMNode[] = []
    buf.forEach((l, k) => { if (k) nodes.push({ type: 'hardBreak' }); nodes.push(...inlineMd(l.replace(/ {2,}$/, ''))) })
    content.push({ type: 'paragraph', content: nodes })
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

export function toText(doc: PMDoc): string {
  const flat = (n: PMNode): string => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? '\n' : n.type === 'image' ? '' : (n.content ?? []).map(flat).join(''))
  const block = (n: PMNode, prefix = ''): string[] => {
    if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList')
      return (n.content ?? []).flatMap((li, i) => (li.content ?? []).flatMap((c, k) => (c.type.endsWith('List') ? block(c, prefix + '  ') : [(k === 0 ? prefix + (n.type === 'orderedList' ? `${(Number(n.attrs?.start) || 1) + i}. ` : n.type === 'taskList' ? (li.attrs?.checked ? '[x] ' : '[ ] ') : '• ') : prefix + '  ') + flat(c)])))
    if (n.type === 'table') return (n.content ?? []).map((r) => (r.content ?? []).map((c) => flat(c).replace(/\n/g, ' ')).join('\t'))
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') return [flat(n)]
    if (n.type === 'pageBreak' || n.type === 'horizontalRule') return ['']
    return (n.content ?? []).flatMap((c) => block(c, prefix))
  }
  return doc.content.flatMap((n) => block(n)).join('\n') + '\n'
}

export function fromText(src: string): PMDoc {
  const content = src.replace(/\r\n?/g, '\n').split('\n').map((l): PMNode => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' }))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}
