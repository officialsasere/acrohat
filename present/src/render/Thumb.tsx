import { memo, useMemo } from 'react'
import type { Deck, Slide } from '../model'
import { resolveBg, SlideView } from './Slide'

/** A small picture of a slide: the same drawing code as the editor, scaled down and not clickable. */
export const Thumb = memo(function Thumb({ deck, slide, width, index }: { deck: Deck; slide: Slide; width: number; index?: number }) {
  const o = useMemo(() => ({ theme: deck.theme, media: deck.media }), [deck.theme, deck.media])
  const layout = deck.layouts.find((l) => l.id === slide.layout)
  const under = useMemo(() => [deck.master.els, (layout?.els ?? []).filter((e) => !e.ph)], [deck.master.els, layout])
  return <div style={{ pointerEvents: 'none', width, height: (deck.h / deck.w) * width }}><SlideView deck={deck} o={o} els={slide.els} bg={resolveBg(deck, slide.layout, slide.bg)} under={under} index={deck.footer.num ? index : undefined} scale={width / deck.w} /></div>
}, (a, b) => a.slide === b.slide && a.width === b.width && a.deck.theme === b.deck.theme && a.deck.media === b.deck.media && a.deck.layouts === b.deck.layouts && a.deck.master === b.deck.master && a.deck.w === b.deck.w && a.deck.h === b.deck.h && a.deck.footer === b.deck.footer && (!a.deck.footer.num || a.index === b.index))
