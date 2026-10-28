import { useEffect, useRef, useState } from 'react'
import type { Deck } from '../model'
import { resolveBg, SlideView } from '../render/Slide'
import { buildSteps, hideEntrances, playStep, resetStyles } from './anim'

export const CHANNEL = 'kwiiva-present-show'
export interface ShowState { index: number; step: number; black: null | 'black' | 'white' }
export type Msg = { t: 'hello' } | { t: 'deck'; deck: Deck; state: ShowState } | { t: 'state'; state: ShowState } | { t: 'bye' }

/** The second window of a two-screen talk: it follows the presenter view and shows only the slide. */
export function Audience() {
  const [deck, setDeck] = useState<Deck | null>(null)
  const [state, setState] = useState<ShowState>({ index: 0, step: 0, black: null })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [full, setFull] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const prev = useRef<ShowState>({ index: -1, step: 0, black: null })
  const ch = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    const c = new BroadcastChannel(CHANNEL)
    ch.current = c
    c.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data.t === 'deck') { setDeck(e.data.deck); setState(e.data.state) }
      else if (e.data.t === 'state') setState(e.data.state)
      else if (e.data.t === 'bye') window.close()
    }
    c.postMessage({ t: 'hello' } satisfies Msg)
    const rs = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', rs)
    const fs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', fs)
    document.title = 'Kwiiva Present – audience'
    return () => { c.close(); window.removeEventListener('resize', rs); document.removeEventListener('fullscreenchange', fs) }
  }, [])

  // Bring the slide to the presenter's place: animate the step just taken, jump over the others.
  useEffect(() => {
    if (!deck || !box.current) return
    const root = box.current.querySelector<HTMLElement>('.slide-inner')
    const sl = deck.slides[state.index]
    if (!root || !sl) return
    const p = prev.current
    const steps = buildSteps(sl)
    const sameSlide = p.index === state.index
    if (!sameSlide || state.step < p.step || state.step > p.step + 1) {
      resetStyles(root); hideEntrances(root, sl)
      for (let i = 0; i < state.step; i++) if (steps[i]) void playStep(root, sl, steps[i], deck.w, deck.h, true)
    } else if (state.step === p.step + 1 && steps[p.step]) void playStep(root, sl, steps[p.step], deck.w, deck.h)
    prev.current = state
  }, [deck, state])

  if (!deck) return <div className="show audience"><p className="audience-wait">Waiting for the presenter view… Open it from the slide show, then use “Open audience window”.</p></div>
  const sl = deck.slides[state.index]
  const scale = Math.min(size.w / deck.w, size.h / deck.h)
  const o = { theme: deck.theme, media: deck.media, interactive: true }
  return (
    <div className="show audience">
      <div className="show-stage" ref={box} style={{ width: deck.w * scale, height: deck.h * scale }} key={state.index}>
        {sl && <SlideView deck={deck} o={o} els={sl.els} bg={resolveBg(deck, sl.layout, sl.bg)} under={[deck.master.els, (deck.layouts.find((l) => l.id === sl.layout)?.els ?? []).filter((e) => !e.ph)]} index={state.index} scale={scale} />}
      </div>
      {state.black && <div className="show-black" style={{ background: state.black === 'black' ? '#000' : '#fff' }} />}
      {!full && <button type="button" className="primary audience-fs" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>Full screen</button>}
    </div>
  )
}
