import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, curSlide, type Side } from '../store'
import { addAnim, moveAnim, removeAnim, selected, setBackground, setSlideLayout, setTransition, updateAnim, updateEls, updateSel, updateSlide } from '../actions'
import { style } from '../format'
import { tableOps } from '../tableOps'
import { adjCount, SHAPE_GROUPS } from '../geom'
import { css, textOf, type Anim, type ChartEl, type ChartKind, type Dir, type Effect, type El, type Fill, type ShapeEl, type TransitionKind } from '../model'
import { pickFiles, prepareImage } from '../insert'
import { previewAnim } from '../show/preview'
import { ColorGrid, Field, Icon, Num, Pop, Seg } from './ui'
import { LayoutPicker } from './Toolbar'
import { THEMES } from '../themes'

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="sec" open={open}><summary>{title}</summary><div className="sec-body">{children}</div></details>
}
const ColorBtn = ({ value, onPick, label, none }: { value?: string; onPick: (c: string | undefined) => void; label: string; none?: string }) => {
  const theme = useStore((s) => s.deck.theme)
  return <Pop title={label} trigger={<span className="color-chip" style={{ background: value ? css(value, theme) : 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/10px 10px' }} />}>{(close) => <ColorGrid value={value} none={none} onPick={(c) => { close(); onPick(c) }} />}</Pop>
}

const GRADS: { label: string; f: (a: string, b: string) => Fill }[] = [
  { label: 'Top to bottom', f: (a, b) => ({ t: 'grad', angle: 90, stops: [{ p: 0, c: a }, { p: 1, c: b }] }) },
  { label: 'Left to right', f: (a, b) => ({ t: 'grad', angle: 0, stops: [{ p: 0, c: a }, { p: 1, c: b }] }) },
  { label: 'Diagonal', f: (a, b) => ({ t: 'grad', angle: 45, stops: [{ p: 0, c: a }, { p: 1, c: b }] }) },
  { label: 'Radial', f: (a, b) => ({ t: 'grad', angle: 0, radial: true, stops: [{ p: 0, c: a }, { p: 1, c: b }] }) },
]

export function FillEditor({ fill, onChange, noneLabel = 'No fill' }: { fill?: Fill; onChange: (f: Fill | undefined) => void; noneLabel?: string }) {
  const kind = !fill ? 'none' : fill.t
  const a = fill?.t === 'solid' ? fill.c : fill?.t === 'grad' ? fill.stops[0].c : '@accent1'
  const b = fill?.t === 'grad' ? fill.stops[fill.stops.length - 1].c : '@accent2'
  return (
    <>
      <Seg label="Fill type" value={kind} onChange={(k) => { if (k === 'none') onChange(undefined); else if (k === 'solid') onChange({ t: 'solid', c: a }); else if (k === 'grad') onChange(GRADS[0].f(a, b)); else void pickFiles('image/*').then(async ([f]) => { if (!f) return; const img = await prepareImage(f); const id = 'bg' + Math.random().toString(36).slice(2, 8); useStore.getState().commit('Picture fill', (d) => ({ ...d, media: { ...d.media, [id]: { mime: img.mime, data: img.data } } })); onChange({ t: 'image', media: id, mode: 'cover' }) }) }}
        options={[{ v: 'none', label: noneLabel }, { v: 'solid', label: 'Solid' }, { v: 'grad', label: 'Gradient' }, { v: 'image', label: 'Picture' }]} />
      {fill?.t === 'solid' && <div className="row"><span>Colour</span><ColorBtn label="Fill colour" value={fill.c} onPick={(c) => c && onChange({ t: 'solid', c, a: fill.a })} /><span>Transparency</span><Num label="Fill transparency" suffix="%" min={0} max={100} value={Math.round((1 - (fill.a ?? 1)) * 100)} onChange={(v) => onChange({ ...fill, a: 1 - v / 100 })} /></div>}
      {fill?.t === 'grad' && <>
        <div className="row"><span>From</span><ColorBtn label="Gradient start" value={a} onPick={(c) => c && onChange({ ...fill, stops: [{ p: 0, c }, ...fill.stops.slice(1)] })} /><span>To</span><ColorBtn label="Gradient end" value={b} onPick={(c) => c && onChange({ ...fill, stops: [...fill.stops.slice(0, -1), { p: 1, c }] })} /></div>
        <div className="chip-row">{GRADS.map((g) => <button key={g.label} type="button" onClick={() => onChange(g.f(a, b))}>{g.label}</button>)}</div>
        {!fill.radial && <div className="row"><span>Angle</span><Num label="Gradient angle" suffix="°" min={0} max={360} value={fill.angle} onChange={(v) => onChange({ ...fill, angle: v })} /></div>}
      </>}
      {fill?.t === 'image' && <Seg label="Picture fill mode" value={fill.mode ?? 'cover'} onChange={(m) => onChange({ ...fill, mode: m })} options={[{ v: 'cover', label: 'Fill' }, { v: 'stretch', label: 'Stretch' }, { v: 'tile', label: 'Tile' }]} />}
    </>
  )
}

function Position({ el }: { el: El }) {
  const set = (p: Partial<El>) => updateSel(p as never, 'Size and position', 'pos')
  return (
    <Section title="Size and position">
      <div className="grid2">
        <Field label="X"><Num label="X" value={el.x} step={1} onChange={(v) => set({ x: v })} /></Field><Field label="Y"><Num label="Y" value={el.y} onChange={(v) => set({ y: v })} /></Field>
        <Field label="Width"><Num label="Width" value={el.w} min={1} onChange={(v) => updateSel((e: El) => (e.type === 'group' || e.type === 'table' ? { w: v } : { w: v }), 'Resize', 'pos')} /></Field><Field label="Height"><Num label="Height" value={el.h} min={1} onChange={(v) => set({ h: v })} /></Field>
        <Field label="Rotation"><Num label="Rotation" suffix="°" value={el.rot ?? 0} min={0} max={360} onChange={(v) => set({ rot: v })} /></Field>
      </div>
      <p className="hint">Points: the slide is {Math.round(useStore.getState().deck.w)} × {Math.round(useStore.getState().deck.h)}.</p>
    </Section>
  )
}

function ShapeFormat({ el }: { el: ShapeEl }) {
  const kinds = SHAPE_GROUPS.flatMap((g) => g.shapes)
  return (
    <>
      <Section title="Fill"><FillEditor fill={el.fill} onChange={style.fill} /></Section>
      <Section title="Outline">
        <div className="row"><span>Colour</span><ColorBtn label="Outline colour" none="No outline" value={el.line?.w ? el.line.c : undefined} onPick={(c) => (c ? style.line({ c }) : style.line({ w: 0 }))} /><span>Weight</span><Num label="Outline weight" suffix="pt" min={0} max={40} step={0.25} value={el.line?.w ?? 0} onChange={(w) => style.line({ w })} /></div>
        <Seg label="Dash" value={el.line?.dash ?? 'solid'} onChange={(d) => style.line({ dash: d })} options={[{ v: 'solid', label: '——' }, { v: 'dash', label: '– –' }, { v: 'dot', label: '···' }, { v: 'dashDot', label: '–·–' }]} />
      </Section>
      <Section title="Shape" open={false}>
        <Field label="Shape type"><select aria-label="Shape type" value={el.geom} onChange={(e) => style.geom(e.target.value)}>{kinds.map((k) => <option key={k.geom} value={k.geom}>{k.label}</option>)}{!kinds.some((k) => k.geom === el.geom) && <option value={el.geom}>{el.geom}</option>}</select></Field>
        {Array.from({ length: adjCount(el.geom) }, (_, i) => <div className="row" key={i}><span>Adjust {adjCount(el.geom) > 1 ? i + 1 : ''}</span><Num label={`Adjust ${i + 1}`} value={el.adj?.[i] ?? 0} step={500} onChange={(v) => style.adj(i, v)} /></div>)}
        <p className="hint">You can also drag the yellow handle on the slide.</p>
      </Section>
      <Section title="Text box" open={false}>
        <Seg label="Vertical alignment" value={el.text?.v ?? 'top'} onChange={style.vAlign} options={[{ v: 'top', label: 'Top' }, { v: 'middle', label: 'Middle' }, { v: 'bottom', label: 'Bottom' }]} />
        <Seg label="Text fit" value={el.text?.fit ?? 'none'} onChange={style.fit} options={[{ v: 'none', label: 'Keep size' }, { v: 'shrink', label: 'Shrink to fit' }]} />
        <Seg label="Wrap" value={el.text?.wrap === false ? 'no' : 'yes'} onChange={(v) => style.wrap(v === 'yes')} options={[{ v: 'yes', label: 'Wrap text' }, { v: 'no', label: 'One line' }]} />
        <div className="grid2">
          {(['Left', 'Top', 'Right', 'Bottom'] as const).map((n, i) => <Field key={n} label={`${n} margin`}><Num label={`${n} margin`} value={(el.text?.inset ?? [7.2, 3.6, 7.2, 3.6])[i]} min={0} onChange={(v) => { const ins = [...(el.text?.inset ?? [7.2, 3.6, 7.2, 3.6])] as [number, number, number, number]; ins[i] = v; style.inset(ins) }} /></Field>)}
        </div>
        <Field label="Columns"><Num label="Columns" value={el.text?.cols ?? 1} min={1} max={4} onChange={(v) => style.columns(v)} /></Field>
      </Section>
    </>
  )
}

function TableFormat() {
  const el = selected()[0]
  const st = useStore((s) => s.cellSel)
  if (!el || el.type !== 'table') return null
  return (
    <>
      <Section title="Table style">
        <label className="check"><input type="checkbox" checked={el.style.header} onChange={(e) => tableOps.style({ header: e.target.checked })} /> Header row</label>
        <label className="check"><input type="checkbox" checked={el.style.banded} onChange={(e) => tableOps.style({ banded: e.target.checked })} /> Banded rows</label>
        <label className="check"><input type="checkbox" checked={el.style.firstCol} onChange={(e) => tableOps.style({ firstCol: e.target.checked })} /> First column</label>
        <label className="check"><input type="checkbox" checked={el.style.borders} onChange={(e) => tableOps.style({ borders: e.target.checked })} /> Cell borders</label>
        <div className="row"><span>Colour</span><ColorBtn label="Table colour" value={el.style.color} onPick={(c) => c && tableOps.style({ color: c })} /></div>
      </Section>
      <Section title={st ? `Cells (${(st.r2 - st.r1 + 1) * (st.c2 - st.c1 + 1)} selected)` : 'Cells (all)'}>
        <div className="chip-row"><button type="button" onClick={() => tableOps.addRow('above')}>+ Row above</button><button type="button" onClick={() => tableOps.addRow('below')}>+ Row below</button><button type="button" onClick={() => tableOps.addCol('left')}>+ Column left</button><button type="button" onClick={() => tableOps.addCol('right')}>+ Column right</button></div>
        <div className="chip-row"><button type="button" onClick={tableOps.deleteRows}>Delete rows</button><button type="button" onClick={tableOps.deleteCols}>Delete columns</button><button type="button" onClick={tableOps.merge}>Merge</button><button type="button" onClick={tableOps.split}>Split</button></div>
        <div className="chip-row"><button type="button" onClick={tableOps.evenRows}>Even rows</button><button type="button" onClick={tableOps.evenCols}>Even columns</button></div>
        <div className="row"><span>Cell fill</span><ColorBtn label="Cell fill" none="Table default" value={undefined} onPick={(c) => tableOps.fill(c ? { t: 'solid', c } : undefined)} /></div>
        <Seg label="Cell alignment" value={'middle'} onChange={tableOps.vAlign} options={[{ v: 'top', label: 'Top' }, { v: 'middle', label: 'Middle' }, { v: 'bottom', label: 'Bottom' }]} />
        <p className="hint">Drag across cells to choose them. Press Tab in the last cell to add a row.</p>
      </Section>
    </>
  )
}

const CHART_KINDS: { v: ChartKind; label: string }[] = [{ v: 'column', label: 'Column' }, { v: 'bar', label: 'Bar' }, { v: 'line', label: 'Line' }, { v: 'area', label: 'Area' }, { v: 'pie', label: 'Pie' }, { v: 'doughnut', label: 'Doughnut' }, { v: 'scatter', label: 'Scatter' }, { v: 'radar', label: 'Radar' }]
function ChartFormat({ el }: { el: ChartEl }) {
  const up = (p: Partial<ChartEl>) => updateSel(p as never, 'Chart', 'chart')
  return (
    <Section title="Chart">
      <Field label="Type"><select aria-label="Chart type" value={el.kind} onChange={(e) => up({ kind: e.target.value as ChartKind })}>{CHART_KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</select></Field>
      {(el.kind === 'column' || el.kind === 'bar' || el.kind === 'area') && <Seg label="Grouping" value={el.grouping} onChange={(g) => up({ grouping: g })} options={[{ v: 'clustered', label: 'Side by side' }, { v: 'stacked', label: 'Stacked' }, { v: 'percent', label: '100%' }]} />}
      <Field label="Title"><input aria-label="Chart title" value={el.title ?? ''} onChange={(e) => up({ title: e.target.value || undefined })} /></Field>
      <Field label="Legend"><select aria-label="Legend" value={el.legend} onChange={(e) => up({ legend: e.target.value as ChartEl['legend'] })}><option value="none">None</option><option value="top">Top</option><option value="right">Right</option><option value="bottom">Bottom</option></select></Field>
      <label className="check"><input type="checkbox" checked={el.labels} onChange={(e) => up({ labels: e.target.checked })} /> Data labels</label>
      <label className="check"><input type="checkbox" checked={el.grid} onChange={(e) => up({ grid: e.target.checked })} /> Gridlines</label>
      {el.kind === 'line' && <label className="check"><input type="checkbox" checked={!!el.smooth} onChange={(e) => up({ smooth: e.target.checked })} /> Smooth lines</label>}
      <div className="grid2"><Field label="Horizontal axis title"><input value={el.xTitle ?? ''} onChange={(e) => up({ xTitle: e.target.value || undefined })} /></Field><Field label="Vertical axis title"><input value={el.yTitle ?? ''} onChange={(e) => up({ yTitle: e.target.value || undefined })} /></Field></div>
      <div className="chip-row"><button type="button" className="primary" onClick={() => useStore.setState({ dialog: 'chartData' })}>Edit data…</button></div>
      <div className="menu-label">Series colours</div>
      <div className="row wrap">{el.series.map((s, i) => <span key={i} className="row"><ColorBtn label={`Colour of ${s.name}`} value={s.color ?? `@accent${(i % 6) + 1}`} onPick={(c) => c && up({ series: el.series.map((x, j) => (j === i ? { ...x, color: c } : x)) })} /><span>{s.name}</span></span>)}</div>
    </Section>
  )
}

function ImageFormat({ el }: { el: Extract<El, { type: 'image' }> }) {
  const masks = ['rect', 'roundRect', 'ellipse', 'diamond', 'triangle', 'hexagon', 'star5', 'heart', 'plus']
  return (
    <>
      <Section title="Picture">
        <div className="chip-row"><button type="button" onClick={() => useStore.setState({ dialog: 'crop' })}><Icon name="crop" size={14} /> Crop…</button><button type="button" onClick={() => updateSel({ crop: undefined, geom: undefined } as never, 'Reset picture')}>Reset</button></div>
        <Field label="Crop to shape"><select aria-label="Crop to shape" value={el.geom ?? 'rect'} onChange={(e) => updateSel({ geom: e.target.value === 'rect' ? undefined : e.target.value } as never, 'Crop to shape')}>{masks.map((m) => <option key={m} value={m}>{SHAPE_GROUPS.flatMap((g) => g.shapes).find((s) => s.geom === m)?.label ?? m}</option>)}</select></Field>
        <div className="row"><span>Border</span><ColorBtn label="Border colour" none="No border" value={el.line?.w ? el.line.c : undefined} onPick={(c) => (c ? style.line({ c }) : style.line({ w: 0 }))} /><Num label="Border weight" suffix="pt" min={0} step={0.5} value={el.line?.w ?? 0} onChange={(w) => style.line({ w })} /></div>
      </Section>
    </>
  )
}

function Effects({ el }: { el: El }) {
  const shadow = 'shadow' in el ? el.shadow : undefined
  return (
    <Section title="Shadow and transparency" open={false}>
      <Seg label="Shadow" value={!shadow ? 'none' : shadow.blur >= 12 ? 'glow' : shadow.dx || shadow.dy > 3 ? 'offset' : 'soft'} onChange={(v) => style.shadow(v === 'none' ? undefined : v === 'soft' ? { c: '#000000', blur: 8, dx: 0, dy: 3, a: 0.3 } : v === 'offset' ? { c: '#000000', blur: 4, dx: 4, dy: 4, a: 0.35 } : { c: '#000000', blur: 14, dx: 0, dy: 0, a: 0.5 })} options={[{ v: 'none', label: 'None' }, { v: 'soft', label: 'Soft' }, { v: 'offset', label: 'Offset' }, { v: 'glow', label: 'Glow' }]} />
      {(el.type === 'shape' || el.type === 'image') && <div className="row"><span>Transparency</span><input type="range" aria-label="Transparency" min={0} max={90} value={Math.round((1 - (el.opacity ?? 1)) * 100)} onChange={(e) => style.opacity(1 - Number(e.target.value) / 100)} /><span>{Math.round((1 - (el.opacity ?? 1)) * 100)}%</span></div>}
    </Section>
  )
}

function LineFormat({ el }: { el: Extract<El, { type: 'line' }> }) {
  const ends = ['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as const
  return (
    <Section title="Line">
      <div className="row"><span>Colour</span><ColorBtn label="Line colour" value={el.line.c} onPick={(c) => c && style.line({ c })} /><span>Weight</span><Num label="Line weight" suffix="pt" min={0.25} max={40} step={0.25} value={el.line.w} onChange={(w) => style.line({ w })} /></div>
      <Seg label="Dash" value={el.line.dash ?? 'solid'} onChange={(d) => style.line({ dash: d })} options={[{ v: 'solid', label: '——' }, { v: 'dash', label: '– –' }, { v: 'dot', label: '···' }, { v: 'dashDot', label: '–·–' }]} />
      <Seg label="Kind" value={el.kind} onChange={(k) => updateSel({ kind: k } as never, 'Line kind')} options={[{ v: 'straight', label: 'Straight' }, { v: 'elbow', label: 'Elbow' }, { v: 'curve', label: 'Curved' }]} />
      <div className="grid2"><Field label="Start"><select aria-label="Arrow at start" value={el.line.head ?? 'none'} onChange={(e) => style.line({ head: e.target.value as never })}>{ends.map((x) => <option key={x}>{x}</option>)}</select></Field><Field label="End"><select aria-label="Arrow at end" value={el.line.tail ?? 'none'} onChange={(e) => style.line({ tail: e.target.value as never })}>{ends.map((x) => <option key={x}>{x}</option>)}</select></Field></div>
    </Section>
  )
}

function LinkAlt({ el }: { el: El }) {
  const deck = useStore((s) => s.deck)
  return (
    <Section title="Link and alt text" open={false}>
      <Field label="Link to web address"><input aria-label="Link address" placeholder="https://" value={el.link?.url ?? ''} onChange={(e) => style.link(e.target.value || null, el.link?.slide)} /></Field>
      <Field label="Or to a slide"><select aria-label="Link to slide" value={el.link?.slide ?? ''} onChange={(e) => style.link(el.link?.url ?? null, e.target.value || undefined)}><option value="">None</option>{deck.slides.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {textOf(s.els.find((x): x is ShapeEl => x.type === 'shape' && x.ph?.role === 'title')?.text).slice(0, 30) || 'Slide'}</option>)}</select></Field>
      <Field label="Alt text (read aloud for people who cannot see it)"><textarea aria-label="Alt text" rows={2} value={el.alt ?? ''} onChange={(e) => style.alt(e.target.value)} /></Field>
    </Section>
  )
}

function FormatTab() {
  useStore((s) => s.tick)
  const sel = useStore((s) => s.sel)
  const els = sel.length ? selected() : []
  const one = els.length === 1 ? els[0] : undefined
  if (!els.length) return <SlideTab />
  return (
    <div className="pane-body">
      <div className="pane-title">{els.length > 1 ? `${els.length} objects` : ({ shape: 'Shape', line: 'Line', image: 'Picture', table: 'Table', chart: 'Chart', video: 'Video', audio: 'Audio', group: 'Group' } as const)[els[0].type]}</div>
      {one && <Position el={one} />}
      {one?.type === 'shape' && <ShapeFormat el={one} />}
      {one?.type === 'line' && <LineFormat el={one} />}
      {one?.type === 'table' && <TableFormat />}
      {one?.type === 'chart' && <ChartFormat el={one} />}
      {one?.type === 'image' && <ImageFormat el={one} />}
      {one && one.type !== 'table' && one.type !== 'chart' && <Effects el={one} />}
      {!one && <Section title="Fill and outline"><FillEditor fill={undefined} onChange={style.fill} /><div className="row"><span>Outline</span><ColorBtn label="Outline colour" value={undefined} onPick={(c) => (c ? style.line({ c }) : style.line({ w: 0 }))} none="None" /></div></Section>}
      {one && <LinkAlt el={one} />}
    </div>
  )
}

const TRANS: { v: TransitionKind; label: string; dirs?: boolean }[] = [{ v: 'none', label: 'None' }, { v: 'fade', label: 'Fade' }, { v: 'push', label: 'Push', dirs: true }, { v: 'wipe', label: 'Wipe', dirs: true }, { v: 'cover', label: 'Cover', dirs: true }, { v: 'uncover', label: 'Uncover', dirs: true }, { v: 'zoom', label: 'Zoom' }, { v: 'flip', label: 'Flip' }, { v: 'cube', label: 'Cube', dirs: true }, { v: 'dissolve', label: 'Dissolve' }, { v: 'split', label: 'Split' }, { v: 'blinds', label: 'Blinds' }, { v: 'morph', label: 'Morph' }]
export { TRANS }

function SlideTab() {
  const deck = useStore((s) => s.deck)
  const slide = curSlide()
  return (
    <div className="pane-body">
      <div className="pane-title">Slide</div>
      <Section title="Layout"><LayoutPicker onPick={(id) => setSlideLayout(id)} close={() => {}} /></Section>
      <Section title="Background"><FillEditor fill={slide.bg} noneLabel="From theme" onChange={(f) => setBackground(f)} /><div className="chip-row"><button type="button" onClick={() => setBackground(slide.bg, true)}>Apply to all slides</button></div></Section>
      <Section title="Theme" open={false}>
        <div className="theme-list">{THEMES.map((t) => <button key={t.id} type="button" className={deck.theme.id === t.id ? 'on' : ''} onClick={() => void import('../themes').then((m) => useStore.getState().commit('Theme', (d) => m.applyTheme(d, t.id)))} title={t.name}><span className="sw" style={{ background: t.colors.bg, color: t.colors.text, borderColor: t.colors.accent1 }}>Aa<i style={{ background: t.colors.accent1 }} /><i style={{ background: t.colors.accent2 }} /><i style={{ background: t.colors.accent3 }} /></span><span>{t.name}</span></button>)}</div>
      </Section>
      <Section title="Transition" open={false}>
        <Field label="Effect"><select aria-label="Transition effect" value={slide.trans?.kind ?? 'none'} onChange={(e) => setTransition({ kind: e.target.value as TransitionKind, dur: slide.trans?.dur ?? 0.7, dir: slide.trans?.dir })}>{TRANS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select></Field>
        {slide.trans && <><div className="row"><span>Duration</span><Num label="Transition duration" suffix="s" min={0.1} max={5} step={0.1} value={slide.trans.dur} onChange={(v) => setTransition({ ...slide.trans!, dur: v })} /></div>
          <Field label="Direction"><select aria-label="Transition direction" value={slide.trans.dir ?? 'left'} onChange={(e) => setTransition({ ...slide.trans!, dir: e.target.value as Dir })}><option value="left">From right</option><option value="right">From left</option><option value="up">From bottom</option><option value="down">From top</option></select></Field>
          <div className="chip-row"><button type="button" onClick={() => setTransition(slide.trans, true)}>Apply to all slides</button></div></>}
        <div className="row"><span>Advance automatically after</span><Num label="Auto advance seconds" suffix="s" min={0} value={slide.auto ?? 0} onChange={(v) => updateSlide(slide.id, { auto: v || undefined }, 'Timing', 'auto')} /></div>
      </Section>
      <Section title="Slide" open={false}><div className="chip-row"><button type="button" onClick={() => useStore.setState({ dialog: 'size' })}>Slide size…</button><button type="button" onClick={() => useStore.setState({ dialog: 'footer' })}>Numbers and footer…</button></div></Section>
    </div>
  )
}

const EFFECTS: { v: Effect; label: string; kinds: ('in' | 'emph' | 'out')[]; dirs?: boolean }[] = [
  { v: 'appear', label: 'Appear', kinds: ['in', 'out'] }, { v: 'fade', label: 'Fade', kinds: ['in', 'out'] }, { v: 'fly', label: 'Fly', kinds: ['in', 'out'], dirs: true }, { v: 'wipe', label: 'Wipe', kinds: ['in', 'out'], dirs: true },
  { v: 'zoom', label: 'Zoom', kinds: ['in', 'out'] }, { v: 'float', label: 'Float', kinds: ['in', 'out'], dirs: true }, { v: 'split', label: 'Split', kinds: ['in', 'out'] }, { v: 'blinds', label: 'Blinds', kinds: ['in', 'out'] },
  { v: 'grow', label: 'Grow / shrink', kinds: ['emph'] }, { v: 'spin', label: 'Spin', kinds: ['emph'] }, { v: 'pulse', label: 'Pulse', kinds: ['emph'] }, { v: 'bounce', label: 'Bounce', kinds: ['emph'] }, { v: 'teeter', label: 'Teeter', kinds: ['emph'] }, { v: 'color', label: 'Colour pulse', kinds: ['emph'] },
]
const label = (e: El | undefined) => (!e ? '(deleted)' : e.name || (e.type === 'shape' ? textOf(e.text).trim().slice(0, 24) || (e.ph ? e.ph.role : e.geom) : e.type))

function AnimTab() {
  useStore((s) => s.tick)
  const slide = curSlide()
  const sel = useStore((s) => s.sel)
  const [open, setOpen] = useState<string | null>(null)
  const all = useRef<Map<string, El>>(new Map())
  all.current = new Map(slide.els.flatMap((e): [string, El][] => [[e.id, e], ...(e.type === 'group' ? e.children.map((c): [string, El] => [c.id, c]) : [])]))
  const a = slide.anims.find((x) => x.id === open) ?? null
  useEffect(() => { if (open && !slide.anims.some((x) => x.id === open)) setOpen(null) }, [slide.anims, open])
  const up = (p: Partial<Anim>) => a && updateAnim(a.id, p)
  const fx = EFFECTS.find((e) => e.v === a?.effect)
  return (
    <div className="pane-body">
      <div className="pane-title">Animations</div>
      <div className="chip-row">
        <button type="button" className="primary" disabled={!sel.length} onClick={() => { for (const id of sel) { const na = addAnim(id, { effect: 'fade', kind: 'in', trigger: 'click' }); setOpen(na) } }}>Add entrance to selection</button>
        <button type="button" disabled={!sel.length} onClick={() => { for (const id of sel) setOpen(addAnim(id, { effect: 'pulse', kind: 'emph', trigger: 'click', dur: 0.6 })) }}>Add emphasis</button>
        <button type="button" disabled={!sel.length} onClick={() => { for (const id of sel) setOpen(addAnim(id, { effect: 'fade', kind: 'out', trigger: 'click' })) }}>Add exit</button>
      </div>
      {!slide.anims.length && <p className="hint">Select an object on the slide, then add an effect. Objects with an entrance effect stay hidden until it plays in the slide show.</p>}
      <ol className="anim-list" aria-label="Animation order">
        {slide.anims.map((x, i) => (
          <li key={x.id} className={x.id === open ? 'on' : ''}>
            <button type="button" className="anim-row" onClick={() => { setOpen(x.id); if (all.current.has(x.target)) useStore.setState({ sel: [x.target] }) }}>
              <span className="n">{i + 1}</span><span className={'kind ' + x.kind}>{x.kind === 'in' ? 'In' : x.kind === 'out' ? 'Out' : 'Emph'}</span><span className="t">{label(all.current.get(x.target))}</span><span className="e">{x.effect} · {x.trigger === 'click' ? 'on click' : x.trigger === 'with' ? 'with previous' : 'after previous'}</span>
            </button>
            <span className="anim-ctl"><button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => moveAnim(x.id, i - 1)}><Icon name="up" size={14} /></button><button type="button" aria-label="Move later" disabled={i === slide.anims.length - 1} onClick={() => moveAnim(x.id, i + 1)}><Icon name="down" size={14} /></button><button type="button" aria-label="Remove animation" onClick={() => removeAnim(x.id)}><Icon name="trash" size={14} /></button></span>
          </li>
        ))}
      </ol>
      {a && fx && (
        <div className="anim-edit">
          <Field label="Effect"><select aria-label="Effect" value={a.effect} onChange={(e) => up({ effect: e.target.value as Effect })}>{EFFECTS.filter((x) => x.kinds.includes(a.kind)).map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select></Field>
          <Field label="Start"><select aria-label="Start" value={a.trigger} onChange={(e) => up({ trigger: e.target.value as Anim['trigger'] })}><option value="click">On click</option><option value="with">With previous</option><option value="after">After previous</option></select></Field>
          {fx.dirs && <Field label="Direction"><select aria-label="Animation direction" value={a.dir ?? 'left'} onChange={(e) => up({ dir: e.target.value as Dir })}><option value="left">From left</option><option value="right">From right</option><option value="up">From top</option><option value="down">From bottom</option></select></Field>}
          <div className="grid2"><Field label="Duration (s)"><Num label="Animation duration" min={0.1} max={20} step={0.1} value={a.dur} onChange={(v) => up({ dur: v })} /></Field><Field label="Delay (s)"><Num label="Animation delay" min={0} max={60} step={0.1} value={a.delay} onChange={(v) => up({ delay: v })} /></Field></div>
          {all.current.get(a.target)?.type === 'shape' && <label className="check"><input type="checkbox" checked={!!a.byPara} onChange={(e) => up({ byPara: e.target.checked })} /> Reveal text one paragraph at a time</label>}
          <div className="chip-row"><button type="button" onClick={() => previewAnim(a.id)}><Icon name="play" size={14} /> Preview</button></div>
        </div>
      )}
      {slide.anims.length > 0 && <div className="chip-row"><button type="button" onClick={() => previewAnim(null)}><Icon name="play" size={14} /> Preview all</button></div>}
    </div>
  )
}

export function SidePanel() {
  const side = useStore((s) => s.panels.side)
  const panels = useStore((s) => s.panels)
  if (!side) return null
  const tab = (v: Side, t: string) => <button type="button" role="tab" aria-selected={side === v} className={side === v ? 'on' : ''} onClick={() => useStore.setState({ panels: { ...panels, side: v } })}>{t}</button>
  return (
    <aside className="side-panel" aria-label="Format pane">
      <div className="side-tabs" role="tablist">{tab('format', 'Format')}{tab('anim', 'Animate')}{tab('slide', 'Slide')}<button type="button" aria-label="Close pane" className="x" onClick={() => useStore.setState({ panels: { ...panels, side: null } })}><Icon name="close" size={14} /></button></div>
      {side === 'format' && <FormatTab />}
      {side === 'anim' && <AnimTab />}
      {side === 'slide' && <SlideTab />}
    </aside>
  )
}
export { updateEls }
