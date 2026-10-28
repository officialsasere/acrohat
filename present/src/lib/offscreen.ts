import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Deck } from '../model'
import { resolveBg, SlideView } from '../render/Slide'

/** Draw slides into a hidden part of the page (so text fitting and layout are real) and hand their elements to `fn`. */
export async function withRenderedSlides<T>(deck: Deck, indexes: number[], fn: (slides: HTMLElement[]) => Promise<T> | T): Promise<T> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none'
  host.setAttribute('aria-hidden', 'true')
  document.body.appendChild(host)
  const root = createRoot(host)
  const o = { theme: deck.theme, media: deck.media }
  flushSync(() => root.render(createElement('div', null, indexes.map((i) => {
    const s = deck.slides[i]
    return createElement(SlideView, { key: s.id, deck, o, els: s.els, bg: resolveBg(deck, s.layout, s.bg), under: [deck.master.els, (deck.layouts.find((l) => l.id === s.layout)?.els ?? []).filter((e) => !e.ph)], index: i, scale: 1 })
  }))))
  try {
    await (document.fonts?.ready ?? Promise.resolve())
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    return await fn([...host.querySelectorAll<HTMLElement>('.slide')])
  } finally {
    root.unmount()
    host.remove()
  }
}
