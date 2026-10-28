import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { resolveBg, SlideView, type ViewOpts } from '../render/Slide'
import { Thumb } from '../render/Thumb'
import { slideTitle, type Deck, type Link, type Slide } from '../model'
import { buildSteps, firstIsAuto, hideEntrances, playStep, resetStyles, runTransition, type Step } from './anim'
import { Icon } from '../ui/ui'
import { CHANNEL, type Msg } from './Audience'

interface Ink { tool: 'pen' | 'highlighter'; color: string; w: number; pts: [number, number][] }

const layers = (deck: Deck, slide: Slide) => [deck.master.els, (deck.layouts.find((l) => l.id === slide.layout)?.els ?? []).filter((e) => !e.ph)]
const visibleIndexes = (deck: Deck) => deck.slides.map((s, i) => (s.hidden ? -1 : i)).filter((i) => i >= 0)

/** The slide show: full screen, keyboard and touch navigation, animations, transitions, pens, a laser pointer and a presenter console. */
export function Show() {
  const presenting = useStore((s) => s.presenting)!
  const deck = useStore((s) => s.deck)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const layerA = useRef<HTMLDivElement>(null)
  const layerB = useRef<HTMLDivElement>(null)
  const front = useRef<'a' | 'b'>('a')
  const [index, setIndex] = useState(() => Math.max(0, Math.min(deck.slides.length - 1, presenting.from)))
  const [shown, setShown] = useState<{ a: number; b: number }>({ a: index, b: index })
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [step, setStep] = useState(0)
  const [black, setBlack] = useState<null | 'black' | 'white'>(null)
  const [pen, setPen] = useState<null | 'pen' | 'highlighter' | 'eraser' | 'laser'>(null)
  const [color, setColor] = useState('#e03131')
  const [chrome, setChrome] = useState(true)
  const [grid, setGrid] = useState(false)
  const [jump, setJump] = useState('')
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null)
  const [inks, setInks] = useState<Record<number, Ink[]>>({})
  const [secs, setSecs] = useState(0)
  const [console_, setConsole] = useState(!!presenting.presenter)
  const busy = useRef(false)
  const stepsRef = useRef<Step[]>([])
  const hideTimer = useRef(0)
  const drawing = useRef<Ink | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const idxRef = useRef(index); idxRef.current = index
  const stepRef = useRef(step); stepRef.current = step

  const slide = deck.slides[index]
  const o: ViewOpts = useMemo(() => ({ theme: deck.theme, media: deck.media, interactive: true, onLink: (l: Link) => follow(l) }), [deck.theme, deck.media]) // eslint-disable-line react-hooks/exhaustive-deps
  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    useStore.setState({ presenting: null, cur: deck.slides[idxRef.current]?.id ?? useStore.getState().cur })
  }, [deck.slides])

  // Full screen on start, and track the size.
  useEffect(() => {
    if (!console_) void root.current?.requestFullscreen?.().catch(() => undefined)
    const rs = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    const fs = () => { if (!document.fullscreenElement && !console_ && root.current) { /* user pressed Esc in full screen: leave the show too */ exit() } }
    window.addEventListener('resize', rs); document.addEventListener('fullscreenchange', fs)
    return () => { window.removeEventListener('resize', rs); document.removeEventListener('fullscreenchange', fs) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setSecs((x) => x + 1), 1000); return () => clearInterval(t) }, [])

  // Mirror the show to an audience window, when one is open.
  const chan = useRef<BroadcastChannel | null>(null)
  const stateRef = useRef({ index, step, black }); stateRef.current = { index, step, black }
  useEffect(() => {
    const c = new BroadcastChannel(CHANNEL)
    chan.current = c
    c.onmessage = (e: MessageEvent<Msg>) => { if (e.data.t === 'hello') c.postMessage({ t: 'deck', deck, state: stateRef.current } satisfies Msg) }
    return () => { c.postMessage({ t: 'bye' } satisfies Msg); c.close(); chan.current = null }
  }, [deck])
  useEffect(() => { chan.current?.postMessage({ t: 'state', state: { index, step, black } } satisfies Msg) }, [index, step, black])

  const scale = console_ ? 1 : Math.min(size.w / deck.w, size.h / deck.h)
  const getLayer = (which: 'a' | 'b') => (which === 'a' ? layerA.current : layerB.current)

  // Prepare a slide that has just been drawn into a layer: hide what animates in, run the first automatic step.
  const prepare = useCallback((layer: HTMLElement | null, sl: Slide, upTo = 0) => {
    if (!layer) return
    const inner = layer.querySelector<HTMLElement>('.slide-inner')
    if (!inner) return
    resetStyles(inner)
    hideEntrances(inner, sl)
    const steps = buildSteps(sl)
    stepsRef.current = steps
    // Steps before `upTo` are applied at once (coming back to a slide, or going back a step).
    for (let i = 0; i < upTo; i++) void playStep(inner, sl, steps[i], deck.w, deck.h, true)
  }, [deck.w, deck.h])

  const start = useCallback((auto = true) => {
    const sl = deck.slides[idxRef.current]
    const layer = getLayer(front.current)
    prepare(layer, sl)
    setStep(0)
    if (auto && firstIsAuto(sl) && layer) { const inner = layer.querySelector<HTMLElement>('.slide-inner'); if (inner && stepsRef.current[0]) { busy.current = true; setStep(1); void playStep(inner, sl, stepsRef.current[0], deck.w, deck.h).then(() => { busy.current = false }) } }
  }, [deck.slides, deck.w, deck.h, prepare])

  useEffect(() => { start(); }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Move to another slide with its transition. */
  const goTo = useCallback((to: number, forward = true, instantSteps = 0) => {
    if (to < 0 || to >= deck.slides.length || busy.current) return
    const from = idxRef.current
    const next = deck.slides[to]
    const t = (forward ? next : deck.slides[from]).trans
    const old = front.current, nu = old === 'a' ? 'b' : 'a'
    busy.current = true
    setShown((s) => ({ ...s, [nu]: to }))
    setIndex(to); idxRef.current = to
    setInks((i) => ({ ...i }))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const oldL = getLayer(old), newL = getLayer(nu)
      if (!oldL || !newL) { busy.current = false; return }
      prepare(newL, next, instantSteps)
      setStep(instantSteps)
      newL.style.visibility = 'visible'; newL.style.opacity = '1'
      const finish = () => { oldL.style.visibility = 'hidden'; oldL.style.zIndex = '0'; newL.style.zIndex = '1'; oldL.getAnimations().forEach((a) => a.cancel()); newL.getAnimations().forEach((a) => a.cancel()); front.current = nu; busy.current = false
        if (instantSteps === 0 && firstIsAuto(next)) { const inner = newL.querySelector<HTMLElement>('.slide-inner'); if (inner && stepsRef.current[0]) { busy.current = true; setStep(1); void playStep(inner, next, stepsRef.current[0], deck.w, deck.h).then(() => { busy.current = false }) } } }
      if (t && t.kind !== 'none') {
        const run = runTransition(oldL, newL, t, size.w / scale || deck.w, size.h / scale || deck.h, forward)
        void run.finished.then(finish)
      } else finish()
    }))
  }, [deck.slides, deck.w, deck.h, prepare, scale, size.w, size.h])

  const next = useCallback(() => {
    if (busy.current) return
    const sl = deck.slides[idxRef.current]
    const steps = stepsRef.current
    const st = stepRef.current
    if (st < steps.length) {
      const inner = getLayer(front.current)?.querySelector<HTMLElement>('.slide-inner')
      if (inner) { busy.current = true; setStep(st + 1); void playStep(inner, sl, steps[st], deck.w, deck.h).then(() => { busy.current = false }); return }
    }
    const vis = visibleIndexes(deck)
    const nx = vis.find((i) => i > idxRef.current)
    if (nx !== undefined) goTo(nx, true)
    else if (deck.show.loop && vis.length) goTo(vis[0], true)
    else if (!console_) { /* last slide: stay, like other presenters */ setBlack('black') }
  }, [deck, goTo, console_])

  const prev = useCallback(() => {
    if (busy.current) return
    const st = stepRef.current
    if (st > 0) {
      const sl = deck.slides[idxRef.current]
      const layer = getLayer(front.current)
      prepare(layer, sl, st - 1)
      setStep(st - 1)
      return
    }
    const vis = visibleIndexes(deck)
    const pv = [...vis].reverse().find((i) => i < idxRef.current)
    if (pv !== undefined) goTo(pv, false, buildSteps(deck.slides[pv]).length)
  }, [deck, goTo, prepare])

  const follow = (l: Link) => {
    if (l.slide) { const i = deck.slides.findIndex((s) => s.id === l.slide); if (i >= 0) goTo(i, true) }
    else if (l.url) window.open(/^[a-z]+:/i.test(l.url) ? l.url : `https://${l.url}`, '_blank', 'noopener,noreferrer')
  }

  // Slides that move on by themselves.
  useEffect(() => {
    if (!deck.show.useTimings || !slide?.auto || console_) return
    const t = setTimeout(() => next(), slide.auto * 1000)
    return () => clearTimeout(t)
  }, [index, slide?.auto, deck.show.useTimings, next, console_])

  // Keyboard.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key
      const mod = e.metaKey || e.ctrlKey
      if (/^\d$/.test(k) && !mod) { setJump((j) => (j + k).slice(-3)); return }
      if (k === 'Enter' && jump) { e.preventDefault(); const n = parseInt(jump, 10) - 1; setJump(''); if (n >= 0) goTo(Math.min(n, deck.slides.length - 1), n > idxRef.current); return }
      if (k === 'Escape') { e.preventDefault(); if (pen) setPen(null); else if (grid) setGrid(false); else if (black) setBlack(null); else exit(); return }
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n' || k === 'N') { e.preventDefault(); if (black) setBlack(null); else next() }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p' && !mod || k === 'P' && !mod) { e.preventDefault(); if (black) setBlack(null); else prev() }
      else if (k === 'Home') goTo(0, false)
      else if (k === 'End') goTo(deck.slides.length - 1, true)
      else if (k === 'b' || k === 'B' || k === '.') setBlack((b) => (b === 'black' ? null : 'black'))
      else if (k === 'w' || k === 'W' || k === ',') setBlack((b) => (b === 'white' ? null : 'white'))
      else if (k === 'l' || k === 'L') setPen((p) => (p === 'laser' ? null : 'laser'))
      else if (k === 'g' || k === 'G') setGrid((g) => !g)
      else if (mod && k.toLowerCase() === 'p') { e.preventDefault(); setPen('pen') }
      else if (mod && k.toLowerCase() === 'i') { e.preventDefault(); setPen('highlighter') }
      else if (mod && k.toLowerCase() === 'e') { e.preventDefault(); setPen('eraser') }
      else if (k === 'e' || k === 'E') setInks((i) => ({ ...i, [idxRef.current]: [] }))
      else if (k === 'F1') e.preventDefault()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [next, prev, goTo, exit, pen, grid, black, jump, deck.slides.length])

  // Chrome (the small toolbar) fades out when the pointer is still.
  const poke = () => { setChrome(true); clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => setChrome(false), 2500) }
  useEffect(() => { poke(); return () => clearTimeout(hideTimer.current) }, [])

  // Ink drawing.
  const draw = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const list = [...(inks[idxRef.current] ?? []), ...(drawing.current ? [drawing.current] : [])]
    for (const s of list) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.strokeStyle = s.color; ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1
      ctx.lineWidth = s.w * (c.width / deck.w)
      ctx.beginPath()
      s.pts.forEach(([x, y], i) => { const px = (x * c.width) / deck.w, py = (y * c.height) / deck.h; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py) })
      if (s.pts.length === 1) ctx.lineTo((s.pts[0][0] * c.width) / deck.w + 0.1, (s.pts[0][1] * c.height) / deck.h)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }, [inks, deck.w, deck.h])
  useEffect(() => { draw() }, [draw, index, scale])

  const toSlide = (e: React.PointerEvent): [number, number] => { const r = stage.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * deck.w, ((e.clientY - r.top) / r.height) * deck.h] }
  const down = (e: React.PointerEvent) => {
    poke()
    if (pen === 'pen' || pen === 'highlighter') { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drawing.current = { tool: pen, color, w: pen === 'pen' ? 3 : 18, pts: [toSlide(e)] }; draw() }
    else if (pen === 'eraser') { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); eraseAt(toSlide(e)) }
  }
  const eraseAt = ([x, y]: [number, number]) => setInks((all) => { const list = all[idxRef.current] ?? []; const kept = list.filter((s) => !s.pts.some(([px, py]) => Math.hypot(px - x, py - y) < 14)); return kept.length === list.length ? all : { ...all, [idxRef.current]: kept } })
  const move = (e: React.PointerEvent) => {
    poke()
    if (pen === 'laser') setLaser({ x: e.clientX, y: e.clientY })
    if (drawing.current) { drawing.current.pts.push(toSlide(e)); draw() }
    else if (pen === 'eraser' && e.buttons) eraseAt(toSlide(e))
  }
  const up = () => { if (drawing.current) { const s = drawing.current; drawing.current = null; setInks((all) => ({ ...all, [idxRef.current]: [...(all[idxRef.current] ?? []), s] })) } }

  // Click and swipe to move.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const click = (e: React.MouseEvent) => {
    if (pen === 'pen' || pen === 'highlighter' || pen === 'eraser') return
    if ((e.target as HTMLElement).closest('a,button,video,audio,.show-bar,.link-wrap')) return
    if (e.clientX < size.w / 4 && (e.nativeEvent as PointerEvent).pointerType === 'touch') prev(); else next()
  }
  const touchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } }
  const touchEnd = (e: React.TouchEvent) => {
    const t = touch.current; touch.current = null
    if (!t || pen) return
    const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); if (dx < 0) next(); else prev() }
  }

  const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0')
  const vis = visibleIndexes(deck)
  const nextIdx = vis.find((i) => i > index)

  const renderSlide = (i: number, sc: number, interactive = true) => {
    const sl = deck.slides[i]
    if (!sl) return null
    return <SlideView deck={deck} o={interactive ? o : { theme: deck.theme, media: deck.media }} els={sl.els} bg={resolveBg(deck, sl.layout, sl.bg)} under={layers(deck, sl)} index={i} scale={sc} />
  }

  if (console_) {
    const cw = Math.min(size.w - 380, (size.h - 160) * (deck.w / deck.h))
    return (
      <div className="show console" ref={root} role="dialog" aria-label="Presenter view">
        <div className="console-main">
          <div className="console-cur" style={{ width: cw }}>
            <div className="layer-box" style={{ width: cw, height: (cw * deck.h) / deck.w }} ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
              <div className="layer" ref={layerA} style={{ visibility: 'visible' }}>{renderSlide(shown.a, cw / deck.w)}</div>
              <div className="layer" ref={layerB} style={{ visibility: 'hidden' }}>{renderSlide(shown.b, cw / deck.w)}</div>
              <canvas ref={canvas} width={Math.round(cw)} height={Math.round((cw * deck.h) / deck.w)} className="ink" />
            </div>
            <div className="console-nav">
              <button type="button" onClick={prev} aria-label="Previous"><Icon name="left" /></button>
              <span>Slide {index + 1} of {deck.slides.length}</span>
              <button type="button" onClick={next} aria-label="Next"><Icon name="right" /></button>
              <span className="timer" title="Time since the show started">{mm}:{ss}</span>
              <button type="button" onClick={() => setSecs(0)} title="Reset timer">Reset</button>
            </div>
          </div>
          <div className="console-side">
            <div className="console-label">Next</div>
            {nextIdx !== undefined ? <div className="console-next"><Thumb deck={deck} slide={deck.slides[nextIdx]} width={300} index={nextIdx} /></div> : <div className="console-end">End of show</div>}
            <div className="console-label">Speaker notes</div>
            <div className="console-notes" tabIndex={0}>{slide?.notes ? slide.notes : <em>No notes for this slide.</em>}</div>
            <div className="console-ctl">
              <button type="button" onClick={() => { window.open(`${location.pathname}?audience=1`, 'kwiiva-audience', 'popup,width=1280,height=720') }}><Icon name="slide" size={14} /> Open audience window</button>
              <button type="button" onClick={() => { setConsole(false); setTimeout(() => void root.current?.requestFullscreen?.().catch(() => undefined), 0) }}><Icon name="play" size={14} /> Show full screen here</button>
              <button type="button" className="primary" onClick={exit}>End show</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={'show' + (pen === 'laser' ? ' laser' : '') + (pen && pen !== 'laser' ? ' inking' : '')} ref={root} role="dialog" aria-label="Slide show" onPointerMove={move} onPointerDown={down} onPointerUp={up} onClick={click} onTouchStart={touchStart} onTouchEnd={touchEnd}>
      <div className="show-stage" ref={stage} style={{ width: deck.w * scale, height: deck.h * scale }}>
        <div className="layer" ref={layerA} style={{ visibility: 'visible' }}>{renderSlide(shown.a, scale)}</div>
        <div className="layer" ref={layerB} style={{ visibility: 'hidden' }}>{renderSlide(shown.b, scale)}</div>
        <canvas ref={canvas} width={Math.round(deck.w * scale)} height={Math.round(deck.h * scale)} className="ink" />
      </div>
      {pen === 'laser' && laser && <div className="laser-dot" style={{ left: laser.x, top: laser.y }} />}
      {black && <div className="show-black" style={{ background: black === 'black' ? '#000' : '#fff' }} onClick={() => setBlack(null)} />}
      {jump && <div className="show-jump">Go to slide {jump} (Enter)</div>}
      {grid && (
        <div className="show-grid" onClick={(e) => e.stopPropagation()}>
          {deck.slides.map((s, i) => <button key={s.id} type="button" className={i === index ? 'cur' : ''} onClick={() => { setGrid(false); if (i !== index) goTo(i, i > index) }}><Thumb deck={deck} slide={s} width={220} index={i} /><span>{i + 1}. {slideTitle(s)}</span></button>)}
        </div>
      )}
      <div className={'show-bar' + (chrome ? ' on' : '')} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Previous" title="Previous (←)" onClick={prev}><Icon name="left" size={18} /></button>
        <span className="pos">{index + 1} / {deck.slides.length}</span>
        <button type="button" aria-label="Next" title="Next (→)" onClick={next}><Icon name="right" size={18} /></button>
        <span className="sep" />
        <button type="button" className={pen === 'pen' ? 'on' : ''} aria-label="Pen" title="Pen (Ctrl+P)" onClick={() => setPen(pen === 'pen' ? null : 'pen')}><Icon name="line" size={18} /></button>
        <button type="button" className={pen === 'highlighter' ? 'on' : ''} aria-label="Highlighter" title="Highlighter (Ctrl+I)" onClick={() => setPen(pen === 'highlighter' ? null : 'highlighter')}><Icon name="highlight" size={18} /></button>
        <button type="button" className={pen === 'eraser' ? 'on' : ''} aria-label="Eraser" title="Eraser (Ctrl+E)" onClick={() => setPen(pen === 'eraser' ? null : 'eraser')}><Icon name="trash" size={18} /></button>
        <button type="button" className={pen === 'laser' ? 'on' : ''} aria-label="Laser pointer" title="Laser pointer (L)" onClick={() => setPen(pen === 'laser' ? null : 'laser')}><Icon name="pointer" size={18} /></button>
        <input type="color" aria-label="Pen colour" value={color} onChange={(e) => setColor(e.target.value)} />
        <span className="sep" />
        <button type="button" aria-label="All slides" title="All slides (G)" onClick={() => setGrid(true)}><Icon name="sort" size={18} /></button>
        <button type="button" aria-label="Blank the screen" title="Black screen (B)" onClick={() => setBlack('black')}><Icon name="eye" size={18} /></button>
        <button type="button" aria-label="Presenter view" title="Presenter view" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); setConsole(true) }}><Icon name="presenter" size={18} /></button>
        <button type="button" aria-label="End show" title="End show (Esc)" onClick={exit}><Icon name="close" size={18} /></button>
      </div>
    </div>
  )
}
