import type { Deck, El, Run, Text, TextStyle } from '../model'

const scaleText = (t: Text | undefined, k: number): Text | undefined => t && { ...t, inset: t.inset?.map((v) => v * k) as Text['inset'], paras: t.paras.map((p) => ({ ...p, before: p.before == null ? undefined : p.before * k, after: p.after == null ? undefined : p.after * k, runs: p.runs.map((r): Run => (r.sz ? { ...r, sz: Math.round(r.sz * k * 10) / 10 } : r)) })) }
const scaleSt = (s: TextStyle | undefined, k: number): TextStyle | undefined => s && { ...s, sz: s.sz ? Math.round(s.sz * k * 10) / 10 : s.sz, before: s.before == null ? undefined : s.before * k, after: s.after == null ? undefined : s.after * k }

function scaleEl(e: El, k: number, ox: number, oy: number): El {
  const base = { ...e, x: e.x * k + ox, y: e.y * k + oy, w: e.w * k, h: e.h * k }
  switch (e.type) {
    case 'shape': return { ...base, text: scaleText(e.text, k), st: scaleSt(e.st, k), line: e.line && { ...e.line, w: e.line.w * k }, shadow: e.shadow && { ...e.shadow, blur: e.shadow.blur * k, dx: e.shadow.dx * k, dy: e.shadow.dy * k } } as El
    case 'line': return { ...base, line: { ...e.line, w: e.line.w * k } } as El
    case 'group': return { ...base, children: e.children.map((c) => scaleEl(c, k, ox, oy)) } as El
    case 'table': return { ...base, cols: e.cols.map((c) => c * k), rows: e.rows.map((r) => ({ ...r, h: r.h * k, cells: r.cells.map((c) => ({ ...c, text: scaleText(c.text, k)! })) })) } as El
    default: return base as El
  }
}

/** Change the slide size; everything is scaled to fit and centred ("ensure fit"). */
export function scaleDeck(d: Deck, w: number, h: number): Deck {
  if (w === d.w && h === d.h) return d
  const k = Math.min(w / d.w, h / d.h)
  const ox = (w - d.w * k) / 2, oy = (h - d.h * k) / 2
  const map = (els: El[]) => els.map((e) => scaleEl(e, k, ox, oy))
  return { ...d, w, h, slides: d.slides.map((s) => ({ ...s, els: map(s.els) })), layouts: d.layouts.map((l) => ({ ...l, els: map(l.els) })), master: { ...d.master, els: map(d.master.els) } }
}
