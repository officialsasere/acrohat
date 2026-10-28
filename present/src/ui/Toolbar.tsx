import { useMemo, useState } from 'react'
import { useStore, curSlide } from '../store'
import { FONTS } from '../../../shared/fonts'
import { SHAPE_GROUPS, shapePath } from '../geom'
import { addSlide, align, distribute, flip, group, order, rotateBy, selected, setSlideLayout, ungroup } from '../actions'
import { fmtOfSelection, style, text } from '../format'
import { insertChart, insertLine, insertMediaFile, insertPictureFromDisk, insertShape, insertTable, insertTextBox } from '../insert'
import { css, slideTitle, type ChartKind, type Slide } from '../model'
import { slideFromLayout } from '../themes'
import { Thumb } from '../render/Thumb'
import { startShow } from '../show/start'
import { curIndex } from '../store'
import { ColorGrid, Icon, Pop } from './ui'

const sel = (e: React.MouseEvent) => e.preventDefault()
function B({ icon, label, onClick, on, disabled, children }: { icon?: string; label: string; onClick: () => void; on?: boolean; disabled?: boolean; children?: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={on === undefined ? undefined : on} className={on ? 'on' : ''} disabled={disabled} onMouseDown={sel} onClick={onClick}>{icon && <Icon name={icon} />}{children}</button>
}

export function ShapeIcon({ geom, size = 26 }: { geom: string; size?: number }) {
  const p = shapePath(geom, 24, 24)
  return <svg width={size} height={size} viewBox="-2 -2 28 28" aria-hidden><path d={p.d} fill={p.open ? 'none' : 'currentColor'} fillOpacity={p.open ? 1 : 0.25} stroke="currentColor" strokeWidth="1.6" fillRule="evenodd" />{p.detail && <path d={p.detail} fill="none" stroke="currentColor" strokeWidth="1.2" />}</svg>
}

export function ShapeGallery({ onPick, close }: { onPick: (geom: string) => void; close: () => void }) {
  return (
    <div className="shape-gallery">
      {SHAPE_GROUPS.map((g) => (
        <div key={g.name}>
          <div className="menu-label">{g.name}</div>
          <div className="shape-grid">{g.shapes.map((s) => <button key={s.geom} type="button" title={s.label} aria-label={s.label} onClick={() => { close(); onPick(s.geom) }}><ShapeIcon geom={s.geom} /></button>)}</div>
        </div>
      ))}
    </div>
  )
}

export function TablePicker({ onPick }: { onPick: (r: number, c: number) => void }) {
  const [hov, setHov] = useState<[number, number]>([0, 0])
  return (
    <div className="table-picker">
      <div className="tp-grid" role="grid" aria-label="Table size">{Array.from({ length: 48 }, (_, i) => { const r = Math.floor(i / 8) + 1, c = (i % 8) + 1; return <button key={i} type="button" aria-label={`${r} by ${c}`} className={r <= hov[0] && c <= hov[1] ? 'on' : ''} onMouseEnter={() => setHov([r, c])} onFocus={() => setHov([r, c])} onClick={() => onPick(r, c)} /> })}</div>
      <div className="tp-label">{hov[0] ? `${hov[0]} rows × ${hov[1]} columns` : 'Choose a size'}</div>
    </div>
  )
}

const CHARTS: { k: ChartKind; g?: 'stacked' | 'percent'; label: string; icon: string }[] = [
  { k: 'column', label: 'Column', icon: 'chart' }, { k: 'column', g: 'stacked', label: 'Stacked column', icon: 'chart' }, { k: 'bar', label: 'Bar', icon: 'chart' }, { k: 'line', label: 'Line', icon: 'chart' },
  { k: 'area', label: 'Area', icon: 'chart' }, { k: 'pie', label: 'Pie', icon: 'chart' }, { k: 'doughnut', label: 'Doughnut', icon: 'chart' }, { k: 'scatter', label: 'Scatter', icon: 'chart' }, { k: 'radar', label: 'Radar', icon: 'chart' },
]

export function LayoutPicker({ onPick, close }: { onPick: (id: string) => void; close: () => void }) {
  const deck = useStore((s) => s.deck)
  const previews = useMemo(() => deck.layouts.map((l) => ({ l, slide: { ...slideFromLayout(deck, l.id), id: l.id } as Slide })), [deck])
  return (
    <div className="layout-grid">
      {previews.map(({ l, slide }) => (
        <button key={l.id} type="button" className="layout-item" onClick={() => { close(); onPick(l.id) }}>
          <Thumb deck={{ ...deck, footer: { ...deck.footer, num: false } }} slide={{ ...slide, els: slide.els.map((e) => (e.type === 'shape' && e.ph ? { ...e, text: { paras: [{ runs: [{ t: e.ph.role === 'title' ? 'Title' : e.ph.role === 'subtitle' ? 'Subtitle' : e.ph.role === 'picture' ? '' : 'Text' }] }] } } : e)) }} width={108} />
          <span>{l.name}</span>
        </button>
      ))}
    </div>
  )
}

const WEIGHTS = [0.5, 1, 1.5, 2.25, 3, 4.5, 6]
const SHADOWS: { label: string; v: { c: string; blur: number; dx: number; dy: number; a: number } | undefined }[] = [
  { label: 'None', v: undefined }, { label: 'Soft', v: { c: '#000000', blur: 8, dx: 0, dy: 3, a: 0.3 } }, { label: 'Offset', v: { c: '#000000', blur: 4, dx: 4, dy: 4, a: 0.35 } }, { label: 'Glow', v: { c: '#000000', blur: 14, dx: 0, dy: 0, a: 0.5 } },
]

export function Toolbar() {
  const deck = useStore((s) => s.deck)
  useStore((s) => s.tick)
  const selIds = useStore((s) => s.sel)
  const editing = useStore((s) => s.editing)
  const past = useStore((s) => s.past.length)
  const future = useStore((s) => s.future.length)
  const tool = useStore((s) => s.tool)
  const fmtLive = useStore((s) => s.fmt)
  const panels = useStore((s) => s.panels)
  void fmtLive
  const els = selIds.length ? selected() : []
  const fmt = fmtOfSelection()
  const canText = !!editing || els.some((e) => e.type === 'shape' || e.type === 'table')
  const hasSel = els.length > 0
  const shape = els.find((e) => e.type === 'shape' || e.type === 'line' || e.type === 'image')
  const fillColor = shape && shape.type === 'shape' && shape.fill?.t === 'solid' ? shape.fill.c : undefined
  const lineColor = shape && 'line' in shape && shape.line ? shape.line.c : undefined
  const setTool = (t: typeof tool) => useStore.setState({ tool: t })
  const isLine = els.some((e) => e.type === 'line')
  const fontValue = fmt.f ?? '+body'

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tgroup">
        <B icon="undo" label="Undo" onClick={() => useStore.getState().undo()} disabled={!past} />
        <B icon="redo" label="Redo" onClick={() => useStore.getState().redo()} disabled={!future} />
      </div>
      <div className="tgroup">
        <B icon="newslide" label="New slide" onClick={() => addSlide()} />
        <Pop title="Choose layout for new slide" trigger={<Icon name="down" size={14} />} panelClass="wide">{(close) => <LayoutPicker onPick={(id) => addSlide(id)} close={close} />}</Pop>
        <Pop title="Layout of this slide" trigger={<Icon name="layout" />} panelClass="wide">{(close) => <><div className="menu-label">Layout of this slide</div><LayoutPicker onPick={(id) => setSlideLayout(id)} close={close} /></>}</Pop>
      </div>
      <div className="tgroup">
        <B icon="pointer" label="Select" on={tool.kind === 'select'} onClick={() => setTool({ kind: 'select' })} />
        <B icon="textbox" label="Text box" on={tool.kind === 'text'} onClick={() => (tool.kind === 'text' ? setTool({ kind: 'select' }) : setTool({ kind: 'text' }))} />
        <Pop title="Shapes" trigger={<Icon name="shape" />} panelClass="wide">{(close) => <ShapeGallery onPick={(g) => setTool({ kind: 'shape', geom: g })} close={close} />}</Pop>
        <Pop title="Lines and arrows" trigger={<Icon name="line" />}>{(close) => <>
          <button type="button" className="menu-item" onClick={() => { close(); setTool({ kind: 'line', line: 'straight' }) }}><Icon name="line" /> Line</button>
          <button type="button" className="menu-item" onClick={() => { close(); setTool({ kind: 'line', line: 'straight', arrow: true }) }}><Icon name="arrow" /> Arrow</button>
          <button type="button" className="menu-item" onClick={() => { close(); setTool({ kind: 'line', line: 'elbow', arrow: true }) }}><Icon name="elbow" /> Elbow connector</button>
          <button type="button" className="menu-item" onClick={() => { close(); setTool({ kind: 'line', line: 'curve', arrow: true }) }}><Icon name="curve" /> Curved connector</button>
        </>}</Pop>
        <B icon="image" label="Picture" onClick={() => void insertPictureFromDisk()} />
        <Pop title="Table" trigger={<Icon name="table" />}>{(close) => <TablePicker onPick={(r, c) => { close(); insertTable(r, c) }} />}</Pop>
        <Pop title="Chart" trigger={<Icon name="chart" />}>{(close) => CHARTS.map((c) => <button key={c.label} type="button" className="menu-item" onClick={() => { close(); insertChart(c.k, c.g) }}><Icon name={c.icon} /> {c.label}</button>)}</Pop>
        <Pop title="Video and audio" trigger={<Icon name="video" />}>{(close) => <><button type="button" className="menu-item" onClick={() => { close(); void insertMediaFile('video') }}><Icon name="video" /> Video from this device…</button><button type="button" className="menu-item" onClick={() => { close(); void insertMediaFile('audio') }}><Icon name="audio" /> Audio from this device…</button></>}</Pop>
        <B icon="link" label="Link" onClick={() => useStore.setState({ dialog: 'link' })} disabled={!hasSel && !editing} />
      </div>
      <div className="tgroup">
        <select className="font-select" aria-label="Font" value={fontValue} disabled={!canText} onChange={(e) => text.font(e.target.value)}>
          <option value="+head">Heading font ({deck.theme.headFont})</option>
          <option value="+body">Body font ({deck.theme.bodyFont})</option>
          {FONTS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          {fmt.f && fmt.f[0] !== '+' && !FONTS.some((f) => f.name === fmt.f) && <option value={fmt.f}>{fmt.f}</option>}
        </select>
        <span className="size-box">
          <button type="button" aria-label="Smaller text" disabled={!canText} onMouseDown={sel} onClick={() => text.sizeStep(-1)}><Icon name="minus" size={14} /></button>
          <input aria-label="Font size" inputMode="decimal" disabled={!canText} key={`${fmt.sz}`} defaultValue={fmt.sz ?? ''} onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseFloat((e.target as HTMLInputElement).value); if (n > 0) text.size(n) } }} onBlur={(e) => { const n = parseFloat(e.target.value); if (n > 0 && n !== fmt.sz) text.size(n) }} />
          <button type="button" aria-label="Larger text" disabled={!canText} onMouseDown={sel} onClick={() => text.sizeStep(1)}><Icon name="plus" size={14} /></button>
        </span>
        <B icon="bold" label="Bold" on={fmt.b} disabled={!canText} onClick={text.bold} />
        <B icon="italic" label="Italic" on={fmt.i} disabled={!canText} onClick={text.italic} />
        <B icon="underline" label="Underline" on={fmt.u} disabled={!canText} onClick={text.underline} />
        <B icon="strike" label="Strikethrough" on={fmt.s} disabled={!canText} onClick={text.strike} />
        <Pop title="Text colour" disabled={!canText} trigger={<span style={{ display: 'grid', placeItems: 'center' }}><Icon name="fontcolor" /><i className="swatch-bar" style={{ background: css(fmt.c ?? '@text', deck.theme) }} /></span>}>{(close) => <ColorGrid value={fmt.c ?? undefined} onPick={(c) => { close(); text.color(c) }} />}</Pop>
        <Pop title="Highlight colour" disabled={!canText} trigger={<span style={{ display: 'grid', placeItems: 'center' }}><Icon name="highlight" /><i className="swatch-bar" style={{ background: fmt.hl ? css(fmt.hl, deck.theme) : '#ffe066' }} /></span>}>{(close) => <ColorGrid value={fmt.hl ?? undefined} none="No highlight" onPick={(c) => { close(); text.highlight(c) }} />}</Pop>
      </div>
      <div className="tgroup">
        <B icon="alignL" label="Align left" on={fmt.align === 'left'} disabled={!canText} onClick={() => text.align('left')} />
        <B icon="alignC" label="Centre" on={fmt.align === 'center'} disabled={!canText} onClick={() => text.align('center')} />
        <B icon="alignR" label="Align right" on={fmt.align === 'right'} disabled={!canText} onClick={() => text.align('right')} />
        <B icon="alignJ" label="Justify" on={fmt.align === 'justify'} disabled={!canText} onClick={() => text.align('justify')} />
        <Pop title="Bullets" disabled={!canText} trigger={<Icon name="bullets" />}>{(close) => <>
          {(['disc', 'circle', 'square', 'dash', 'arrow', 'check'] as const).map((k) => <button key={k} type="button" className="menu-item" onClick={() => { close(); text.bullet(k) }}><span className="chk">{fmt.bullet === k ? '✓' : ''}</span>{{ disc: '• Round', circle: '◦ Hollow', square: '▪ Square', dash: '– Dash', arrow: '➢ Arrow', check: '✓ Tick' }[k]}</button>)}
          <button type="button" className="menu-item" onClick={() => { close(); text.bullet('none') }}><span className="chk" />No bullet</button></>}</Pop>
        <Pop title="Numbering" disabled={!canText} trigger={<Icon name="numbers" />}>{(close) => (['num', 'alpha', 'Alpha', 'roman', 'Roman'] as const).map((k) => <button key={k} type="button" className="menu-item" onClick={() => { close(); text.bullet(k) }}><span className="chk">{fmt.bullet === k ? '✓' : ''}</span>{{ num: '1. 2. 3.', alpha: 'a. b. c.', Alpha: 'A. B. C.', roman: 'i. ii. iii.', Roman: 'I. II. III.' }[k]}</button>)}</Pop>
        <B icon="outdent" label="Decrease indent" disabled={!canText} onClick={() => text.indent(-1)} />
        <B icon="indent" label="Increase indent" disabled={!canText} onClick={() => text.indent(1)} />
        <Pop title="Line spacing" disabled={!canText} trigger={<Icon name="lineheight" />}>{(close) => <>{[1, 1.15, 1.5, 2, 2.5].map((n) => <button key={n} type="button" className="menu-item" onClick={() => { close(); text.lineHeight(n) }}>{n}</button>)}
          <div className="menu-sep" /><button type="button" className="menu-item" onClick={() => { close(); text.spacing(8, 0) }}>Space before: 8 pt</button><button type="button" className="menu-item" onClick={() => { close(); text.spacing(0, 8) }}>Space after: 8 pt</button><button type="button" className="menu-item" onClick={() => { close(); text.spacing(null, null) }}>No extra space</button></>}</Pop>
        <Pop title="Vertical alignment" disabled={!hasSel} trigger={<Icon name="vmid" />}>{(close) => (['top', 'middle', 'bottom'] as const).map((v) => <button key={v} type="button" className="menu-item" onClick={() => { close(); style.vAlign(v) }}><Icon name={{ top: 'vtop', middle: 'vmid', bottom: 'vbot' }[v]} /> {v[0].toUpperCase() + v.slice(1)}</button>)}</Pop>
      </div>
      <div className="tgroup">
        <Pop title="Fill colour" disabled={!hasSel || isLine} trigger={<span style={{ display: 'grid', placeItems: 'center' }}><Icon name="fill" /><i className="swatch-bar" style={{ background: css(fillColor ?? '@accent1', deck.theme) }} /></span>}>{(close) => <ColorGrid value={fillColor} none="No fill" onPick={(c) => { close(); style.fill(c ? { t: 'solid', c } : undefined) }} />}</Pop>
        <Pop title="Outline" disabled={!hasSel} trigger={<span style={{ display: 'grid', placeItems: 'center' }}><Icon name="outline" /><i className="swatch-bar" style={{ background: css(lineColor ?? '@text', deck.theme) }} /></span>}>{(close) => <>
          <ColorGrid value={lineColor} none="No outline" onPick={(c) => { if (c) style.line({ c }); else style.line({ w: 0 }); close() }} />
          <div className="menu-label">Weight</div>
          <div className="chip-row">{WEIGHTS.map((w) => <button key={w} type="button" onClick={() => { style.line({ w }); close() }}>{w}</button>)}</div>
          <div className="menu-label">Dashes</div>
          <div className="chip-row">{(['solid', 'dash', 'dot', 'dashDot'] as const).map((d) => <button key={d} type="button" onClick={() => { style.line({ dash: d }); close() }}>{{ solid: '——', dash: '– – –', dot: '· · ·', dashDot: '– · –' }[d]}</button>)}</div>
          {isLine && <><div className="menu-label">Arrowheads</div><div className="chip-row">
            {(['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as const).map((a) => <button key={'t' + a} type="button" title={`End: ${a}`} onClick={() => { style.line({ tail: a }); close() }}>→{a === 'none' ? '' : ' ' + a.slice(0, 3)}</button>)}
            {(['none', 'triangle', 'open', 'stealth', 'oval', 'diamond'] as const).map((a) => <button key={'h' + a} type="button" title={`Start: ${a}`} onClick={() => { style.line({ head: a }); close() }}>←{a === 'none' ? '' : ' ' + a.slice(0, 3)}</button>)}</div></>}
        </>}</Pop>
        <Pop title="Shadow" disabled={!hasSel} trigger={<Icon name="shadow" />}>{(close) => SHADOWS.map((s) => <button key={s.label} type="button" className="menu-item" onClick={() => { close(); style.shadow(s.v) }}>{s.label}</button>)}</Pop>
        <Pop title="Arrange" disabled={!hasSel} trigger={<Icon name="front" />}>{(close) => <>
          <button type="button" className="menu-item" onClick={() => { close(); order('front') }}>Bring to front</button><button type="button" className="menu-item" onClick={() => { close(); order('forward') }}>Bring forward</button>
          <button type="button" className="menu-item" onClick={() => { close(); order('backward') }}>Send backward</button><button type="button" className="menu-item" onClick={() => { close(); order('back') }}>Send to back</button><div className="menu-sep" />
          {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((a) => <button key={a} type="button" className="menu-item" onClick={() => { close(); align(a) }}>Align {a}</button>)}
          <button type="button" className="menu-item" disabled={els.length < 3} onClick={() => { close(); distribute('h') }}>Distribute horizontally</button><button type="button" className="menu-item" disabled={els.length < 3} onClick={() => { close(); distribute('v') }}>Distribute vertically</button><div className="menu-sep" />
          <button type="button" className="menu-item" onClick={() => { close(); rotateBy(90) }}>Rotate right 90°</button><button type="button" className="menu-item" onClick={() => { close(); rotateBy(-90) }}>Rotate left 90°</button>
          <button type="button" className="menu-item" onClick={() => { close(); flip('h') }}>Flip horizontally</button><button type="button" className="menu-item" onClick={() => { close(); flip('v') }}>Flip vertically</button>
        </>}</Pop>
        <B icon="group" label="Group" disabled={els.length < 2} onClick={group} />
        <B icon="ungroup" label="Ungroup" disabled={!els.some((e) => e.type === 'group')} onClick={ungroup} />
      </div>
      <div className="tgroup right">
        <B icon="theme" label="Theme" onClick={() => useStore.setState({ dialog: 'theme' })} />
        <B icon="transition" label="Transitions" onClick={() => useStore.setState({ dialog: 'transition' })} />
        <B icon="anim" label="Animations" on={panels.side === 'anim'} onClick={() => useStore.setState({ panels: { ...panels, side: panels.side === 'anim' ? null : 'anim' } })} />
        <B icon="sort" label="Format pane" on={panels.side === 'format'} onClick={() => useStore.setState({ panels: { ...panels, side: panels.side === 'format' ? null : 'format' } })} />
        <button type="button" className="primary present-btn" title="Slide show (F5)" onClick={() => startShow(0)}><Icon name="play" size={16} /> <span className="only-desktop">Present</span></button>
        <Pop title="More ways to present" trigger={<Icon name="down" size={14} />} align="right">{(close) => <>
          <button type="button" className="menu-item" onClick={() => { close(); startShow(0) }}>From the start<span className="key">F5</span></button>
          <button type="button" className="menu-item" onClick={() => { close(); startShow(curIndex()) }}>From this slide</button>
          <button type="button" className="menu-item" onClick={() => { close(); startShow(curIndex(), true) }}>Presenter view (notes and timer)</button></>}</Pop>
      </div>
    </div>
  )
}
export { curSlide, slideTitle, insertShape, insertLine, insertTextBox }
