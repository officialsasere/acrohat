import { bounds, cloneEl, findEl, mapEls, rotBounds, uid, type Anim, type Base, type Deck, type El, type Fill, type GroupEl, type Slide, type Transition } from './model'
import { relayout, slideFromLayout } from './themes'
import { curIndex, curSlide, setTargetEls, targetEls, useStore } from './store'

const S = () => useStore.getState()
export const toast = (kind: 'info' | 'error' | 'success', text: string) => S().toast(kind, text)

// ---------------------------------------------------------------- selection and lookup

export const els = (): El[] => { const s = S(); return targetEls(s.deck, s.target, curSlide(s)) }
export const selected = (): El[] => { const ids = new Set(S().sel); return els().filter((e) => ids.has(e.id)) }
export const select = (ids: string[]) => useStore.setState({ sel: ids })
export const selectAll = () => select(els().map((e) => e.id))

/** Change the current edit target's elements in one undo step. */
export function editEls(label: string, fn: (els: El[]) => El[], o: { key?: string; sel?: string[] } = {}) {
  const s = S()
  s.commit(label, (d) => setTargetEls(d, s.target, s.cur, fn), o)
}
type Patch<T> = Partial<T> | ((e: T) => Partial<T>)
export function updateEls(ids: string[], patch: Patch<Base> | Patch<El>, label = 'Edit', key?: string) {
  const set = new Set(ids)
  editEls(label, (list) => mapEls(list, (e) => (set.has(e.id) ? ({ ...e, ...(typeof patch === 'function' ? (patch as (e: El) => object)(e) : patch) } as El) : e)), { key })
}
export const updateSel = (patch: Patch<Base> | Patch<El>, label = 'Edit', key?: string) => updateEls(S().sel, patch, label, key)

// ---------------------------------------------------------------- slides

export function gotoSlide(id: string) {
  const s = S()
  if (s.cur === id) return
  useStore.setState({ cur: id, sel: [], editing: null, slideSel: [id], target: { kind: 'slide' } })
}
export function gotoIndex(i: number) { const d = S().deck; const sl = d.slides[Math.max(0, Math.min(d.slides.length - 1, i))]; if (sl) gotoSlide(sl.id) }

export function addSlide(layoutId?: string, at?: number) {
  const s = S()
  const here = curSlide(s)
  const lay = layoutId ?? (here.layout === 'title' || here.layout === 'section' ? 'titleBody' : here.layout)
  const slide = slideFromLayout(s.deck, lay)
  const idx = at ?? curIndex(s) + 1
  s.commit('New slide', (d) => ({ ...d, slides: [...d.slides.slice(0, idx), slide, ...d.slides.slice(idx)] }), { cur: slide.id, sel: [] })
  useStore.setState({ slideSel: [slide.id], target: { kind: 'slide' } })
}
export function insertSlides(slides: Slide[], at: number) {
  S().commit('Insert slides', (d) => ({ ...d, slides: [...d.slides.slice(0, at), ...slides, ...d.slides.slice(at)] }), { cur: slides[0]?.id, sel: [] })
  useStore.setState({ slideSel: slides.map((x) => x.id) })
}
export const freshSlide = (sl: Slide): Slide => {
  const c = structuredClone(sl)
  const map = new Map<string, string>()
  c.id = uid('s')
  const renew = (e: El) => { const n = uid(); map.set(e.id, n); e.id = n; if (e.type === 'group') e.children.forEach(renew) }
  c.els.forEach(renew)
  c.anims = c.anims.map((a) => ({ ...a, id: uid('a'), target: map.get(a.target) ?? a.target }))
  return c
}
const slideIds = () => (S().slideSel.length ? S().slideSel : [S().cur])
export function duplicateSlides(ids = slideIds()) {
  const d = S().deck
  const picks = d.slides.filter((x) => ids.includes(x.id))
  if (!picks.length) return
  const last = Math.max(...picks.map((x) => d.slides.indexOf(x)))
  const copies = picks.map(freshSlide)
  S().commit('Duplicate slide', (dk) => ({ ...dk, slides: [...dk.slides.slice(0, last + 1), ...copies, ...dk.slides.slice(last + 1)] }), { cur: copies[0].id, sel: [] })
  useStore.setState({ slideSel: copies.map((c) => c.id) })
}
export function deleteSlides(ids = slideIds()) {
  const d = S().deck
  if (ids.length >= d.slides.length) {
    S().commit('Clear slide', (dk) => ({ ...dk, slides: [slideFromLayout(dk, 'title')] }), { sel: [] })
    const first = S().deck.slides[0]
    useStore.setState({ cur: first.id, slideSel: [first.id] })
    return
  }
  const idx = Math.min(...ids.map((i) => d.slides.findIndex((x) => x.id === i)))
  S().commit('Delete slide', (dk) => ({ ...dk, slides: dk.slides.filter((x) => !ids.includes(x.id)) }), { sel: [] })
  const after = S().deck.slides
  const next = after[Math.min(idx, after.length - 1)]
  useStore.setState({ cur: next.id, slideSel: [next.id], sel: [] })
}
export function moveSlides(ids: string[], to: number) {
  S().commit('Move slides', (d) => {
    const moving = d.slides.filter((x) => ids.includes(x.id))
    const rest = d.slides.filter((x) => !ids.includes(x.id))
    const before = d.slides.slice(0, to).filter((x) => !ids.includes(x.id)).length
    return { ...d, slides: [...rest.slice(0, before), ...moving, ...rest.slice(before)] }
  })
}
export function updateSlide(id: string, patch: Partial<Slide> | ((s: Slide) => Partial<Slide>), label = 'Edit slide', key?: string) {
  S().commit(label, (d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)) }), { key })
}
export const updateCur = (patch: Partial<Slide> | ((s: Slide) => Partial<Slide>), label?: string, key?: string) => updateSlide(S().cur, patch, label, key)
export function setSlideLayout(layoutId: string, ids = slideIds()) {
  S().commit('Layout', (d) => {
    const lay = d.layouts.find((l) => l.id === layoutId)
    if (!lay) return d
    return { ...d, slides: d.slides.map((s) => (ids.includes(s.id) ? relayout(s, lay, d.layouts.find((l) => l.id === s.layout)) : s)) }
  })
}
export function resetSlide() {
  const s = S(), sl = curSlide(s), lay = s.deck.layouts.find((l) => l.id === sl.layout)
  if (!lay) return
  s.commit('Reset slide', (d) => ({ ...d, slides: d.slides.map((x) => (x.id === sl.id ? relayout({ ...x, els: x.els.map((e) => (e.ph ? { ...e, x: -9999 } : e)) }, lay) : x)) }))
}
export const toggleHidden = (ids = slideIds()) => {
  const d = S().deck
  const allHidden = d.slides.filter((x) => ids.includes(x.id)).every((x) => x.hidden)
  S().commit('Hide slide', (dk) => ({ ...dk, slides: dk.slides.map((x) => (ids.includes(x.id) ? { ...x, hidden: !allHidden } : x)) }))
}
export function setTransition(t: Transition | undefined, all = false) {
  const cur = S().cur
  S().commit('Transition', (d) => ({ ...d, slides: d.slides.map((x) => (all || x.id === cur ? { ...x, trans: t && t.kind !== 'none' ? t : undefined } : x)) }))
}
export function setBackground(fill: Fill | undefined, all = false) {
  const s = S()
  if (s.target.kind === 'layout') { const id = s.target.id; s.commit('Background', (d) => ({ ...d, layouts: d.layouts.map((l) => (l.id === id ? { ...l, bg: fill } : l)) })); return }
  if (s.target.kind === 'master') { s.commit('Background', (d) => ({ ...d, master: { ...d.master, bg: fill } })); return }
  s.commit('Background', (d) => ({ ...d, slides: d.slides.map((x) => (all || x.id === s.cur ? { ...x, bg: fill } : x)), ...(all ? { layouts: d.layouts.map((l) => ({ ...l, bg: fill ? undefined : l.bg })), master: { ...d.master, bg: fill ? undefined : d.master.bg } } : {}) }))
}
export const setDeckProp = (patch: Partial<Deck>, label = 'Deck') => S().commit(label, (d) => ({ ...d, ...patch }))

// ---------------------------------------------------------------- elements

export function addEl(el: El) {
  const s = S()
  s.commit('Insert', (d) => setTargetEls(d, s.target, s.cur, (list) => [...list, el]), { sel: [el.id] })
  useStore.setState({ tool: { kind: 'select' } })
}
export function addEls(list: El[]) {
  const s = S()
  s.commit('Insert', (d) => setTargetEls(d, s.target, s.cur, (l) => [...l, ...list]), { sel: list.map((e) => e.id) })
}
export function deleteSel() {
  const ids = new Set(S().sel)
  if (!ids.size) return
  const s = S()
  s.commit('Delete', (d) => {
    const next = setTargetEls(d, s.target, s.cur, (list) => mapEls(list, (e) => (ids.has(e.id) ? null : e)))
    return { ...next, slides: next.slides.map((sl) => (sl.id === s.cur ? { ...sl, anims: sl.anims.filter((a) => !ids.has(a.target)) } : sl)) }
  }, { sel: [] })
}

/** Move an element, taking a group's children along. */
export function translateEl(e: El, dx: number, dy: number): El {
  if (e.type === 'group') return { ...e, x: e.x + dx, y: e.y + dy, children: e.children.map((c) => translateEl(c, dx, dy)) }
  return { ...e, x: e.x + dx, y: e.y + dy }
}
export function nudge(dx: number, dy: number) {
  const ids = new Set(S().sel)
  if (!ids.size) return
  editEls('Move', (list) => mapEls(list, (e) => (ids.has(e.id) ? translateEl(e, dx, dy) : e)), { key: 'nudge' })
}
/** Resize an element to a new box, scaling a group's or table's contents with it. */
export function fitEl(e: El, x: number, y: number, w: number, h: number): El {
  if (e.type === 'group') {
    const kx = e.w ? w / e.w : 1, ky = e.h ? h / e.h : 1
    return { ...e, x, y, w, h, children: e.children.map((c) => fitEl(c, x + (c.x - e.x) * kx, y + (c.y - e.y) * ky, c.w * kx, c.h * ky)) }
  }
  if (e.type === 'table') {
    const kx = e.w ? w / e.w : 1, ky = e.h ? h / e.h : 1
    return { ...e, x, y, w, h, cols: e.cols.map((c) => c * kx), rows: e.rows.map((r) => ({ ...r, h: r.h * ky })) }
  }
  return { ...e, x, y, w, h }
}

export function align(kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', toSlide = false) {
  const list = selected(), d = S().deck
  if (!list.length) return
  const box = toSlide || list.length === 1 ? { x: 0, y: 0, w: d.w, h: d.h } : bounds(list)
  const ids = new Set(list.map((e) => e.id))
  editEls('Align', (all) => all.map((e) => {
    if (!ids.has(e.id)) return e
    const b = rotBounds(e)
    let dx = 0, dy = 0
    if (kind === 'left') dx = box.x - b.x
    else if (kind === 'center') dx = box.x + box.w / 2 - (b.x + b.w / 2)
    else if (kind === 'right') dx = box.x + box.w - (b.x + b.w)
    else if (kind === 'top') dy = box.y - b.y
    else if (kind === 'middle') dy = box.y + box.h / 2 - (b.y + b.h / 2)
    else dy = box.y + box.h - (b.y + b.h)
    return translateEl(e, dx, dy)
  }))
}
export function distribute(axis: 'h' | 'v') {
  const list = selected()
  if (list.length < 3) return
  const items = list.map((e) => ({ e, b: rotBounds(e) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y))
  const first = items[0].b, last = items[items.length - 1].b
  const total = items.reduce((a, i) => a + (axis === 'h' ? i.b.w : i.b.h), 0)
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y
  const gap = (span - total) / (items.length - 1)
  const moves = new Map<string, number>()
  let pos = axis === 'h' ? first.x : first.y
  for (const it of items) { moves.set(it.e.id, pos - (axis === 'h' ? it.b.x : it.b.y)); pos += (axis === 'h' ? it.b.w : it.b.h) + gap }
  editEls('Distribute', (all) => all.map((e) => (moves.has(e.id) ? translateEl(e, axis === 'h' ? moves.get(e.id)! : 0, axis === 'v' ? moves.get(e.id)! : 0) : e)))
}
export function order(op: 'front' | 'back' | 'forward' | 'backward') {
  const ids = new Set(S().sel)
  editEls('Arrange', (all) => {
    const sel = all.filter((e) => ids.has(e.id)), rest = all.filter((e) => !ids.has(e.id))
    if (!sel.length) return all
    if (op === 'front') return [...rest, ...sel]
    if (op === 'back') return [...sel, ...rest]
    const out = [...all]
    if (op === 'forward') { for (let i = out.length - 2; i >= 0; i--) if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]] }
    else { for (let i = 1; i < out.length; i++) if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]] }
    return out
  })
}
export function group() {
  const list = selected()
  if (list.length < 2) return
  const b = bounds(list)
  const g: GroupEl = { id: uid(), type: 'group', x: b.x, y: b.y, w: b.w, h: b.h, children: list }
  const ids = new Set(list.map((e) => e.id))
  const at = els().findIndex((e) => ids.has(e.id))
  editEls('Group', (all) => { const rest = all.filter((e) => !ids.has(e.id)); const pos = Math.min(at, rest.length); return [...rest.slice(0, pos), g, ...rest.slice(pos)] }, { sel: [g.id] })
}
function rotateAbout(c: El, g: GroupEl): El {
  const r = ((g.rot ?? 0) * Math.PI) / 180, gx = g.x + g.w / 2, gy = g.y + g.h / 2
  const cx = c.x + c.w / 2 - gx, cy = c.y + c.h / 2 - gy
  const nx = gx + cx * Math.cos(r) - cy * Math.sin(r), ny = gy + cx * Math.sin(r) + cy * Math.cos(r)
  return { ...c, x: nx - c.w / 2, y: ny - c.h / 2, rot: ((c.rot ?? 0) + (g.rot ?? 0)) % 360 }
}
export function ungroup() {
  const gs = selected().filter((e): e is GroupEl => e.type === 'group')
  if (!gs.length) return
  const ids = new Set(gs.map((g) => g.id))
  const kids = gs.flatMap((g) => g.children.map((c) => (g.rot ? rotateAbout(c, g) : c)))
  editEls('Ungroup', (all) => all.flatMap((e) => (ids.has(e.id) ? kids.filter((k) => (e as GroupEl).children.some((c) => c.id === k.id)) : [e])), { sel: kids.map((k) => k.id) })
}
export function rotateBy(deg: number) { updateSel((e: Base) => ({ rot: (((e.rot ?? 0) + deg) % 360 + 360) % 360 }), 'Rotate') }
export function flip(axis: 'h' | 'v') { updateSel((e: Base) => (axis === 'h' ? { flipH: !e.flipH } : { flipV: !e.flipV }), 'Flip') }
export function lockSel(on: boolean) { updateSel({ locked: on }, 'Lock') }

// ---------------------------------------------------------------- clipboard

export function copySel() {
  const list = selected()
  if (!list.length) return false
  useStore.setState({ clip: structuredClone(list) })
  return true
}
export function cutSel() { if (copySel()) deleteSel() }
export function pasteEls() {
  const clip = S().clip
  if (!clip?.length) return false
  const copies = clip.map((e) => translateEl(cloneEl(e), 18, 18))
  useStore.setState({ clip: copies.map((c) => structuredClone(c)) })
  addEls(copies)
  return true
}
export function duplicateSel() {
  const list = selected()
  if (!list.length) return
  addEls(list.map((e) => translateEl(cloneEl(e), 18, 18)))
}

// ---------------------------------------------------------------- animation

export function addAnim(target: string, a: Partial<Anim> = {}) {
  const anim: Anim = { id: uid('a'), target, effect: 'fade', kind: 'in', trigger: 'click', dur: 0.5, delay: 0, ...a }
  updateCur((s) => ({ anims: [...s.anims, anim] }), 'Animation')
  return anim.id
}
export const updateAnim = (id: string, patch: Partial<Anim>) => updateCur((s) => ({ anims: s.anims.map((a) => (a.id === id ? { ...a, ...patch } : a)) }), 'Animation')
export const removeAnim = (id: string) => updateCur((s) => ({ anims: s.anims.filter((a) => a.id !== id) }), 'Animation')
export function moveAnim(id: string, to: number) {
  updateCur((s) => {
    const i = s.anims.findIndex((a) => a.id === id)
    if (i < 0) return {}
    const list = [...s.anims]
    const [a] = list.splice(i, 1)
    list.splice(Math.max(0, Math.min(list.length, to)), 0, a)
    return { anims: list }
  }, 'Animation')
}

export const anyEl = (id: string) => { const s = S(); return findEl(targetEls(s.deck, s.target, curSlide(s)), id) }
