import { zipSync } from 'fflate'
import type { Deck } from '../model'
import { download } from './files'
import { withRenderedSlides } from './offscreen'

interface Rule { text: string; font?: string; base?: string; ext?: boolean }
let rulesCache: Rule[] | null = null
const fontData = new Map<string, Promise<string | null>>()

const blobToDataUrl = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(b) })

function rules(): Rule[] {
  if (rulesCache) return rulesCache
  const out: Rule[] = []
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList
    try { list = sheet.cssRules } catch { continue }
    for (const rule of [...list]) {
      if (rule instanceof CSSFontFaceRule) out.push({ text: rule.cssText, font: rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim(), base: sheet.href ?? location.href, ext: !/U\+0000-00FF/i.test(rule.style.getPropertyValue('unicode-range')) && rule.style.getPropertyValue('unicode-range') !== '' })
      else if (rule instanceof CSSStyleRule && /^\.(slide|el|tv|pp|run|shape-svg|link-wrap|prompt)\b/.test(rule.selectorText)) out.push({ text: rule.cssText })
    }
  }
  return (rulesCache = out)
}

/** The page's own CSS for slides, with the fonts the markup uses inlined, so a picture or web page made from a slide looks the same without this page. */
export async function pageCss(markup: string): Promise<string> {
  let out = ''
  // Only fonts that come first or second in a font stack are needed; later ones are fallbacks.
  const wanted = new Set<string>()
  for (const m of markup.matchAll(/font-family:\s*([^;"]+)/g)) m[1].replace(/&quot;/g, '').replace(/["']/g, '').split(',').slice(0, 2).forEach((f) => wanted.add(f.trim()))
  const wide = /[\u0100-\u024f\u0400-\u04ff]/.test(markup)
  for (const r of rules()) {
    if (!r.font) { out += r.text + '\n'; continue }
    if (!wanted.has(r.font) || (r.ext && !wide)) continue
    let text = r.text
    for (const m of [...text.matchAll(/url\(["']?([^"')]+)["']?\)/g)]) {
      if (m[1].startsWith('data:')) continue
      const url = new URL(m[1], r.base).href
      if (!fontData.has(url)) fontData.set(url, fetch(url).then(async (res) => (res.ok ? blobToDataUrl(await res.blob()) : null)).catch(() => null))
      const data = await fontData.get(url)
      if (data) text = text.replace(m[0], `url(${data})`)
    }
    out += text + '\n'
  }
  return out
}

const XMLNS = 'http://www.w3.org/1999/xhtml'
async function slideToCanvas(slide: HTMLElement, w: number, h: number, width: number): Promise<HTMLCanvasElement> {
  const clone = slide.cloneNode(true) as HTMLElement
  const markup = new XMLSerializer().serializeToString(clone)
  const css = await pageCss(markup)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><foreignObject width="100%" height="100%"><div xmlns="${XMLNS}" style="width:${w}px;height:${h}px;overflow:hidden"><style>${css.replace(/</g, '&lt;')}</style>${markup}</div></foreignObject></svg>`
  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('This browser could not draw the slide as a picture.')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) })
  const k = width / w
  const c = document.createElement('canvas')
  c.width = Math.round(w * k); c.height = Math.round(h * k)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}
const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((res, rej) => c.toBlob(async (b) => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error('Could not make the picture.'))), 'image/png'))

export async function renderSlidePng(deck: Deck, index: number, width = 1920): Promise<Uint8Array> {
  return withRenderedSlides(deck, [index], async ([el]) => toPng(await slideToCanvas(el, deck.w, deck.h, width)))
}
export async function renderAllPng(deck: Deck, width = 1920, onlyShown = false): Promise<Uint8Array[]> {
  const idx = deck.slides.map((_, i) => i).filter((i) => !onlyShown || !deck.slides[i].hidden)
  return withRenderedSlides(deck, idx, async (els) => { const out: Uint8Array[] = []; for (const el of els) out.push(await toPng(await slideToCanvas(el, deck.w, deck.h, width))); return out })
}

export async function exportAllPng(): Promise<void> {
  const { useStore } = await import('../store')
  const deck = useStore.getState().deck
  const pngs = await renderAllPng(deck)
  const files: Record<string, Uint8Array> = {}
  pngs.forEach((b, i) => { files[`slide-${String(i + 1).padStart(2, '0')}.png`] = b })
  const name = (useStore.getState().file.name || 'presentation').replace(/[\\/:*?"<>|]/g, '_')
  download(`${name}-slides.zip`, zipSync(files, { level: 0 }) as unknown as BlobPart, 'application/zip')
}
