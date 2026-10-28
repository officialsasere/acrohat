import { useEffect, useState } from 'react'
import { rangeText, parseRange } from '../engine/address'
import { buildPivot, type Agg, type PivotSpec } from '../engine/pivot'
import { BUILTIN_FORMATS, formatValue } from '../engine/numfmt'
import type { CfColor, CfRule, CellStyle, Validation } from '../engine/model'
import { FONTS } from '../../../shared/fonts'
import { activeStyle, applyStyle, borders, type BorderKind } from '../actions/format'
import { currentRegion, dataRect } from '../actions/nav'
import { useBook } from '../hooks'
import { useStore } from '../store'
import { ColorGrid, Icon, Modal, Pop } from './ui'
import { MONTHS } from '../engine/dates'

const close = () => useStore.setState({ dialog: null, dialogArg: undefined })
const mark = () => useStore.setState((s) => ({ file: { ...s.file, dirty: true } }))
const uid = () => Math.random().toString(36).slice(2, 9)
const Foot = ({ onOk, ok = 'OK', disabled }: { onOk: () => void; ok?: string; disabled?: boolean }) => <><button className="ghost" onClick={close}>Cancel</button><button className="primary" disabled={disabled} onClick={onOk}>{ok}</button></>
const Swatch = ({ c, onPick, label, none }: { c?: string; onPick: (c: string | undefined) => void; label: string; none: string }) => (
  <Pop title={label} trigger={<span className="swatch-btn"><span style={{ background: c ?? 'transparent' }} />{label}</span>}>{(cl) => <ColorGrid value={c} none={none} onPick={(x) => { onPick(x); cl() }} />}</Pop>
)

// ================================================================ Format cells
const CATS = ['General', 'Number', 'Currency', 'Percent', 'Date', 'Time', 'Scientific', 'Fraction', 'Text', 'Custom'] as const
const DATES = ['m/d/yyyy', 'mm/dd/yyyy', 'd/m/yyyy', 'yyyy-mm-dd', 'd mmm yyyy', 'mmm d, yyyy', 'mmmm d, yyyy', 'dddd, mmmm d, yyyy', 'm/d/yy', 'mmm-yy', 'm/d/yyyy h:mm']
const TIMES = ['h:mm', 'h:mm:ss', 'h:mm AM/PM', 'h:mm:ss AM/PM', 'hh:mm', 'hh:mm:ss', '[h]:mm:ss']
function catOf(f: string): (typeof CATS)[number] {
  if (f === 'General') return 'General'
  if (/%/.test(f)) return 'Percent'
  if (/E[+-]0/i.test(f)) return 'Scientific'
  if (/\?\/|#\s\?/.test(f)) return 'Fraction'
  if (f === '@') return 'Text'
  if (/[$€£¥]/.test(f)) return 'Currency'
  if (/[dy]|h:|AM\/PM/i.test(f.replace(/"[^"]*"/g, ''))) return /^[hHs\[]/.test(f) ? 'Time' : 'Date'
  if (/^#,##0(\.0+)?$|^0(\.0+)?$|^#,##0(\.0+)?;/.test(f)) return 'Number'
  return 'Custom'
}
export function FormatDialog() {
  const book = useBook()
  const s = useStore.getState()
  const st = activeStyle()
  const v = book.value(book.activeSheet.id, s.sel.r, s.sel.c)
  const [tab, setTab] = useState<'number' | 'align' | 'font' | 'border' | 'fill' | 'protect'>('number')
  const [fmt, setFmt] = useState(st.fmt ?? 'General')
  const [cat, setCat] = useState<(typeof CATS)[number]>(catOf(fmt))
  const [dec, setDec] = useState(/\.(0+)/.exec(fmt)?.[1].length ?? 2)
  const [thou, setThou] = useState(/#,##0/.test(fmt))
  const [cur, setCur] = useState(/([$€£¥₹])/.exec(fmt)?.[1] ?? '$')
  const [p, setP] = useState<CellStyle>({ ...st })
  const [bs, setBs] = useState<'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'>('thin')
  const [bc, setBc] = useState('#000000')
  const sample = v ?? 1234.5
  const build = (c: (typeof CATS)[number], d = dec, t = thou, cu = cur) => {
    const z = d ? '.' + '0'.repeat(d) : ''
    if (c === 'General') return 'General'
    if (c === 'Number') return (t ? '#,##0' : '0') + z
    if (c === 'Currency') return `${cu}#,##0${z}`
    if (c === 'Percent') return '0' + z + '%'
    if (c === 'Scientific') return '0' + z + 'E+00'
    if (c === 'Fraction') return '# ?/?'
    if (c === 'Text') return '@'
    if (c === 'Date') return DATES.includes(fmt) ? fmt : 'm/d/yyyy'
    if (c === 'Time') return TIMES.includes(fmt) ? fmt : 'h:mm AM/PM'
    return fmt
  }
  const pick = (c: (typeof CATS)[number]) => { setCat(c); setFmt(build(c)) }
  const apply = () => {
    applyStyle({ ...p, fmt: fmt === 'General' ? undefined : fmt }, 'Format cells')
    close()
  }
  const up = (x: Partial<CellStyle>) => setP({ ...p, ...x })
  const prev = formatValue(typeof sample === 'string' ? sample : (sample as number), fmt)
  const tabs: [typeof tab, string][] = [['number', 'Number'], ['align', 'Alignment'], ['font', 'Font'], ['border', 'Borders'], ['fill', 'Fill'], ['protect', 'Protection']]
  return (
    <Modal title="Format cells" wide onClose={close} actions={<Foot onOk={apply} ok="Apply" />}>
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'number' && (
        <div className="fmt-grid">
          <ul className="cat-list" role="listbox">{CATS.map((c) => <li key={c} role="option" aria-selected={c === cat} className={c === cat ? 'on' : ''} onClick={() => pick(c)}>{c}</li>)}</ul>
          <div className="fmt-form">
            <div className="fmt-preview" aria-live="polite">Sample: <b style={{ color: prev.color }}>{prev.text || '(empty)'}</b></div>
            {['Number', 'Currency', 'Percent', 'Scientific'].includes(cat) && <label>Decimal places<input type="number" min="0" max="10" value={dec} onChange={(e) => { const d = Math.max(0, Math.min(10, Number(e.target.value))); setDec(d); setFmt(build(cat, d)) }} /></label>}
            {cat === 'Number' && <label className="inline"><input type="checkbox" checked={thou} onChange={(e) => { setThou(e.target.checked); setFmt(build(cat, dec, e.target.checked)) }} />Use a thousands separator</label>}
            {cat === 'Currency' && <label>Symbol<select value={cur} onChange={(e) => { setCur(e.target.value); setFmt(build(cat, dec, thou, e.target.value)) }}>{['$', '€', '£', '¥', '₹', '₦', 'R$', 'CHF '].map((x) => <option key={x}>{x}</option>)}</select></label>}
            {cat === 'Date' && <label>Type<select size={6} value={fmt} onChange={(e) => setFmt(e.target.value)}>{DATES.map((d) => <option key={d} value={d}>{formatValue(46095.5625, d).text}   ({d})</option>)}</select></label>}
            {cat === 'Time' && <label>Type<select size={5} value={fmt} onChange={(e) => setFmt(e.target.value)}>{TIMES.map((d) => <option key={d} value={d}>{formatValue(0.5625, d).text}   ({d})</option>)}</select></label>}
            <label>Format code<input value={fmt} onChange={(e) => { setFmt(e.target.value || 'General'); setCat(catOf(e.target.value)) }} aria-label="Format code" /></label>
            <p className="hint">0 shows a digit, # a digit only when needed, , groups thousands, % multiplies by 100. Sections are separated by ; (positive; negative; zero; text). [Red] colours a section.</p>
          </div>
        </div>
      )}
      {tab === 'align' && (
        <div className="stack">
          <label>Horizontal<select value={p.h ?? ''} onChange={(e) => up({ h: (e.target.value || undefined) as CellStyle['h'] })}><option value="">General</option><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option><option value="justify">Justify</option></select></label>
          <label>Vertical<select value={p.v ?? 'bottom'} onChange={(e) => up({ v: e.target.value as CellStyle['v'] })}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
          <label>Indent<input type="number" min="0" max="15" value={p.indent ?? 0} onChange={(e) => up({ indent: Number(e.target.value) || undefined })} /></label>
          <label>Text rotation (degrees)<input type="number" min="-90" max="90" value={p.rotate ?? 0} onChange={(e) => up({ rotate: Number(e.target.value) || undefined })} /></label>
          <label>Wrapping<select value={String(p.wrap ?? 'false')} onChange={(e) => up({ wrap: e.target.value === 'true' ? true : e.target.value === 'clip' ? 'clip' : false })}><option value="false">Overflow into empty cells</option><option value="true">Wrap text</option><option value="clip">Clip</option></select></label>
        </div>
      )}
      {tab === 'font' && (
        <div className="stack">
          <label>Font<select value={p.font ?? 'Calibri'} onChange={(e) => up({ font: e.target.value === 'Calibri' ? undefined : e.target.value })}>{FONTS.map((f) => <option key={f.name}>{f.name}</option>)}</select></label>
          <label>Size<input type="number" min="4" max="200" value={p.size ?? 11} onChange={(e) => up({ size: Number(e.target.value) || undefined })} /></label>
          <div className="row">{(['bold', 'italic', 'underline', 'strike'] as const).map((k) => <label key={k} className="inline"><input type="checkbox" checked={!!p[k]} onChange={(e) => up({ [k]: e.target.checked || undefined })} />{k === 'strike' ? 'Strikethrough' : k[0].toUpperCase() + k.slice(1)}</label>)}</div>
          <Swatch c={p.color} onPick={(c) => up({ color: c })} label="Text colour" none="Automatic" />
          <div className="font-preview" style={{ fontFamily: p.font, fontSize: (p.size ?? 11) * 1.3, fontWeight: p.bold ? 700 : 400, fontStyle: p.italic ? 'italic' : 'normal', textDecoration: [p.underline && 'underline', p.strike && 'line-through'].filter(Boolean).join(' '), color: p.color, background: p.bg }}>AaBbYyZz 0123</div>
        </div>
      )}
      {tab === 'border' && (
        <div className="stack">
          <div className="row">
            <label>Style<select value={bs} onChange={(e) => setBs(e.target.value as typeof bs)}>{['thin', 'medium', 'thick', 'dashed', 'dotted', 'double'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Colour<input type="color" value={bc} onChange={(e) => setBc(e.target.value)} /></label>
          </div>
          <div className="row">
            {(['outer', 'inner', 'all', 'top', 'bottom', 'left', 'right', 'horizontal', 'vertical', 'none'] as BorderKind[]).map((k) => <button key={k} className="ghost" onClick={() => borders(k, bs, bc)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
          <p className="hint">Borders are applied to the selected cells as you click.</p>
        </div>
      )}
      {tab === 'fill' && <div className="stack"><ColorGrid value={p.bg} none="No fill" onPick={(c) => up({ bg: c })} /></div>}
      {tab === 'protect' && <div className="stack"><label className="inline"><input type="checkbox" checked={p.locked !== false} onChange={(e) => up({ locked: e.target.checked ? undefined : false })} />Locked</label><p className="hint">Locked cells cannot be changed once the sheet is protected (Data → Protect sheet).</p></div>}
    </Modal>
  )
}

// ================================================================ Conditional formatting
const CF_TYPES: [CfRule['type'], string][] = [['cell', 'Cell value is…'], ['text', 'Text…'], ['blanks', 'Is empty'], ['noblanks', 'Is not empty'], ['errors', 'Has an error'], ['duplicates', 'Duplicate values'], ['unique', 'Unique values'], ['top', 'Top or bottom values'], ['above', 'Above or below average'], ['date', 'Date is…'], ['formula', 'Custom formula'], ['scale', 'Colour scale'], ['bar', 'Data bar']]
const describe = (r: CfRule) => ({ cell: `Value ${r.op} ${r.v1 ?? ''}${r.v2 ? ' and ' + r.v2 : ''}`, text: `Text ${r.op} “${r.v1 ?? ''}”`, blanks: 'Is empty', noblanks: 'Is not empty', errors: 'Has an error', noerrors: 'No error', duplicates: 'Duplicates', unique: 'Unique values', top: `${r.op === 'bottom' ? 'Bottom' : 'Top'} ${r.n}${r.percent ? '%' : ''}`, above: r.op === 'below' ? 'Below average' : 'Above average', date: `Date is ${r.op}`, formula: `Formula ${r.formula}`, scale: 'Colour scale', bar: 'Data bar' }[r.type])
export function CfDialog() {
  const book = useBook()
  const s = useStore.getState()
  const sh = book.activeSheet
  const g = s.sel.ranges.at(-1)!
  const [editing, setEditing] = useState<CfRule | null>(null)
  const rules = sh.cf
  const save = (r: CfRule) => { book.transaction('Conditional format', () => book.prop(sh, 'cf', rules.some((x) => x.id === r.id) ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r])); mark(); setEditing(null) }
  const blank = (): CfRule => ({ id: uid(), ranges: [{ ...g }], type: 'cell', op: '>', v1: '0', style: { bg: '#f4cccc', color: '#990000' } })
  if (editing) return <CfForm rule={editing} onCancel={() => setEditing(null)} onSave={save} />
  return (
    <Modal title="Conditional formatting" wide onClose={close} actions={<button className="primary" onClick={close}>Done</button>}>
      {rules.length === 0 && <p className="hint">No rules on this sheet yet. A rule colours cells when they meet a condition.</p>}
      <ul className="rule-list">
        {rules.map((r, i) => (
          <li key={r.id}>
            <span className="rule-sw" style={{ background: r.style?.bg ?? (r.type === 'scale' ? 'linear-gradient(90deg,' + r.scale!.min.color + ',' + r.scale!.max.color + ')' : r.bar?.color ?? '#eee'), color: r.style?.color }}>Aa</span>
            <div><b>{describe(r)}</b><div className="hint">{r.ranges.map((x) => rangeText(x)).join(', ')}</div></div>
            <button className="ghost" onClick={() => setEditing(r)}>Edit</button>
            <button className="ghost" aria-label="Move up" disabled={i === 0} onClick={() => book.transaction('Reorder', () => { const a = [...rules]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; book.prop(sh, 'cf', a) })}>↑</button>
            <button className="ghost" aria-label="Delete rule" onClick={() => { book.transaction('Delete rule', () => book.prop(sh, 'cf', rules.filter((x) => x.id !== r.id))); mark() }}><Icon name="trash" size={14} /></button>
          </li>
        ))}
      </ul>
      <button className="primary" onClick={() => setEditing(blank())}>Add a rule</button>
    </Modal>
  )
}
function CfForm({ rule, onSave, onCancel }: { rule: CfRule; onSave: (r: CfRule) => void; onCancel: () => void }) {
  const [r, setR] = useState<CfRule>(rule)
  const [range, setRange] = useState(rule.ranges.map((x) => rangeText(x)).join(', '))
  const up = (p: Partial<CfRule>) => setR({ ...r, ...p })
  const sty = (p: CellStyle) => setR({ ...r, style: { ...r.style, ...p } })
  const setType = (t: CfRule['type']) => {
    const base: Partial<CfRule> = { type: t }
    if (t === 'cell') Object.assign(base, { op: '>', v1: '0' })
    if (t === 'text') Object.assign(base, { op: 'contains', v1: '' })
    if (t === 'top') Object.assign(base, { op: 'top', n: 10, percent: false })
    if (t === 'above') Object.assign(base, { op: 'above' })
    if (t === 'date') Object.assign(base, { op: 'today' })
    if (t === 'formula') Object.assign(base, { formula: '=A1>0' })
    if (t === 'scale') Object.assign(base, { scale: { min: { type: 'min', color: '#ffffff' } as CfColor, max: { type: 'max', color: '#e06666' } as CfColor } })
    if (t === 'bar') Object.assign(base, { bar: { color: '#c9925b' } })
    up(base)
  }
  const ranges = range.split(',').map((x) => parseRange(x.trim())).filter((x): x is NonNullable<typeof x> => !!x).map((p) => ({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }))
  const styled = !['scale', 'bar'].includes(r.type)
  return (
    <Modal title="Conditional format rule" onClose={onCancel} actions={<><button className="ghost" onClick={onCancel}>Back</button><button className="primary" disabled={!ranges.length} onClick={() => onSave({ ...r, ranges })}>Save rule</button></>}>
      <label>Apply to range<input value={range} onChange={(e) => setRange(e.target.value)} aria-label="Apply to range" />{!ranges.length && <span className="hint bad">Not a valid range</span>}</label>
      <label>Format cells if…<select value={r.type} onChange={(e) => setType(e.target.value as CfRule['type'])}>{CF_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {r.type === 'cell' && <div className="row"><select value={r.op} onChange={(e) => up({ op: e.target.value })} aria-label="Operator">{[['>', 'is greater than'], ['>=', 'is greater than or equal to'], ['<', 'is less than'], ['<=', 'is less than or equal to'], ['=', 'is equal to'], ['<>', 'is not equal to'], ['between', 'is between'], ['notBetween', 'is not between']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input value={r.v1 ?? ''} onChange={(e) => up({ v1: e.target.value })} aria-label="Value" />{(r.op === 'between' || r.op === 'notBetween') && <input value={r.v2 ?? ''} onChange={(e) => up({ v2: e.target.value })} aria-label="Second value" />}</div>}
      {r.type === 'text' && <div className="row"><select value={r.op} onChange={(e) => up({ op: e.target.value })} aria-label="Operator">{[['contains', 'contains'], ['notContains', 'does not contain'], ['begins', 'starts with'], ['ends', 'ends with']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input value={r.v1 ?? ''} onChange={(e) => up({ v1: e.target.value })} aria-label="Text" /></div>}
      {r.type === 'top' && <div className="row"><select value={r.op} onChange={(e) => up({ op: e.target.value })}><option value="top">Top</option><option value="bottom">Bottom</option></select><input type="number" min="1" value={r.n ?? 10} onChange={(e) => up({ n: Number(e.target.value) })} /><label className="inline"><input type="checkbox" checked={!!r.percent} onChange={(e) => up({ percent: e.target.checked })} />percent</label></div>}
      {r.type === 'above' && <select value={r.op} onChange={(e) => up({ op: e.target.value })}><option value="above">Above average</option><option value="below">Below average</option></select>}
      {r.type === 'date' && <select value={r.op} onChange={(e) => up({ op: e.target.value })}>{['today', 'yesterday', 'tomorrow', 'thisweek', 'lastweek', 'thismonth', 'past', 'future'].map((d) => <option key={d} value={d}>{d}</option>)}</select>}
      {r.type === 'formula' && <label>Formula (written for the first cell of the range)<input value={r.formula ?? ''} onChange={(e) => up({ formula: e.target.value })} placeholder="=$B2>100" /></label>}
      {r.type === 'scale' && r.scale && <div className="row">
        <label className="inline">Lowest<input type="color" value={r.scale.min.color} onChange={(e) => up({ scale: { ...r.scale!, min: { ...r.scale!.min, color: e.target.value } } })} /></label>
        <label className="inline"><input type="checkbox" checked={!!r.scale.mid} onChange={(e) => up({ scale: { ...r.scale!, mid: e.target.checked ? { type: 'percentile', value: 50, color: '#ffe599' } : undefined } })} />Middle</label>
        {r.scale.mid && <input type="color" value={r.scale.mid.color} onChange={(e) => up({ scale: { ...r.scale!, mid: { ...r.scale!.mid!, color: e.target.value } } })} aria-label="Middle colour" />}
        <label className="inline">Highest<input type="color" value={r.scale.max.color} onChange={(e) => up({ scale: { ...r.scale!, max: { ...r.scale!.max, color: e.target.value } } })} /></label>
      </div>}
      {r.type === 'bar' && r.bar && <div className="row"><label className="inline">Bar colour<input type="color" value={r.bar.color} onChange={(e) => up({ bar: { ...r.bar!, color: e.target.value } })} /></label><label className="inline"><input type="checkbox" checked={!!r.bar.gradient} onChange={(e) => up({ bar: { ...r.bar!, gradient: e.target.checked } })} />Fade</label></div>}
      {styled && (
        <div className="row">
          <Swatch c={r.style?.bg} onPick={(c) => sty({ bg: c })} label="Fill" none="No fill" />
          <Swatch c={r.style?.color} onPick={(c) => sty({ color: c })} label="Text" none="Automatic" />
          {(['bold', 'italic', 'strike'] as const).map((k) => <label key={k} className="inline"><input type="checkbox" checked={!!r.style?.[k]} onChange={(e) => sty({ [k]: e.target.checked || undefined })} />{k === 'strike' ? 'Strikethrough' : k[0].toUpperCase() + k.slice(1)}</label>)}
          <span className="rule-sw" style={{ background: r.style?.bg, color: r.style?.color, fontWeight: r.style?.bold ? 700 : 400, fontStyle: r.style?.italic ? 'italic' : 'normal', textDecoration: r.style?.strike ? 'line-through' : 'none' }}>Preview</span>
        </div>
      )}
      <label className="inline"><input type="checkbox" checked={!!r.stop} onChange={(e) => up({ stop: e.target.checked })} />Stop here if this rule applies</label>
    </Modal>
  )
}

// ================================================================ Data validation
const V_TYPES: [Validation['type'], string][] = [['list', 'List of items'], ['listRange', 'List from a range'], ['number', 'Number'], ['integer', 'Whole number'], ['date', 'Date'], ['textLength', 'Text length'], ['text', 'Text contains'], ['custom', 'Custom formula'], ['checkbox', 'Check box']]
export function ValidationDialog() {
  const book = useBook()
  const s = useStore.getState()
  const sh = book.activeSheet
  const g = s.sel.ranges.at(-1)!
  const arg = s.dialogArg as string | undefined
  const existing = sh.validations.find((v) => v.ranges.some((r) => s.sel.r >= r.r1 && s.sel.r <= r.r2 && s.sel.c >= r.c1 && s.sel.c <= r.c2))
  const [v, setV] = useState<Validation>(existing ?? { id: uid(), ranges: [{ ...g }], type: arg === 'list' ? 'list' : 'list', list: [], allowBlank: true, dropdown: true, onInvalid: 'stop', op: 'between' })
  const [range, setRange] = useState(v.ranges.map((x) => rangeText(x)).join(', '))
  const [items, setItems] = useState((v.list ?? []).join(', '))
  const up = (p: Partial<Validation>) => setV({ ...v, ...p })
  const ranges = range.split(',').map((x) => parseRange(x.trim())).filter((x): x is NonNullable<typeof x> => !!x).map((p) => ({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }))
  const needsOp = ['number', 'integer', 'date', 'textLength'].includes(v.type)
  const save = () => {
    const next: Validation = { ...v, ranges, list: v.type === 'list' ? items.split(',').map((x) => x.trim()).filter(Boolean) : v.list }
    book.transaction('Data validation', () => book.prop(sh, 'validations', existing ? sh.validations.map((x) => (x.id === next.id ? next : x)) : [...sh.validations, next]))
    mark(); close()
  }
  return (
    <Modal title="Data validation" onClose={close} actions={<>{existing && <button className="ghost danger" onClick={() => { book.transaction('Remove validation', () => book.prop(sh, 'validations', sh.validations.filter((x) => x.id !== existing.id))); mark(); close() }}>Remove</button>}<Foot onOk={save} ok="Save" disabled={!ranges.length} /></>}>
      <label>Apply to<input value={range} onChange={(e) => setRange(e.target.value)} /></label>
      <label>Allow<select value={v.type} onChange={(e) => up({ type: e.target.value as Validation['type'] })}>{V_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {v.type === 'list' && <label>Items, separated by commas<input value={items} onChange={(e) => setItems(e.target.value)} placeholder="Yes, No, Maybe" /></label>}
      {v.type === 'listRange' && <label>Range<input value={v.v1 ?? ''} onChange={(e) => up({ v1: e.target.value })} placeholder="Sheet2!A1:A10" /></label>}
      {needsOp && <div className="row"><select value={v.op} onChange={(e) => up({ op: e.target.value as Validation['op'] })} aria-label="Operator">{[['between', 'between'], ['notBetween', 'not between'], ['=', 'equal to'], ['<>', 'not equal to'], ['>', 'greater than'], ['>=', 'greater than or equal to'], ['<', 'less than'], ['<=', 'less than or equal to']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input value={v.v1 ?? ''} onChange={(e) => up({ v1: e.target.value })} aria-label="Value" />{(v.op === 'between' || v.op === 'notBetween') && <input value={v.v2 ?? ''} onChange={(e) => up({ v2: e.target.value })} aria-label="Second value" />}</div>}
      {v.type === 'text' && <input value={v.v1 ?? ''} onChange={(e) => up({ v1: e.target.value })} aria-label="Text" />}
      {v.type === 'custom' && <label>Formula that must be true<input value={v.v1 ?? ''} onChange={(e) => up({ v1: e.target.value })} placeholder="=COUNTIF($A:$A,A1)=1" /></label>}
      {v.type === 'checkbox' && <div className="row"><label>Checked value<input value={v.checked ?? 'TRUE'} onChange={(e) => up({ checked: e.target.value })} /></label><label>Unchecked value<input value={v.unchecked ?? 'FALSE'} onChange={(e) => up({ unchecked: e.target.value })} /></label></div>}
      <div className="row"><label className="inline"><input type="checkbox" checked={v.allowBlank !== false} onChange={(e) => up({ allowBlank: e.target.checked })} />Allow empty cells</label>{(v.type === 'list' || v.type === 'listRange') && <label className="inline"><input type="checkbox" checked={v.dropdown !== false} onChange={(e) => up({ dropdown: e.target.checked })} />Show drop-down</label>}</div>
      <label>If someone types something else<select value={v.onInvalid} onChange={(e) => up({ onInvalid: e.target.value as 'stop' | 'warning' })}><option value="stop">Refuse it</option><option value="warning">Warn, but allow it</option></select></label>
      <label>Message shown<input value={v.help ?? ''} onChange={(e) => up({ help: e.target.value })} placeholder="Please pick one of the listed values." /></label>
    </Modal>
  )
}

// ================================================================ Pivot table
export function PivotDialog() {
  const book = useBook()
  const s = useStore.getState()
  const sh = book.activeSheet
  const g0 = s.sel.ranges.at(-1)!
  const [range, setRange] = useState(() => rangeText(g0.r1 === g0.r2 && g0.c1 === g0.c2 ? currentRegion(s.sel.r, s.sel.c) : dataRect(g0)))
  const p = parseRange(range)
  const src = p ? { r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 } : null
  const names = src ? Array.from({ length: src.c2 - src.c1 + 1 }, (_, j) => String(book.value(sh.id, src.r1, src.c1 + j) ?? `Column ${j + 1}`)) : []
  const [rows, setRows] = useState<number[]>([])
  const [cols, setCols] = useState<number[]>([])
  const [vals, setVals] = useState<{ col: number; agg: Agg }[]>([])
  const [totals, setTotals] = useState(true)
  useEffect(() => { setRows([]); setCols([]); setVals([]) }, [range])
  const toggle = (list: number[], set: (x: number[]) => void, c: number) => set(list.includes(c) ? list.filter((x) => x !== c) : [...list, c])
  const make = () => {
    if (!src) return
    const spec: PivotSpec = { source: src, rows, cols, values: vals, totals, filterEmpty: true }
    const out = buildPivot(book, sh.id, spec)
    book.transaction('Pivot table', () => {
      const ns = book.addSheet(`Pivot ${book.wb.sheets.length}`)
      out.grid.forEach((row, r) => row.forEach((v, c) => { if (v !== null && v !== '') book.setCellRaw(ns.id, r, c, { v, s: 0 }) }))
      book.setStyle(ns.id, [{ r1: 0, c1: 0, r2: Math.max(0, out.headerRows - 1), c2: out.grid[0].length - 1 }], { bold: true, bg: '#e4cfae', color: '#3a2416' })
      if (totals && rows.length) book.setStyle(ns.id, [{ r1: out.grid.length - 1, c1: 0, r2: out.grid.length - 1, c2: out.grid[0].length - 1 }], { bold: true, bt: { style: 'thin', color: '#000000' } })
      book.setStyle(ns.id, [{ r1: out.headerRows, c1: out.headerCols, r2: out.grid.length - 1, c2: out.grid[0].length - 1 }], { fmt: '#,##0.##' })
      for (let c = 0; c < out.grid[0].length; c++) book.mapSet(ns.colW, c, c < out.headerCols ? 150 : 130)
    })
    mark(); close()
  }
  const AGGS: Agg[] = ['sum', 'count', 'counta', 'average', 'min', 'max', 'median', 'product', 'stdev']
  return (
    <Modal title="Pivot table" wide onClose={close} actions={<Foot ok="Create on a new sheet" onOk={make} disabled={!src || !vals.length} />}>
      <label>Data range (with a header row)<input value={range} onChange={(e) => setRange(e.target.value)} aria-label="Data range" />{!src && <span className="hint bad">Not a valid range</span>}</label>
      <div className="pivot-grid">
        <div><h3>Rows</h3>{names.map((n, j) => <label key={j} className="inline"><input type="checkbox" checked={rows.includes(src!.c1 + j)} onChange={() => toggle(rows, setRows, src!.c1 + j)} />{n}</label>)}</div>
        <div><h3>Columns</h3>{names.map((n, j) => <label key={j} className="inline"><input type="checkbox" checked={cols.includes(src!.c1 + j)} onChange={() => toggle(cols, setCols, src!.c1 + j)} />{n}</label>)}</div>
        <div>
          <h3>Values</h3>
          {names.map((n, j) => {
            const c = src!.c1 + j, cur = vals.find((x) => x.col === c)
            return <div key={j} className="row"><label className="inline"><input type="checkbox" checked={!!cur} onChange={(e) => setVals(e.target.checked ? [...vals, { col: c, agg: 'sum' }] : vals.filter((x) => x.col !== c))} />{n}</label>{cur && <select value={cur.agg} aria-label={`Summarise ${n}`} onChange={(e) => setVals(vals.map((x) => (x.col === c ? { ...x, agg: e.target.value as Agg } : x)))}>{AGGS.map((a) => <option key={a}>{a}</option>)}</select>}</div>
          })}
        </div>
      </div>
      <label className="inline"><input type="checkbox" checked={totals} onChange={(e) => setTotals(e.target.checked)} />Show grand totals</label>
      <p className="hint">The pivot table is a summary of the data as it is now. To update it, make a new one.</p>
    </Modal>
  )
}
export { BUILTIN_FORMATS, MONTHS }
