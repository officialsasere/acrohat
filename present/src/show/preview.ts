import { curSlide, useStore } from '../store'
import { buildSteps, hideEntrances, playStep, resetStyles } from './anim'

let running = false

/** Play a slide's animations on the editing canvas so you can see them without starting the show. */
export async function previewAnim(only: string | null) {
  if (running) return
  const root = document.querySelector<HTMLElement>('.editing-slide .slide-inner')
  if (!root) return
  const s = useStore.getState()
  const slide = curSlide(s)
  const sub = only ? { ...slide, anims: slide.anims.filter((a) => a.id === only).map((a) => ({ ...a, trigger: 'click' as const })) } : slide
  const steps = buildSteps(sub)
  if (!steps.length) return
  running = true
  root.classList.add('previewing')
  try {
    hideEntrances(root, sub)
    for (const step of steps) {
      await playStep(root, sub, step, s.deck.w, s.deck.h)
      await new Promise((r) => setTimeout(r, 350))
    }
    await new Promise((r) => setTimeout(r, 500))
  } finally {
    resetStyles(root)
    root.classList.remove('previewing')
    running = false
  }
}
