import { TextSelection } from '@tiptap/pm/state'
import { findEl, mapEls, type BulletKind, type El, type Fill, type Line, type Para, type Run, type Shadow, type ShapeEl, type TableEl, type Text, type TextStyle } from './model'
import { mapRuns, DEFAULT_SIZE, baseSize } from './richtext'
import { selected, editEls, toast } from './actions'
import { curSlide, targetEls, useStore, type FmtState } from './store'

const S = () => useStore.getState()
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96]
const nextSize = (cur: number, dir: 1 | -1) => (dir > 0 ? SIZES.find((s) => s > cur) ?? cur + 8 : [...SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1))

const editedEl = (): El | undefined => { const s = S(); return s.editing ? findEl(targetEls(s.deck, s.target, curSlide(s)), s.editing.id) : undefined }
const styleOfEdited = (): TextStyle | undefined => { const e = editedEl(); return e && e.type === 'shape' ? e.st : undefined }

/** What the toolbar shows: the caret's formatting while typing, otherwise the first selected text's. */
export function fmtOfSelection(): FmtState {
  const s = S()
  if (s.editing && s.fmt) return s.fmt
  const el = selected().find((e) => e.type === 'shape' || e.type === 'table')
  const blank: FmtState = { b: false, i: false, u: false, s: false, sz: null, f: null, c: null, hl: null, align: null, bullet: null, base: 0, link: null }
  if (!el) return blank
  const t = el.type === 'shape' ? el.text : el.type === 'table' ? el.rows[0]?.cells[0]?.text : undefined
  const st = el.type === 'shape' ? el.st : undefined
  const role = el.type === 'shape' ? el.ph?.role : undefined
  const p = t?.paras[0]
  const r = p?.runs.find((x) => x.t !== '\n')
  return { b: r?.b ?? st?.b ?? false, i: r?.i ?? st?.i ?? false, u: !!r?.u, s: !!r?.s, sz: r?.sz ?? baseSize(st, role, p?.level ?? 0), f: r?.f ?? st?.f ?? null, c: r?.c ?? st?.c ?? null, hl: r?.hl ?? null, align: p?.align ?? st?.align ?? 'left', bullet: p?.bullet ?? st?.bullet ?? 'none', base: r?.base ?? 0, link: r?.link ?? null }
}

/** Compute FmtState from an editor's selection (called on every selection change). */
export function fmtFromEditor(ed: import('@tiptap/core').Editor): FmtState {
  const st = styleOfEdited()
  const { from, to, empty } = ed.state.selection
  const marks = empty ? (ed.state.storedMarks ?? ed.state.selection.$from.marks()) : (() => { const ms: import('@tiptap/pm/model').Mark[] = []; ed.state.doc.nodesBetween(from, to, (n) => { if (n.isText && !ms.length) ms.push(...n.marks) }); return ms })()
  const get = (name: string, attr: string) => marks.find((m) => m.type.name === name)?.attrs[attr] as string | undefined
  const $p = ed.state.selection.$from.parent
  const level = $p.attrs.level == null ? 0 : Number($p.attrs.level)
  const tb = get('tbold', 'v'), ti = get('titalic', 'v')
  return {
    b: tb != null ? String(tb) === 'true' : !!st?.b, i: ti != null ? String(ti) === 'true' : !!st?.i,
    u: marks.some((m) => m.type.name === 'underline'), s: marks.some((m) => m.type.name === 'strike'),
    sz: get('tsize', 'sz') != null ? Number(get('tsize', 'sz')) : baseSize(st, (editedEl() as ShapeEl | undefined)?.ph?.role, level),
    f: get('tfont', 'f') ?? st?.f ?? null, c: get('tcolor', 'c') ?? st?.c ?? null, hl: get('thl', 'c') ?? null,
    align: ($p.attrs.align as string | null) ?? st?.align ?? 'left', bullet: ($p.attrs.bullet as string | null) ?? st?.bullet ?? 'none',
    base: marks.some((m) => m.type.name === 'superscript') ? 1 : marks.some((m) => m.type.name === 'subscript') ? -1 : 0,
    link: get('link', 'href') ?? null,
  }
}

type Rewrite = (t: Text, st: TextStyle | undefined, e: El) => Text
/** Rewrite the text of every selected shape and table (all its cells). */
function rewrite(label: string, fn: Rewrite, stPatch?: Partial<TextStyle>) {
  const ids = new Set(S().sel)
  if (!ids.size) return
  editEls(label, (list) => mapEls(list, (e) => {
    if (!ids.has(e.id)) return e
    if (e.type === 'shape') return { ...e, text: fn(e.text ?? { paras: [{ runs: [] }] }, e.st, e), st: stPatch ? { ...e.st, ...stPatch } : e.st }
    if (e.type === 'table') return { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, text: fn(c.text, undefined, e) })) })) } as TableEl
    return e
  }))
}
const eachPara = (t: Text, fn: (p: Para) => Para): Text => ({ ...t, paras: t.paras.map(fn) })

/** Change every paragraph the selection touches in the open editor. */
function editParas(fn: (attrs: Record<string, unknown>) => Record<string, unknown>) {
  const ed = S().editor
  if (!ed) return
  const { state, view } = ed
  const tr = state.tr
  state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => { if (n.type.name === 'paragraph') tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...fn(n.attrs) }) })
  tr.setSelection(TextSelection.create(tr.doc, state.selection.anchor, state.selection.head))
  view.dispatch(tr)
  view.focus()
}

const fmtNow = () => fmtOfSelection()
function runPatch(label: string, patch: Partial<Run>, stPatch?: Partial<TextStyle>) { rewrite(label, (t) => mapRuns(t, (r) => ({ ...r, ...patch })), stPatch) }

export const text = {
  bold() {
    const ed = S().editor, nv = !fmtNow().b
    if (S().editing && ed) { const st = !!styleOfEdited()?.b; if (nv === st) ed.chain().focus().unsetMark('tbold').run(); else ed.chain().focus().setMark('tbold', { v: nv }).run(); return }
    runPatch('Bold', { b: nv }, { b: nv })
  },
  italic() {
    const ed = S().editor, nv = !fmtNow().i
    if (S().editing && ed) { const st = !!styleOfEdited()?.i; if (nv === st) ed.chain().focus().unsetMark('titalic').run(); else ed.chain().focus().setMark('titalic', { v: nv }).run(); return }
    runPatch('Italic', { i: nv }, { i: nv })
  },
  underline() { const ed = S().editor; if (S().editing && ed) ed.chain().focus().toggleUnderline().run(); else runPatch('Underline', { u: !fmtNow().u || undefined }) },
  strike() { const ed = S().editor; if (S().editing && ed) ed.chain().focus().toggleStrike().run(); else runPatch('Strikethrough', { s: !fmtNow().s || undefined }) },
  sup() { const ed = S().editor; if (S().editing && ed) ed.chain().focus().toggleSuperscript().run(); else runPatch('Superscript', { base: fmtNow().base === 1 ? undefined : 1 }) },
  sub() { const ed = S().editor; if (S().editing && ed) ed.chain().focus().toggleSubscript().run(); else runPatch('Subscript', { base: fmtNow().base === -1 ? undefined : -1 }) },
  color(c: string | undefined) {
    const ed = S().editor
    if (S().editing && ed) { if (c) ed.chain().focus().setMark('tcolor', { c }).run(); else ed.chain().focus().unsetMark('tcolor').run(); return }
    runPatch('Text colour', { c }, { c })
  },
  highlight(c: string | undefined) {
    const ed = S().editor
    if (S().editing && ed) { if (c) ed.chain().focus().setMark('thl', { c }).run(); else ed.chain().focus().unsetMark('thl').run(); return }
    runPatch('Highlight', { hl: c })
  },
  font(f: string) {
    const ed = S().editor
    if (S().editing && ed) { ed.chain().focus().setMark('tfont', { f }).run(); return }
    runPatch('Font', { f }, { f })
  },
  size(n: number) {
    n = Math.max(1, Math.min(999, Math.round(n * 10) / 10))
    const ed = S().editor
    if (S().editing && ed) { ed.chain().focus().setMark('tsize', { sz: n }).run(); return }
    runPatch('Font size', { sz: n }, { sz: n })
  },
  sizeStep(dir: 1 | -1) { text.size(nextSize(fmtNow().sz ?? DEFAULT_SIZE, dir)) },
  align(a: NonNullable<Para['align']>) {
    if (S().editing && S().editor) { editParas(() => ({ align: a })); return }
    rewrite('Align text', (t) => eachPara(t, (p) => ({ ...p, align: a })), { align: a })
  },
  bullet(k: BulletKind) {
    const cur = fmtNow().bullet
    const nv: BulletKind = cur === k ? 'none' : k
    if (S().editing && S().editor) { editParas(() => ({ bullet: nv })); return }
    rewrite('Bullets', (t) => eachPara(t, (p) => ({ ...p, bullet: nv })), { bullet: nv })
  },
  indent(d: 1 | -1) {
    const bump = (lvl: number | undefined) => Math.max(0, Math.min(8, (lvl ?? 0) + d))
    if (S().editing && S().editor) { editParas((a) => ({ level: bump(a.level == null ? 0 : Number(a.level)) })); return }
    rewrite('Indent', (t) => eachPara(t, (p) => ({ ...p, level: bump(p.level) })))
  },
  lineHeight(lh: number | null) {
    if (S().editing && S().editor) { editParas(() => ({ lh })); return }
    rewrite('Line spacing', (t) => eachPara(t, (p) => ({ ...p, lh: lh ?? undefined })))
  },
  spacing(before: number | null, after: number | null) {
    if (S().editing && S().editor) { editParas(() => ({ before, after })); return }
    rewrite('Paragraph spacing', (t) => eachPara(t, (p) => ({ ...p, before: before ?? undefined, after: after ?? undefined })))
  },
  link(url: string | null) {
    const ed = S().editor
    if (S().editing && ed) { if (url) ed.chain().focus().setLink({ href: url }).run(); else ed.chain().focus().unsetLink().run(); return }
    runPatch('Link', { link: url ?? undefined })
  },
  clear() {
    const ed = S().editor
    if (S().editing && ed) { ed.chain().focus().unsetAllMarks().run(); return }
    rewrite('Clear formatting', (t) => ({ ...t, paras: t.paras.map((p) => ({ ...p, runs: p.runs.map((r) => (r.t === '\n' ? r : { t: r.t, link: r.link })) })) }))
  },
}

// ---------------------------------------------------------------- shape appearance

type Styled = ShapeEl
const shapes = () => selected().filter((e): e is Styled => e.type === 'shape')
function patchSel(label: string, fn: (e: El) => El | null, key?: string) {
  const ids = new Set(S().sel)
  editEls(label, (list) => mapEls(list, (e) => (ids.has(e.id) ? fn(e) : e)), { key })
}
export const style = {
  fill(f: Fill | undefined) { patchSel('Fill', (e) => (e.type === 'shape' ? { ...e, fill: f } : e.type === 'table' ? { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, fill: f })) })) } : e), 'fill') },
  line(patch: Partial<Line> | null) {
    patchSel('Outline', (e) => {
      if (e.type === 'shape' || e.type === 'image') { if (patch === null) return { ...e, line: undefined }; const cur = e.line ?? { c: '@text', w: 0 }; const next = { ...cur, ...patch }; if (patch.c && !cur.w) next.w = 1.5; return { ...e, line: next } }
      if (e.type === 'line') return { ...e, line: { ...e.line, ...(patch ?? {}) } }
      return e
    }, 'line')
  },
  shadow(s: Shadow | undefined) { patchSel('Shadow', (e) => (e.type === 'shape' || e.type === 'image' || e.type === 'line' ? { ...e, shadow: s } : e), 'shadow') },
  opacity(v: number) { patchSel('Transparency', (e) => (e.type === 'shape' || e.type === 'image' ? { ...e, opacity: v } : e), 'opacity') },
  geom(g: string) { patchSel('Change shape', (e) => (e.type === 'shape' ? { ...e, geom: g, adj: undefined } : e)) },
  adj(i: number, v: number) { patchSel('Adjust shape', (e) => (e.type === 'shape' ? { ...e, adj: Object.assign([...(e.adj ?? [])], { [i]: v }) } : e), 'adj') },
  vAlign(v: 'top' | 'middle' | 'bottom') { patchSel('Vertical align', (e) => (e.type === 'shape' ? { ...e, text: { ...(e.text ?? { paras: [{ runs: [] }] }), v } } : e)) },
  fit(v: 'none' | 'shrink') { patchSel('Text fit', (e) => (e.type === 'shape' ? { ...e, text: { ...(e.text ?? { paras: [{ runs: [] }] }), fit: v } } : e)) },
  inset(i: [number, number, number, number]) { patchSel('Margins', (e) => (e.type === 'shape' ? { ...e, text: { ...(e.text ?? { paras: [{ runs: [] }] }), inset: i } } : e)) },
  wrap(w: boolean) { patchSel('Wrap', (e) => (e.type === 'shape' ? { ...e, text: { ...(e.text ?? { paras: [{ runs: [] }] }), wrap: w } } : e)) },
  columns(n: number) { patchSel('Columns', (e) => (e.type === 'shape' ? { ...e, text: { ...(e.text ?? { paras: [{ runs: [] }] }), cols: n } } : e)) },
  link(url: string | null, slide?: string) { patchSel('Link', (e) => ({ ...e, link: url || slide ? { url: url ?? undefined, slide } : undefined })) },
  alt(t: string) { patchSel('Alt text', (e) => ({ ...e, alt: t }), 'alt') },
}
let painted: { fill?: Fill; line?: Line; shadow?: Shadow; st?: TextStyle } | null = null
export function copyFormat() { const e = shapes()[0]; if (!e) return; painted = { fill: e.fill, line: e.line, shadow: e.shadow, st: e.st }; toast('info', 'Formatting copied. Select another shape and use Edit → Paste formatting.') }
export function pasteFormat() { if (!painted) return toast('info', 'Copy formatting from a shape first (Edit → Copy formatting).'); const p = painted; patchSel('Paste formatting', (e) => (e.type === 'shape' ? { ...e, fill: p.fill, line: p.line, shadow: p.shadow } : e)) }

