import { useEffect, useMemo, useState } from 'react'
import { useStore, curSlide, type Dialog } from '../store'
import { selected, setBackground, setDeckProp, setTransition, updateSel, toast, insertSlides } from '../actions'
import { style, text as fmt } from '../format'
import { insertChart, insertTable, newTextBox, pickFiles, symbolToEditor } from '../insert'
import { slideFromLayout, THEMES, applyTheme } from '../themes'
import { SIZES, hexToRgb, textOf, mapEls, walk, type ChartEl, type Deck, type El, type ShapeEl } from '../model'
import { Thumb } from '../render/Thumb'
import { ChartView } from '../render/Chart'
import { addEl } from '../actions'
import { deckToOutline, applyOutline, outlineToSlides, parseOutline } from '../formats/outline'
import { wordCount } from '../richtext'
import { exportAs, newDeck } from '../lib/files'
import { scaleDeck } from '../lib/resize'
import { exportAllPng } from '../lib/raster'
import { buildTemplate } from '../templates'
import { FillEditor } from './SidePanel'
import { TRANS } from './SidePanel'
import { Field, Modal, Num, Seg } from './ui'
import { K } from '../menus'

const close = () => useStore.setState({ dialog: null, dialogArg: undefined })
const S = () => useStore.getState()

const SYMBOLS = '© ® ™ § ¶ † ‡ • ‣ … – — ‘ ’ “ ” « » ¡ ¿ ° ± × ÷ ≈ ≠ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ π Ω µ α β γ δ ε θ λ σ φ ψ ω ← → ↑ ↓ ↔ ⇒ ⇔ ✓ ✗ ★ ☆ ♥ ♦ ♣ ♠ ☀ ☁ ☂ ☎ ✉ ✂ ✈ € £ ¥ ¢ ₹ ₩ ₽ ½ ¼ ¾ ² ³ ¹ ⁰ ₀ ₁ ₂'.split(' ')

function SymbolPicker() {
  return (
    <Modal title="Insert a symbol" onClose={close}>
      <div className="sym-grid">{SYMBOLS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => { if (S().editor) symbolToEditor(c); else { const t = newTextBox(400, 240, 80, 60); t.text = { paras: [{ runs: [{ t: c }] }] }; t.st = { sz: 40, c: '@text', f: '+body', align: 'center' }; addEl(t) } close() }}>{c}</button>)}</div>
    </Modal>
  )
}

function TableDialog() {
  const [r, setR] = useState(4), [c, setC] = useState(4)
  return (
    <Modal title="Insert table" onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" onClick={() => { close(); insertTable(r, c) }}>Insert</button></>}>
      <div className="row"><Field label="Columns"><Num label="Columns" min={1} max={12} value={c} onChange={setC} /></Field><Field label="Rows"><Num label="Rows" min={1} max={30} value={r} onChange={setR} /></Field></div>
    </Modal>
  )
}

function LinkDialog() {
  const s = S()
  const el = selected()[0]
  const editing = !!s.editing
  const [url, setUrl] = useState(el?.link?.url ?? s.fmt?.link ?? '')
  const [slide, setSlide] = useState(el?.link?.slide ?? '')
  const apply = () => {
    close()
    const u = url.trim()
    const href = u && !/^[a-z]+:|^#|^mailto:/i.test(u) ? `https://${u}` : u
    if (editing) fmt.link(href || null); else style.link(href || null, slide || undefined)
  }
  return (
    <Modal title={editing ? 'Link for the selected text' : 'Link for the selected object'} onClose={close} actions={<><button type="button" onClick={() => { close(); if (editing) fmt.link(null); else style.link(null) }}>Remove link</button><button type="button" className="primary" onClick={apply}>Apply</button></>}>
      <Field label="Web address or email"><input autoFocus aria-label="Web address" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} /></Field>
      {!editing && <Field label="Or jump to a slide"><select aria-label="Slide to jump to" value={slide} onChange={(e) => setSlide(e.target.value)}><option value="">None</option>{S().deck.slides.map((x, i) => <option key={x.id} value={x.id}>{i + 1}. {textOf((x.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'title'))?.text).slice(0, 40) || 'Slide'}</option>)}</select></Field>}
      <p className="hint">Links work in the slide show and in the exported web page. In a .pptx they are kept as links.</p>
    </Modal>
  )
}

function ThemeDialog() {
  const deck = S().deck
  return (
    <Modal title="Choose a theme" wide onClose={close}>
      <p className="hint">A theme sets colours, fonts and the look of every layout. Your text and pictures stay as they are.</p>
      <div className="theme-gallery">
        {THEMES.map((t) => {
          const d = applyTheme({ ...deck, slides: [slideFromLayout(deck, 'titleBody'), slideFromLayout(deck, 'title')].map((sl) => ({ ...sl, els: sl.els.map((e) => (e.type === 'shape' && e.ph ? { ...e, text: { paras: [{ runs: [{ t: e.ph.role === 'title' ? 'Title' : e.ph.role === 'subtitle' ? 'Subtitle' : 'Body text' }] }] } } : e)) })) }, t.id)
          return (
            <button key={t.id} type="button" className={'theme-card' + (deck.theme.id === t.id ? ' on' : '')} onClick={() => { S().commit('Theme', (dk) => applyTheme(dk, t.id)); close() }}>
              <Thumb deck={d} slide={d.slides[0]} width={170} /><span>{t.name}</span>
              <span className="chips">{(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((a) => <i key={a} style={{ background: t.colors[a] }} />)}</span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

function BackgroundDialog() {
  const sl = curSlide()
  const [fill, setFill] = useState(sl.bg)
  return (
    <Modal title="Slide background" onClose={close} actions={<><button type="button" onClick={() => { setBackground(fill, true); close() }}>Apply to all slides</button><button type="button" className="primary" onClick={() => { setBackground(fill); close() }}>Apply to this slide</button></>}>
      <FillEditor fill={fill} noneLabel="From theme" onChange={setFill} />
    </Modal>
  )
}

function TransitionDialog() {
  const sl = curSlide()
  const [kind, setKind] = useState(sl.trans?.kind ?? 'none')
  const [dur, setDur] = useState(sl.trans?.dur ?? 0.7)
  const [dir, setDir] = useState(sl.trans?.dir ?? 'left')
  const t = { kind, dur, dir }
  return (
    <Modal title="Slide transition" onClose={close} actions={<><button type="button" onClick={() => { setTransition(t, true); close() }}>Apply to all slides</button><button type="button" className="primary" onClick={() => { setTransition(t); close() }}>Apply to this slide</button></>}>
      <div className="trans-grid">{TRANS.map((x) => <button key={x.v} type="button" className={kind === x.v ? 'on' : ''} onClick={() => setKind(x.v)}>{x.label}</button>)}</div>
      <div className="row"><Field label="Duration (seconds)"><Num label="Duration" min={0.1} max={5} step={0.1} value={dur} onChange={setDur} /></Field>
        <Field label="Direction"><select aria-label="Direction" value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}><option value="left">From right</option><option value="right">From left</option><option value="up">From bottom</option><option value="down">From top</option></select></Field></div>
      <p className="hint">The transition plays when moving onto this slide. “Morph” glides matching shapes (same name or text) from where they were.</p>
    </Modal>
  )
}

function SizeDialog() {
  const deck = S().deck
  const [w, setW] = useState(deck.w), [h, setH] = useState(deck.h)
  return (
    <Modal title="Slide size" onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" onClick={() => { S().commit('Slide size', (d) => scaleDeck(d, w, h)); close() }}>Apply</button></>}>
      <div className="chip-row">{Object.entries(SIZES).map(([k, v]) => <button key={k} type="button" className={w === v.w && h === v.h ? 'on' : ''} onClick={() => { setW(v.w); setH(v.h) }}>{v.label}</button>)}</div>
      <div className="row"><Field label="Width (points)"><Num label="Width" min={200} max={2400} value={w} onChange={setW} /></Field><Field label="Height (points)"><Num label="Height" min={200} max={2400} value={h} onChange={setH} /></Field></div>
      <p className="hint">Everything is scaled to fit and centred. 72 points = 1 inch. Widescreen is 960 × 540.</p>
    </Modal>
  )
}

interface Hit { slide: string; id: string; text: string; where: string }
function FindDialog() {
  const deck = useStore((s) => s.deck)
  const [q, setQ] = useState(S().findText)
  const [rep, setRep] = useState('')
  const [cs, setCs] = useState(false)
  const [notes, setNotes] = useState(true)
  const hits = useMemo<Hit[]>(() => {
    if (!q) return []
    const out: Hit[] = []
    const norm = (s: string) => (cs ? s : s.toLowerCase())
    deck.slides.forEach((sl, i) => {
      walk(sl.els, (e) => {
        const texts = e.type === 'shape' ? [textOf(e.text)] : e.type === 'table' ? e.rows.flatMap((r) => r.cells.map((c) => textOf(c.text))) : []
        for (const t of texts) if (norm(t).includes(norm(q))) out.push({ slide: sl.id, id: e.id, text: t.replace(/\s+/g, ' ').slice(0, 70), where: `Slide ${i + 1}` })
      })
      if (notes && norm(sl.notes).includes(norm(q))) out.push({ slide: sl.id, id: '', text: sl.notes.replace(/\s+/g, ' ').slice(0, 70), where: `Slide ${i + 1} notes` })
    })
    return out
  }, [deck, q, cs, notes])
  const re = useMemo(() => new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? 'g' : 'gi'), [q, cs])
  const replaceAll = () => {
    if (!q) return
    let n = 0
    const sub = (t: string) => t.replace(re, () => { n++; return rep })
    const mapText = (t: import('../model').Text) => ({ ...t, paras: t.paras.map((p) => ({ ...p, runs: p.runs.map((r) => (r.t === '\n' ? r : { ...r, t: sub(r.t) })) })) })
    S().commit('Replace all', (d) => ({ ...d, slides: d.slides.map((sl) => ({ ...sl, notes: notes ? sub(sl.notes) : sl.notes, els: mapEls(sl.els, (e) => (e.type === 'shape' && e.text ? { ...e, text: mapText(e.text) } : e.type === 'table' ? { ...e, rows: e.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, text: mapText(c.text) })) })) } : e)) })) }))
    toast('success', n ? `Replaced ${n} ${n === 1 ? 'match' : 'matches'}.` : 'Nothing to replace.')
  }
  return (
    <Modal title="Find and replace" onClose={close} actions={<><button type="button" disabled={!hits.length} onClick={replaceAll}>Replace all</button><button type="button" onClick={close}>Done</button></>}>
      <div className="row"><Field label="Find"><input autoFocus aria-label="Find" value={q} onChange={(e) => { setQ(e.target.value); useStore.setState({ findText: e.target.value }) }} /></Field><Field label="Replace with"><input aria-label="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} /></Field></div>
      <div className="row"><label className="inline"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label><label className="inline"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Include speaker notes</label></div>
      <div className="find-list" role="list" aria-label="Matches">{q && !hits.length && <p className="hint">Nothing found.</p>}{hits.slice(0, 80).map((h, i) => <button key={i} type="button" role="listitem" onClick={() => { useStore.setState({ cur: h.slide, sel: h.id ? [h.id] : [], slideSel: [h.slide], target: { kind: 'slide' } }); }}><b>{h.where}</b> {h.text}</button>)}</div>
      {hits.length > 0 && <p className="hint">{hits.length} {hits.length === 1 ? 'match' : 'matches'}. Matches that cross a change of formatting inside one sentence are not found.</p>}
    </Modal>
  )
}

function SizePosDialog() {
  const el = selected()[0]
  if (!el) return null
  return (
    <Modal title="Size and position" onClose={close} actions={<button type="button" className="primary" onClick={close}>Done</button>}>
      <div className="row"><Field label="X"><Num label="X" value={el.x} onChange={(v) => updateSel({ x: v } as never, 'Position', 'pos')} /></Field><Field label="Y"><Num label="Y" value={el.y} onChange={(v) => updateSel({ y: v } as never, 'Position', 'pos')} /></Field></div>
      <div className="row"><Field label="Width"><Num label="Width" min={1} value={el.w} onChange={(v) => updateSel({ w: v } as never, 'Size', 'pos')} /></Field><Field label="Height"><Num label="Height" min={1} value={el.h} onChange={(v) => updateSel({ h: v } as never, 'Size', 'pos')} /></Field><Field label="Rotation"><Num label="Rotation" min={0} max={360} value={el.rot ?? 0} onChange={(v) => updateSel({ rot: v } as never, 'Rotate', 'pos')} /></Field></div>
    </Modal>
  )
}

function AltDialog() {
  const el = selected()[0]
  const [t, setT] = useState(el?.alt ?? '')
  return (
    <Modal title="Alt text" onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" onClick={() => { style.alt(t); close() }}>Save</button></>}>
      <p className="hint">Describe what this shows, in a sentence, for people who use a screen reader.</p>
      <textarea autoFocus rows={4} aria-label="Alt text" value={t} onChange={(e) => setT(e.target.value)} />
    </Modal>
  )
}

function ChartDataDialog() {
  const chart = selected().find((e): e is ChartEl => e.type === 'chart')
  const [c, setC] = useState<ChartEl | undefined>(chart)
  if (!chart || !c) return null
  const scatter = c.kind === 'scatter'
  const rows = Math.max(c.cats.length, ...c.series.map((s) => s.vals.length), scatter ? Math.max(0, ...c.series.map((s) => s.xs?.length ?? 0)) : 0)
  const set = (p: Partial<ChartEl>) => setC({ ...c, ...p })
  const setCell = (r: number, col: number, v: string) => {
    if (col === 0) { const cats = [...c.cats]; while (cats.length <= r) cats.push(''); cats[r] = v; set({ cats }); return }
    const si = col - 1
    const n = v.trim() === '' ? 0 : parseFloat(v.replace(/,/g, ''))
    set({ series: c.series.map((s, i) => { if (i !== si) return s; const vals = [...s.vals]; while (vals.length <= r) vals.push(0); vals[r] = Number.isFinite(n) ? n : 0; return { ...s, vals } }) })
  }
  const paste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const t = e.clipboardData.getData('text/plain')
    if (!t.includes('\t') && !t.includes('\n')) return
    e.preventDefault()
    const lines = t.replace(/\r/g, '').split('\n').filter((l) => l.length).map((l) => l.split('\t'))
    const head = lines[0]
    const numeric = head.slice(1).every((x) => Number.isFinite(parseFloat(x)))
    const body = numeric ? lines : lines.slice(1)
    const names = numeric ? head.slice(1).map((_, i) => `Series ${i + 1}`) : head.slice(1)
    set({ cats: body.map((l) => l[0] ?? ''), series: names.map((n, i) => ({ name: n, color: c.series[i]?.color, vals: body.map((l) => { const v = parseFloat((l[i + 1] ?? '').replace(/,/g, '')); return Number.isFinite(v) ? v : 0 }) })) })
  }
  return (
    <Modal title="Chart data" wide onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" onClick={() => { updateSel({ cats: c.cats, series: c.series } as never, 'Chart data'); close() }}>Apply</button></>}>
      <div className="chart-edit">
        <div className="data-scroll">
          <table className="data-grid" aria-label="Chart data">
            <thead><tr><th>{scatter ? 'X' : 'Category'}</th>{c.series.map((s, i) => <th key={i}><input aria-label={`Series ${i + 1} name`} value={s.name} onChange={(e) => set({ series: c.series.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></th>)}</tr></thead>
            <tbody>{Array.from({ length: rows }, (_, r) => <tr key={r}>
              <td><input aria-label={`Category ${r + 1}`} value={scatter ? c.series[0]?.xs?.[r] ?? '' : c.cats[r] ?? ''} onChange={(e) => scatter ? set({ series: c.series.map((s) => { const xs = [...(s.xs ?? s.vals.map((_, i) => i + 1))]; xs[r] = parseFloat(e.target.value) || 0; return { ...s, xs } }) }) : setCell(r, 0, e.target.value)} /></td>
              {c.series.map((s, i) => <td key={i}><input aria-label={`Row ${r + 1} ${s.name}`} inputMode="decimal" value={s.vals[r] ?? ''} onChange={(e) => setCell(r, i + 1, e.target.value)} /></td>)}</tr>)}</tbody>
          </table>
        </div>
        <div className="chip-row">
          <button type="button" onClick={() => set({ cats: [...c.cats, `Item ${rows + 1}`], series: c.series.map((s) => ({ ...s, vals: [...s.vals, 0], xs: s.xs ? [...s.xs, (s.xs[s.xs.length - 1] ?? 0) + 1] : undefined })) })}>+ Row</button>
          <button type="button" disabled={rows <= 1} onClick={() => set({ cats: c.cats.slice(0, -1), series: c.series.map((s) => ({ ...s, vals: s.vals.slice(0, -1), xs: s.xs?.slice(0, -1) })) })}>− Row</button>
          <button type="button" onClick={() => set({ series: [...c.series, { name: `Series ${c.series.length + 1}`, vals: Array.from({ length: rows }, () => 0), xs: scatter ? c.series[0]?.xs : undefined }] })}>+ Series</button>
          <button type="button" disabled={c.series.length <= 1} onClick={() => set({ series: c.series.slice(0, -1) })}>− Series</button>
        </div>
        <label className="field"><span>Paste from a spreadsheet (first row = series names, first column = categories)</span><textarea rows={2} aria-label="Paste data" placeholder="Paste here" onPaste={paste} onChange={() => undefined} value="" /></label>
        <div className="chart-preview"><ChartView chart={{ ...c, w: 380, h: 230 }} th={S().deck.theme} /></div>
      </div>
    </Modal>
  )
}

function CropDialog() {
  const el = selected().find((e) => e.type === 'image')
  const deck = S().deck
  const [crop, setCrop] = useState(el && el.type === 'image' ? el.crop ?? { l: 0, t: 0, r: 0, b: 0 } : { l: 0, t: 0, r: 0, b: 0 })
  if (!el || el.type !== 'image') return null
  const src = deck.media[el.media]?.data
  const side = (k: 'l' | 't' | 'r' | 'b', label: string) => <div className="row"><span style={{ width: 60 }}>{label}</span><input type="range" aria-label={`Crop ${label}`} min={0} max={80} value={Math.round(crop[k] * 100)} onChange={(e) => setCrop({ ...crop, [k]: Number(e.target.value) / 100 })} /><span>{Math.round(crop[k] * 100)}%</span></div>
  const apply = () => {
    close()
    const kx = 1 - crop.l - crop.r, ky = 1 - crop.t - crop.b
    const old = el.crop ?? { l: 0, t: 0, r: 0, b: 0 }
    // Keep the visible picture the same size on the slide: grow or shrink the box with the crop.
    const ow = el.w / (1 - old.l - old.r), oh = el.h / (1 - old.t - old.b)
    updateSel({ crop, w: Math.max(8, ow * kx), h: Math.max(8, oh * ky), x: el.x + (crop.l - old.l) * ow, y: el.y + (crop.t - old.t) * oh } as never, 'Crop')
  }
  return (
    <Modal title="Crop picture" onClose={close} actions={<><button type="button" onClick={() => setCrop({ l: 0, t: 0, r: 0, b: 0 })}>Reset</button><button type="button" className="primary" onClick={apply}>Apply</button></>}>
      <div className="crop-preview"><div style={{ position: 'relative', display: 'inline-block' }}><img src={src} alt="" style={{ maxWidth: '100%', maxHeight: 260, display: 'block' }} /><div className="crop-box" style={{ left: `${crop.l * 100}%`, top: `${crop.t * 100}%`, right: `${crop.r * 100}%`, bottom: `${crop.b * 100}%` }} /></div></div>
      {side('l', 'Left')}{side('r', 'Right')}{side('t', 'Top')}{side('b', 'Bottom')}
    </Modal>
  )
}

function FooterDialog() {
  const deck = S().deck
  const [f, setF] = useState(deck.footer)
  const [loop, setLoop] = useState(deck.show.loop)
  const [timings, setTimings] = useState(deck.show.useTimings)
  return (
    <Modal title="Presentation settings" onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" onClick={() => { setDeckProp({ footer: f, show: { loop, useTimings: timings } }, 'Settings'); close() }}>Apply</button></>}>
      <div className="menu-label">On every slide</div>
      <label className="check"><input type="checkbox" checked={f.num} onChange={(e) => setF({ ...f, num: e.target.checked })} /> Slide number</label>
      <label className="check"><input type="checkbox" checked={f.date} onChange={(e) => setF({ ...f, date: e.target.checked })} /> Today’s date</label>
      <Field label="Footer text"><input aria-label="Footer text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
      <div className="menu-label">Slide show</div>
      <label className="check"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop until Esc is pressed</label>
      <label className="check"><input type="checkbox" checked={timings} onChange={(e) => setTimings(e.target.checked)} /> Use the “advance after” timings of slides</label>
    </Modal>
  )
}

function OutlineDialog() {
  const [src, setSrc] = useState(() => deckToOutline(S().deck))
  return (
    <Modal title="Outline" wide onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" onClick={() => { const parsed = parseOutline(src); S().commit('Outline', (d) => applyOutline(d, parsed)); close() }}>Apply to slides</button></>}>
      <p className="hint"><code>#</code> starts a slide, <code>-</code> is a bullet (indent for a sub-bullet), <code>&gt;</code> is a speaker note, <code>---</code> separates slides. Applying changes the title and text of each slide in order, and adds slides for new entries; pictures and shapes are kept.</p>
      <textarea className="outline-edit" aria-label="Outline" spellCheck rows={16} value={src} onChange={(e) => setSrc(e.target.value)} />
    </Modal>
  )
}

function ImportOutlineDialog() {
  const [src, setSrc] = useState('# My talk\nA short subtitle\n\n---\n\n# First point\n- One thing\n- Another thing\n  - A detail\n> Say this out loud\n')
  const [theme, setTheme] = useState('milk')
  const load = async () => { const [f] = await pickFiles('.md,.txt,text/plain,text/markdown'); if (f) setSrc(await f.text()) }
  const make = (mode: 'new' | 'append') => {
    const parsed = parseOutline(src)
    if (!parsed.length) return toast('error', 'Nothing to turn into slides. Start a line with # for each slide title.')
    close()
    if (mode === 'new') {
      const base = buildTemplate('blank'); base.slides = []
      const d: Deck = applyTheme(base, theme)
      d.slides = outlineToSlides(d, parsed, true)
      d.title = parsed[0].title || 'Untitled presentation'
      S().setDeck(d, { name: d.title, kind: null, dirty: true })
    } else insertSlides(outlineToSlides(S().deck, parsed), S().deck.slides.length)
  }
  return (
    <Modal title="Make slides from an outline" wide onClose={close} actions={<><button type="button" onClick={() => make('append')}>Add to this presentation</button><button type="button" className="primary" onClick={() => make('new')}>Create a new presentation</button></>}>
      <div className="row"><button type="button" onClick={() => void load()}>Open a .md or .txt file…</button><Field label="Theme for a new presentation"><select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
      <textarea className="outline-edit" aria-label="Outline text" rows={14} value={src} onChange={(e) => setSrc(e.target.value)} />
    </Modal>
  )
}

function WordCountDialog() {
  const deck = S().deck
  let words = 0, shapes = 0, notesWords = 0, pics = 0
  for (const s of deck.slides) { notesWords += s.notes.split(/\s+/).filter(Boolean).length; walk(s.els, (e: El) => { shapes++; if (e.type === 'shape' && e.text) words += wordCount(e.text); if (e.type === 'table') for (const r of e.rows) for (const c of r.cells) words += wordCount(c.text); if (e.type === 'image') pics++ }) }
  return (
    <Modal title="Word count" onClose={close} actions={<button type="button" className="primary" onClick={close}>Close</button>}>
      <table className="keys"><tbody>
        <tr><td>Slides</td><td>{deck.slides.length}</td></tr><tr><td>Words on slides</td><td>{words}</td></tr><tr><td>Words in speaker notes</td><td>{notesWords}</td></tr><tr><td>Objects</td><td>{shapes}</td></tr><tr><td>Pictures</td><td>{pics}</td></tr>
        <tr><td>Typical speaking time at 130 words a minute</td><td>{Math.max(1, Math.round((words + notesWords) / 130))} min</td></tr>
      </tbody></table>
    </Modal>
  )
}

function ExportImagesDialog() {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Export every slide as pictures" onClose={close} actions={<><button type="button" onClick={close}>Cancel</button><button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); try { await exportAllPng(); close() } catch (e) { toast('error', (e as Error).message) } finally { setBusy(false) } }}>{busy ? 'Working…' : 'Download .zip'}</button></>}>
      <p>Each slide becomes a PNG picture at 1920 pixels wide, collected in one .zip file.</p>
      <p className="hint">Pictures are drawn by your browser, so a font that is not installed on this device is replaced by a similar one.</p>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['New slide', K('Ctrl+M')], ['Undo / Redo', `${K('Ctrl+Z')} / ${K('Ctrl+Y')}`], ['Copy / Cut / Paste', `${K('Ctrl+C')} / ${K('Ctrl+X')} / ${K('Ctrl+V')}`], ['Duplicate', K('Ctrl+D')], ['Group / Ungroup', `${K('Ctrl+G')} / ${K('Ctrl+Shift+G')}`],
  ['Bold / Italic / Underline', `${K('Ctrl+B')} / ${K('Ctrl+I')} / ${K('Ctrl+U')}`], ['Align left / centre / right / justify', `${K('Ctrl+L')} / ${K('Ctrl+E')} / ${K('Ctrl+R')} / ${K('Ctrl+J')}`], ['Bigger / smaller text', `${K('Ctrl+]')} / ${K('Ctrl+[')}`], ['Edit the text of the selected shape', 'Enter or F2'], ['Stop editing text', 'Esc'], ['Indent / outdent a bullet', 'Tab / Shift+Tab'],
  ['Move selected objects', 'Arrow keys (Shift = 10×)'], ['Next object', 'Tab'], ['Select all', K('Ctrl+A')], ['Find and replace', K('Ctrl+F')], ['Save', K('Ctrl+S')], ['Open', K('Ctrl+O')],
  ['Start the slide show', 'F5'], ['Slide show from this slide', K('Shift+F5')], ['Next / previous in the show', '→ ← Space Backspace'], ['Go to slide', 'type a number, Enter'], ['Black / white screen', 'B / W'], ['Laser pointer', 'L'], ['Pen / highlighter / eraser', `${K('Ctrl+P')} / ${K('Ctrl+I')} / ${K('Ctrl+E')}`], ['All slides in the show', 'G'], ['End the show', 'Esc'],
]
function ShortcutsDialog() {
  return <Modal title="Keyboard shortcuts" onClose={close}><table className="keys"><tbody>{SHORTCUTS.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table></Modal>
}
function PrivacyDialog() {
  return (
    <Modal title="Privacy" onClose={close} actions={<button type="button" className="primary" onClick={close}>Close</button>}>
      <p>Your presentations stay on your device. Kwiiva Present keeps a copy in this browser as you work (in IndexedDB) and writes files only where you save them. Nothing is uploaded.</p>
      <p>The only thing sent is an anonymous count: that the app was opened, and that an installer was downloaded. It contains no file, name, address or identifier of you, and it is what the public usage numbers on the Kwiiva website are made of. You can turn it off with “Do Not Track” in your browser.</p>
    </Modal>
  )
}
function AboutDialog() {
  return (
    <Modal title="Kwiiva Present" onClose={close} actions={<button type="button" className="primary" onClick={close}>Close</button>}>
      <p>Free, open-source presentations. Part of Kwiiva, with Paper, Write and Grid. Version 0.1.0.</p>
      <p>Source and licences: <a href="https://github.com/officialsasere/kwiiva" target="_blank" rel="noopener noreferrer">github.com/officialsasere/kwiiva</a>.</p>
    </Modal>
  )
}
function ShapesDialog() {
  const arg = S().dialogArg
  if (arg === 'symbols') return <SymbolPicker />
  return null
}
function ChartKindDialog() {
  const kinds: [string, ChartEl['kind'], ChartEl['grouping']?][] = [['Column', 'column'], ['Stacked column', 'column', 'stacked'], ['Bar', 'bar'], ['Line', 'line'], ['Area', 'area'], ['Pie', 'pie'], ['Doughnut', 'doughnut'], ['Scatter', 'scatter'], ['Radar', 'radar']]
  return <Modal title="Insert chart" onClose={close}><div className="trans-grid">{kinds.map(([l, k, g]) => <button key={l} type="button" onClick={() => { close(); insertChart(k, g) }}>{l}</button>)}</div><p className="hint">A sample chart is added. Double-click it (or use the Format pane) to edit the data.</p></Modal>
}

const MAP: Record<NonNullable<Dialog>, () => React.ReactNode> = {
  shapes: ShapesDialog, table: TableDialog, chart: ChartKindDialog, link: LinkDialog, image: () => null, theme: ThemeDialog, background: BackgroundDialog, transition: TransitionDialog, size: SizeDialog,
  find: FindDialog, shortcuts: ShortcutsDialog, privacy: PrivacyDialog, about: AboutDialog, footer: FooterDialog, outline: OutlineDialog, sizePos: SizePosDialog, altText: AltDialog, chartData: ChartDataDialog,
  wordCount: WordCountDialog, importOutline: ImportOutlineDialog, slideshow: () => null, video: () => null, crop: CropDialog, exportImages: ExportImagesDialog, tableProps: () => null,
}

export function Dialogs() {
  const d = useStore((s) => s.dialog)
  useEffect(() => { if (d === 'shapes' && S().dialogArg !== 'symbols') close() }, [d])
  if (!d) return null
  const C = MAP[d]
  return <C />
}
export { exportAs, newDeck, Seg, hexToRgb }
