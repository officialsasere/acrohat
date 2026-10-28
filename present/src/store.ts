import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import { type Deck, type El, type Layout, type Slide } from './model'
import { makeDeck, propagateLayout, slideFromLayout } from './themes'

export type Dialog =
  | 'shapes' | 'table' | 'chart' | 'link' | 'image' | 'theme' | 'background' | 'transition' | 'size' | 'find' | 'shortcuts' | 'privacy' | 'about'
  | 'footer' | 'outline' | 'sizePos' | 'altText' | 'chartData' | 'wordCount' | 'importOutline' | 'slideshow' | 'video' | 'crop' | 'exportImages' | 'tableProps' | null
export type Tool = { kind: 'select' } | { kind: 'text' } | { kind: 'shape'; geom: string } | { kind: 'line'; line: 'straight' | 'elbow' | 'curve'; arrow?: boolean }
export type FileKind = 'pptx' | 'pdf' | 'png' | 'html' | 'md' | 'txt'
export type Side = 'format' | 'anim' | 'slide' | null
export type EditTarget = { kind: 'slide' } | { kind: 'layout'; id: string } | { kind: 'master' }

export interface FileMeta { name: string; kind: FileKind | null; handle?: FileSystemFileHandle; path?: string; dirty: boolean }
export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }
export interface Menu { x: number; y: number; items: MenuItem[] }
export type MenuItem = { label: string; run?: () => void; key?: string; checked?: boolean; disabled?: boolean; danger?: boolean } | 'sep'

interface Snapshot { deck: Deck; cur: string; sel: string[] }
export interface FmtState { b: boolean; i: boolean; u: boolean; s: boolean; sz: number | null; f: string | null; c: string | null; hl: string | null; align: string | null; bullet: string | null; base: 1 | -1 | 0; link: string | null }

interface State {
  deck: Deck
  screen: 'home' | 'edit'
  file: FileMeta
  /** Id of the slide being edited. */
  cur: string
  /** Slides selected in the list (for moving and deleting several). */
  slideSel: string[]
  sel: string[]
  target: EditTarget
  tool: Tool
  /** Text being edited in place. */
  editing: { id: string; cell?: { r: number; c: number } } | null
  editor: Editor | null
  fmt: FmtState | null
  /** Cells chosen in a table (for formatting, merging, adding rows). */
  /** Where in the box the user clicked to start typing. */
  editAt: { x: number; y: number } | null
  cellSel: { id: string; r1: number; c1: number; r2: number; c2: number } | null
  zoom: 'fit' | number
  panels: { slides: boolean; notes: boolean; side: Side; grid: boolean; guides: boolean; snap: boolean; rulers: boolean; sorter: boolean }
  past: Snapshot[]
  future: Snapshot[]
  lastKey: string
  lastAt: number
  clip: El[] | null
  clipSlides: Slide[] | null
  dialog: Dialog
  dialogArg?: unknown
  menu: Menu | null
  menuOpen: boolean
  toasts: Toast[]
  theme: 'system' | 'light' | 'dark'
  draftId: string
  findText: string
  /** Chart whose data is being edited, table in the table dialog etc. */
  tick: number
  presenting: null | { from: number; presenter?: boolean }
  set: (p: Partial<State>) => void
  toast: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
  /** Apply a change to the deck as one undo step (changes with the same key close together merge). */
  commit: (label: string, fn: (d: Deck) => Deck, o?: { key?: string; sel?: string[]; cur?: string; keepEditing?: boolean }) => void
  undo: () => void
  redo: () => void
  setDeck: (d: Deck, file?: Partial<FileMeta>) => void
}

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 820px)').matches
let toastId = 1

const initial = (() => { const d = makeDeck('milk'); d.slides.push(slideFromLayout(d, 'title')); return d })()

export const useStore = create<State>((set, get) => ({
  deck: initial,
  screen: 'home',
  file: { name: 'Untitled presentation', kind: null, dirty: false },
  cur: initial.slides[0].id,
  slideSel: [],
  sel: [],
  target: { kind: 'slide' },
  tool: { kind: 'select' },
  editing: null,
  editor: null,
  fmt: null,
  cellSel: null,
  editAt: null,
  zoom: 'fit',
  panels: { slides: true, notes: !phone, side: null, grid: false, guides: false, snap: true, rulers: false, sorter: false },
  past: [],
  future: [],
  lastKey: '',
  lastAt: 0,
  clip: null,
  clipSlides: null,
  dialog: null,
  menu: null,
  menuOpen: false,
  toasts: [],
  theme: (read('kwiiva-present.theme') as State['theme']) || 'system',
  draftId: crypto.randomUUID(),
  findText: '',
  tick: 0,
  presenting: null,
  set: (p) => set(p),
  toast: (kind, text) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  commit: (label, fn, o = {}) => {
    const s = get()
    const next = fn(s.deck)
    if (next === s.deck && !o.sel && !o.cur) return
    const now = Date.now()
    const merge = o.key && o.key === s.lastKey && now - s.lastAt < 900 && s.past.length > 0
    const snap: Snapshot = { deck: s.deck, cur: s.cur, sel: s.sel }
    const cur = o.cur ?? (next.slides.some((x) => x.id === s.cur) ? s.cur : next.slides[Math.min(next.slides.findIndex((x) => x.id === s.cur), next.slides.length - 1)]?.id ?? next.slides[0]?.id ?? s.cur)
    const slide = next.slides.find((x) => x.id === cur) ?? next.slides[0]
    const ids = new Set<string>()
    walkIds(targetEls(next, s.target, slide), ids)
    const sel = (o.sel ?? s.sel).filter((id) => ids.has(id))
    set({
      deck: next,
      cur,
      sel,
      past: merge ? s.past : [...s.past.slice(-199), snap],
      future: [],
      lastKey: o.key ?? '',
      lastAt: now,
      file: s.file.dirty ? s.file : { ...s.file, dirty: true },
      tick: s.tick + 1,
      editing: s.editing && ids.has(s.editing.id) && cur === s.cur ? s.editing : null,
    })
    void label
  },
  undo: () => {
    const s = get()
    const prev = s.past[s.past.length - 1]
    if (!prev) return
    set({ deck: prev.deck, cur: prev.deck.slides.some((x) => x.id === prev.cur) ? prev.cur : prev.deck.slides[0].id, sel: prev.sel, past: s.past.slice(0, -1), future: [{ deck: s.deck, cur: s.cur, sel: s.sel }, ...s.future], editing: null, lastKey: '', file: { ...s.file, dirty: true }, tick: s.tick + 1 })
  },
  redo: () => {
    const s = get()
    const nx = s.future[0]
    if (!nx) return
    set({ deck: nx.deck, cur: nx.deck.slides.some((x) => x.id === nx.cur) ? nx.cur : nx.deck.slides[0].id, sel: nx.sel, past: [...s.past, { deck: s.deck, cur: s.cur, sel: s.sel }], future: s.future.slice(1), editing: null, lastKey: '', file: { ...s.file, dirty: true }, tick: s.tick + 1 })
  },
  setDeck: (d, file) => {
    if (!d.slides.length) d = { ...d, slides: [slideFromLayout(d, 'title')] }
    set({ deck: d, cur: d.slides[0].id, sel: [], slideSel: [], target: { kind: 'slide' }, tool: { kind: 'select' }, editing: null, editor: null, fmt: null, past: [], future: [], lastKey: '', screen: 'edit', dialog: null, draftId: crypto.randomUUID(), file: { name: d.title || 'Untitled presentation', kind: null, dirty: false, ...file }, presenting: null })
  },
}))

const walkIds = (els: El[], out: Set<string>) => { for (const e of els) { out.add(e.id); if (e.type === 'group') walkIds(e.children, out) } }
export const getDeck = () => useStore.getState().deck
export const curSlide = (s = useStore.getState()): Slide => s.deck.slides.find((x) => x.id === s.cur) ?? s.deck.slides[0]
export const curIndex = (s = useStore.getState()) => Math.max(0, s.deck.slides.findIndex((x) => x.id === s.cur))

/** The elements being edited: the slide's, or those of a layout or the master. */
export function targetEls(d: Deck, t: EditTarget, slide: Slide): El[] {
  if (t.kind === 'slide') return slide.els
  if (t.kind === 'master') return d.master.els
  return d.layouts.find((l) => l.id === t.id)?.els ?? []
}
export function setTargetEls(d: Deck, t: EditTarget, slideId: string, fn: (els: El[]) => El[]): Deck {
  if (t.kind === 'slide') {
    let changed = false
    const slides = d.slides.map((s) => { if (s.id !== slideId) return s; const els = fn(s.els); if (els === s.els) return s; changed = true; return { ...s, els } })
    return changed ? { ...d, slides } : d
  }
  if (t.kind === 'master') { const els = fn(d.master.els); return els === d.master.els ? d : { ...d, master: { ...d.master, els } } }
  const next = { ...d, layouts: d.layouts.map((l): Layout => { if (l.id !== t.id) return l; const els = fn(l.els); return els === l.els ? l : { ...l, els } }) }
  return next.layouts.every((l, i) => l === d.layouts[i]) ? d : propagateLayout(d, next, t.id)
}
