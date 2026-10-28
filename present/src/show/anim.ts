import type { Anim, Dir, El, Slide, Transition } from '../model'
import { findEl } from '../model'

/** One click's worth of animation: each entry starts `at` seconds after the click. */
export interface Timed { anim: Anim; para?: number; at: number; end: number }
export type Step = Timed[]

/** Group a slide's animations into steps. A "click" animation opens a step; "with previous" starts together with the one before; "after previous" starts when it ends. By-paragraph animations become one click per paragraph. */
export function buildSteps(slide: Slide): Step[] {
  const flat: { anim: Anim; para?: number; trigger: Anim['trigger'] }[] = []
  for (const a of slide.anims) {
    const el = findEl(slide.els, a.target)
    if (a.byPara && el?.type === 'shape' && el.text && el.text.paras.length > 1) el.text.paras.forEach((_, i) => flat.push({ anim: a, para: i, trigger: i === 0 ? a.trigger : 'click' }))
    else flat.push({ anim: a, trigger: a.trigger })
  }
  const steps: Step[] = []
  let prevStart = 0, prevEnd = 0
  for (const f of flat) {
    if (f.trigger === 'click' || steps.length === 0) { steps.push([]); prevStart = 0; prevEnd = 0 }
    const start = f.trigger === 'with' ? prevStart + f.anim.delay : f.trigger === 'after' ? prevEnd + f.anim.delay : f.anim.delay
    const end = start + f.anim.dur
    steps[steps.length - 1].push({ anim: f.anim, para: f.para, at: start, end })
    prevStart = start; prevEnd = end
  }
  return steps
}
/** The first step is automatic (no click) when the slide's first animation is not "on click". */
export const firstIsAuto = (slide: Slide) => !!slide.anims.length && slide.anims[0].trigger !== 'click'

const off = (dir: Dir | undefined, e: El | undefined, w: number, h: number) => {
  const x = e?.x ?? 0, y = e?.y ?? 0, ew = e?.w ?? 100, eh = e?.h ?? 100
  switch (dir ?? 'left') {
    case 'left': return [-(x + ew + 10), 0]
    case 'right': return [w - x + 10, 0]
    case 'up': return [0, -(y + eh + 10)]
    default: return [0, h - y + 10]
  }
}

function frames(a: Anim, e: El | undefined, w: number, h: number): Keyframe[] {
  const inn = a.kind === 'in'
  const pair = (from: Keyframe, to: Keyframe): Keyframe[] => (inn ? [{ ...from, visibility: 'visible' }, { ...to, visibility: 'visible' }] : [{ ...to, visibility: 'visible' }, { ...from, visibility: 'hidden' }])
  // `to` is the element's normal look; `from` is the hidden end.
  switch (a.effect) {
    case 'appear': return pair({ opacity: 1 }, { opacity: 1 })
    case 'fade': return pair({ opacity: 0 }, { opacity: 1 })
    case 'fly': { const [dx, dy] = off(a.dir, e, w, h); return pair({ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }) }
    case 'float': { const d = a.dir ?? 'up'; const dx = d === 'left' ? -40 : d === 'right' ? 40 : 0, dy = d === 'up' ? 40 : d === 'down' ? -40 : 0; return pair({ translate: `${dx}px ${dy}px`, opacity: 0 }, { translate: '0px 0px', opacity: 1 }) }
    case 'zoom': return pair({ scale: '0.1', opacity: 0 }, { scale: '1', opacity: 1 })
    case 'wipe': { const d = a.dir ?? 'left'; const hidden = d === 'left' ? 'inset(0 100% 0 0)' : d === 'right' ? 'inset(0 0 0 100%)' : d === 'up' ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)'; return pair({ clipPath: hidden }, { clipPath: 'inset(0 0 0 0)' }) }
    case 'split': return pair({ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' })
    case 'blinds': return pair({ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' })
    case 'grow': return [{ scale: '1' }, { scale: '1.4' }]
    case 'spin': return [{ rotate: '0deg' }, { rotate: '360deg' }]
    case 'pulse': return [{ scale: '1' }, { scale: '1.12', offset: 0.5 }, { scale: '1' }]
    case 'bounce': return [{ translate: '0 0' }, { translate: '0 -24px', offset: 0.3 }, { translate: '0 0', offset: 0.55 }, { translate: '0 -10px', offset: 0.75 }, { translate: '0 0' }]
    case 'teeter': return [{ rotate: '0deg' }, { rotate: '-6deg', offset: 0.25 }, { rotate: '6deg', offset: 0.75 }, { rotate: '0deg' }]
    case 'color': return [{ filter: 'none' }, { filter: 'hue-rotate(120deg) saturate(1.8)', offset: 0.5 }, { filter: 'none' }]
  }
}

const EASE = 'cubic-bezier(0.25, 0.1, 0.25, 1)'

/** The DOM nodes an animation acts on (the element, or one paragraph of it). */
export function targets(root: ParentNode, t: Timed): HTMLElement[] {
  const box = root.querySelector<HTMLElement>(`[data-el="${t.anim.target}"]`)
  if (!box) return []
  if (t.para === undefined) return [box]
  const p = box.querySelector<HTMLElement>(`p[data-pi="${t.para}"]`)
  return p ? [p] : []
}

/** Hide everything that has an entrance effect, ready for the show. */
export function hideEntrances(root: ParentNode, slide: Slide) {
  for (const t of buildSteps(slide).flat()) if (t.anim.kind === 'in') for (const n of targets(root, t)) n.style.visibility = 'hidden'
}
export function resetStyles(root: ParentNode) {
  for (const n of root.querySelectorAll<HTMLElement>('[data-el], p[data-pi]')) { n.getAnimations().forEach((a) => a.cancel()); n.style.visibility = '' }
}

/** Play one step. `instant` jumps to the end (used when going back and re-applying earlier steps). Resolves when the step has finished. */
export function playStep(root: ParentNode, slide: Slide, step: Step, w: number, h: number, instant = false): Promise<void> {
  const running: Animation[] = []
  for (const t of step) {
    const e = findEl(slide.els, t.anim.target)
    for (const n of targets(root, t)) {
      if (t.anim.kind === 'in') n.style.visibility = 'visible'
      const a = n.animate(frames(t.anim, e, w, h), { duration: instant ? 0 : Math.max(1, t.anim.dur * 1000), delay: instant ? 0 : t.at * 1000, fill: 'both', easing: EASE })
      running.push(a)
      void a.finished.then(() => { if (t.anim.kind === 'out') n.style.visibility = 'hidden'; else if (t.anim.kind === 'in') { n.style.visibility = 'visible' } }).catch(() => undefined)
      if (instant) a.finish()
    }
  }
  return Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => undefined)
}

// ---------------------------------------------------------------- transitions

export interface TransitionRun { finished: Promise<void>; cancel: () => void }
/** Animate from the old slide's layer to the new one. Both layers are absolutely positioned boxes in the same stage. */
export function runTransition(oldLayer: HTMLElement, newLayer: HTMLElement, t: Transition, w: number, h: number, forward = true): TransitionRun {
  const dur = Math.max(100, t.dur * 1000)
  const opt: KeyframeAnimationOptions = { duration: dur, easing: EASE, fill: 'both' }
  const anims: Animation[] = []
  const go = (n: HTMLElement, k: Keyframe[], o: KeyframeAnimationOptions = opt) => anims.push(n.animate(k, o))
  let d: Dir = t.dir ?? 'left'
  if (!forward) d = ({ left: 'right', right: 'left', up: 'down', down: 'up' } as const)[d]
  const vec = (dir: Dir) => (dir === 'left' ? [w, 0] : dir === 'right' ? [-w, 0] : dir === 'up' ? [0, h] : [0, -h]) // where the new slide starts
  const [vx, vy] = vec(d)
  newLayer.style.zIndex = '2'; oldLayer.style.zIndex = '1'
  switch (t.kind) {
    case 'fade': go(newLayer, [{ opacity: 0 }, { opacity: 1 }]); break
    case 'dissolve': go(newLayer, [{ opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0)' }]); go(oldLayer, [{ opacity: 1 }, { opacity: 0 }]); break
    case 'push': go(newLayer, [{ translate: `${vx}px ${vy}px` }, { translate: '0 0' }]); go(oldLayer, [{ translate: '0 0' }, { translate: `${-vx}px ${-vy}px` }]); break
    case 'cover': go(newLayer, [{ translate: `${vx}px ${vy}px` }, { translate: '0 0' }]); break
    case 'uncover': newLayer.style.zIndex = '1'; oldLayer.style.zIndex = '2'; go(oldLayer, [{ translate: '0 0' }, { translate: `${-vx}px ${-vy}px` }]); break
    case 'wipe': { const from = d === 'left' ? 'inset(0 0 0 100%)' : d === 'right' ? 'inset(0 100% 0 0)' : d === 'up' ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)'; go(newLayer, [{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }]); break }
    case 'split': go(newLayer, [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]); break
    case 'blinds': go(newLayer, [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }]); break
    case 'zoom': go(newLayer, [{ scale: '0.3', opacity: 0 }, { scale: '1', opacity: 1 }]); go(oldLayer, [{ opacity: 1 }, { opacity: 0 }], { ...opt, duration: dur * 0.7 }); break
    case 'flip': { const half = { ...opt, duration: dur / 2 }; go(oldLayer, [{ transform: 'perspective(1400px) rotateY(0)' }, { transform: 'perspective(1400px) rotateY(-90deg)' }], { ...half, easing: 'ease-in' }); go(newLayer, [{ transform: 'perspective(1400px) rotateY(90deg)', opacity: 0 }, { transform: 'perspective(1400px) rotateY(90deg)', opacity: 0, offset: 0.5 }, { transform: 'perspective(1400px) rotateY(0)', opacity: 1 }], opt); break }
    case 'cube': go(newLayer, [{ transform: `perspective(1600px) translateX(${vx}px) rotateY(${vx > 0 ? 70 : -70}deg)`, opacity: 0.6 }, { transform: 'perspective(1600px) translateX(0) rotateY(0)', opacity: 1 }]); go(oldLayer, [{ transform: 'perspective(1600px) translateX(0) rotateY(0)' }, { transform: `perspective(1600px) translateX(${-vx}px) rotateY(${vx > 0 ? -70 : 70}deg)`, opacity: 0.6 }]); break
    case 'morph': go(newLayer, [{ opacity: 0 }, { opacity: 1 }], { ...opt, duration: dur * 0.9 }); break
    default: break
  }
  return { finished: Promise.all(anims.map((a) => a.finished.catch(() => undefined))).then(() => undefined), cancel: () => anims.forEach((a) => a.cancel()) }
}
