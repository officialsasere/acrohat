import { slideTitle, textOf, uid, type BulletKind, type Deck, type Para, type ShapeEl, type Slide } from '../model'
import { slideFromLayout } from '../themes'

const NUM = new Set<BulletKind>(['num', 'alpha', 'Alpha', 'roman', 'Roman'])
const BODY_ROLES = ['subtitle', 'body', 'body2', 'object']

/** The deck as plain, editable text: `# Title`, bullets with `-`, `>` for speaker notes, `---` between slides. */
export function deckToOutline(deck: Deck): string {
  return deck.slides.map((s) => {
    const lines: string[] = [`# ${slideTitle(s) || 'Untitled slide'}`]
    const title = s.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'title')
    const bodies = s.els.filter((e): e is ShapeEl => e.type === 'shape' && !!e.text && e !== title && (e.ph ? BODY_ROLES.includes(e.ph.role) : true)).sort((a, b) => a.y - b.y || a.x - b.x)
    for (const b of bodies) {
      const bullet = (p: Para) => p.bullet ?? b.st?.bullet ?? 'none'
      for (const p of b.text!.paras) {
        const t = p.runs.map((r) => r.t).join('').replace(/\n/g, ' ')
        if (!t.trim()) continue
        const ind = '  '.repeat(p.level ?? 0)
        const kind = bullet(p)
        lines.push(kind === 'none' ? `${ind}${t}` : NUM.has(kind) ? `${ind}1. ${t}` : `${ind}- ${t}`)
      }
    }
    if (s.notes.trim()) for (const l of s.notes.split('\n')) lines.push(`> ${l}`)
    return lines.join('\n')
  }).join('\n\n---\n\n') + '\n'
}

export interface OutlineSlide { title: string; paras: { text: string; level: number; bullet: BulletKind }[]; notes: string }

export function parseOutline(src: string): OutlineSlide[] {
  const slides: OutlineSlide[] = []
  let cur: OutlineSlide | undefined
  const start = (title: string) => { cur = { title, paras: [], notes: '' }; slides.push(cur); return cur }
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (/^-{3,}$/.test(line.trim())) { cur = undefined; continue }
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) { start(h[1].trim()); continue }
    if (!line.trim()) continue
    const c = cur ?? start('')
    const note = /^>\s?(.*)$/.exec(line)
    if (note) { c.notes += (c.notes ? '\n' : '') + note[1]; continue }
    const m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line)
    if (m) c.paras.push({ text: m[3], level: Math.min(8, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), bullet: /\d/.test(m[2]) ? 'num' : 'disc' })
    else if (!c.title && !c.paras.length) c.title = line.trim()
    else c.paras.push({ text: line.trim(), level: 0, bullet: 'none' })
  }
  return slides
}

const toParas = (items: OutlineSlide['paras'], keepBullet: boolean): Para[] => items.map((p) => ({ runs: [{ t: p.text }], level: p.level || undefined, bullet: keepBullet || p.bullet !== 'none' ? p.bullet : undefined }))

/** Slides built from an outline; the layout follows the shape of each entry. */
export function outlineToSlides(deck: Deck, src: OutlineSlide[], first = false): Slide[] {
  return src.map((o, i) => {
    const bullets = o.paras.some((p) => p.bullet !== 'none')
    const layout = (first && i === 0 && !bullets && o.paras.length <= 1) ? 'title' : !o.paras.length ? 'titleOnly' : !bullets && o.paras.length === 1 && o.paras[0].text.length < 90 ? 'section' : 'titleBody'
    const s = slideFromLayout(deck, layout)
    s.notes = o.notes
    const set = (role: string, paras: Para[]) => { const el = s.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === role); if (el) el.text = { ...el.text, paras: paras.length ? paras : [{ runs: [] }] } }
    set('title', [{ runs: o.title ? [{ t: o.title }] : [] }])
    if (layout === 'title') set('subtitle', toParas(o.paras, false))
    else if (layout === 'section') set('body', toParas(o.paras, false).map((p) => ({ ...p, bullet: 'none' as const })))
    else if (layout === 'titleBody') set('body', o.paras.map((p) => ({ runs: [{ t: p.text }], level: p.level || undefined, bullet: p.bullet === 'none' ? ('none' as const) : p.bullet })))
    return s
  })
}

/** Apply an edited outline to the deck: slide n's title and body take the text of entry n; extra entries become new slides. */
export function applyOutline(deck: Deck, src: OutlineSlide[]): Deck {
  const slides = deck.slides.map((s, i) => {
    const o = src[i]
    if (!o) return s
    const els = s.els.map((e) => {
      if (e.type !== 'shape' || !e.ph) return e
      if (e.ph.role === 'title') return { ...e, text: { ...e.text, paras: [{ runs: o.title ? [{ t: o.title }] : [] }] } }
      if (e.ph.role === 'body' || e.ph.role === 'subtitle') return { ...e, text: { ...e.text, paras: o.paras.length ? o.paras.map((p) => ({ runs: [{ t: p.text }], level: p.level || undefined, bullet: p.bullet === 'none' ? ('none' as const) : e.ph!.role === 'subtitle' ? undefined : p.bullet })) : [{ runs: [] }] } }
      return e
    })
    return { ...s, els, notes: o.notes }
  })
  const extra = outlineToSlides(deck, src.slice(deck.slides.length))
  return { ...deck, slides: [...slides, ...extra] }
}

export function deckToText(deck: Deck): string {
  return deck.slides.map((s, i) => `Slide ${i + 1}\n${s.els.map((e) => (e.type === 'shape' ? textOf(e.text) : e.type === 'table' ? e.rows.map((r) => r.cells.map((c) => textOf(c.text)).join('\t')).join('\n') : '')).filter((t) => t.trim()).join('\n')}${s.notes ? `\nNotes: ${s.notes}` : ''}`).join('\n\n') + '\n'
}
export { uid }
