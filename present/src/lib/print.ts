import { createElement, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { useStore } from '../store'
import { resolveBg, SlideView } from '../render/Slide'

let setOn: ((v: boolean) => void) | null = null

/** Pages for printing: one slide per page, drawn at the slide's real size. They exist only while the print dialog is open, so editing stays fast. */
export function PrintRoot() {
  const [on, set] = useState(false)
  const deck = useStore((s) => (on ? s.deck : null))
  useEffect(() => {
    setOn = set
    const before = () => flushSync(() => set(true))
    const after = () => set(false)
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after)
    return () => { setOn = null; window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [])
  if (!deck) return null
  const o = { theme: deck.theme, media: deck.media }
  return createElement('div', { className: 'print-root', 'aria-hidden': true },
    createElement('style', null, `@page { size: ${deck.w}pt ${deck.h}pt; margin: 0 } @media print { body { margin: 0 } }`),
    deck.slides.filter((s) => !s.hidden).map((s, i) => createElement('div', { key: s.id, className: 'print-page', style: { width: deck.w, height: deck.h } },
      createElement(SlideView, { deck, o, els: s.els, bg: resolveBg(deck, s.layout, s.bg), under: [deck.master.els, (deck.layouts.find((l) => l.id === s.layout)?.els ?? []).filter((e) => !e.ph)], index: i, scale: 1 }))))
}

export function printDeck() {
  if (setOn) flushSync(() => setOn!(true))
  window.print()
}
