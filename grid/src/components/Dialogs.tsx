import { useEffect, useMemo, useState } from 'react'
import { FN_DOCS } from '../engine/docs'
import { Book } from '../engine/book'
import { rangeText } from '../engine/address'
import { isUsageEnabled, setUsageEnabled } from '../../../shared/usage'
import { findAll, removeDuplicates, replaceAll, replaceAt, sortRange, textToColumns, type FindHit, type FindOpts, type SortKey } from '../actions/data'
import { pasteBlock, type PasteMode } from '../actions/clipboard'
import { canWrite, startEdit } from '../actions/edit'
import { setColWidth, setRowHeight, insertCols, insertRows, deleteCols, deleteRows } from '../actions/structure'
import { selectCell, selectRange, setSel } from '../actions/nav'
import { fileToImage } from '../lib/images'
import { printSheet } from '../lib/files'
import { useBook } from '../hooks'
import { useStore } from '../store'
import { COLORS, Icon, Modal } from './ui'
import { ChartDialog } from './ChartDialog'
import { CfDialog, FormatDialog, PivotDialog, ValidationDialog } from './MoreDialogs'
import { parseRange } from '../engine/address'
import { currentRegion } from '../actions/nav'
import { dataRect } from '../actions/nav'

const close = () => useStore.setState({ dialog: null, dialogArg: undefined })
const mark = () => useStore.setState((s) => ({ file: { ...s.file, dirty: true } }))
const Foot = ({ onOk, ok = 'OK', cancel = 'Cancel', disabled }: { onOk: () => void; ok?: string; cancel?: string; disabled?: boolean }) => (
  <><button className="ghost" onClick={close}>{cancel}</button><button className="primary" disabled={disabled} onClick={onOk}>{ok}</button></>
)

function FindDialog() {
  const book = useBook()
  const [q, setQ] = useState(useStore.getState().findText)
  const [rep, setRep] = useState('')
  const [o, setO] = useState<FindOpts>({ matchCase: false, whole: false, regex: false, formulas: false, allSheets: false })
  const [hits, setHits] = useState<FindHit[]>([])
  const [i, setI] = useState(0)
  const [msg, setMsg] = useState('')
  useEffect(() => { setHits(findAll(q, o)); setI(0); setMsg('') }, [q, o, book.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (k: number) => {
    if (!hits.length) return
    const n = (k + hits.length) % hits.length
    setI(n)
    const h = hits[n]
    if (h.sheet !== book.activeSheet.id) book.setActive(h.sheet)
    selectCell(h.r, h.c)
  }
  const flag = (k: keyof FindOpts, label: string) => <label className="inline"><input type="checkbox" checked={!!o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} />{label}</label>
  return (
    <Modal title="Find and replace" onClose={close} actions={<button className="ghost" onClick={close}>Close</button>}>
      <label>Find<input autoFocus value={q} onChange={(e) => { setQ(e.target.value); useStore.setState({ findText: e.target.value }) }} onKeyDown={(e) => e.key === 'Enter' && go(e.shiftKey ? i - 1 : i + 1)} /></label>
      <label>Replace with<input value={rep} onChange={(e) => setRep(e.target.value)} /></label>
      <div className="row">{flag('matchCase', 'Match case')}{flag('whole', 'Match entire cell')}{flag('regex', 'Regular expression')}{flag('formulas', 'Also search in formulas')}{flag('allSheets', 'All sheets')}</div>
      <p className="hint">{q ? (hits.length ? `${i + 1} of ${hits.length} found` : 'Nothing found') : 'Type something to look for.'} {msg}</p>
      <div className="row">
        <button className="ghost" onClick={() => go(i - 1)} disabled={!hits.length}>Previous</button>
        <button className="ghost" onClick={() => go(i + 1)} disabled={!hits.length}>Next</button>
        <button className="ghost" disabled={!hits.length} onClick={() => { if (replaceAt(hits[i], q, rep, o)) mark() }}>Replace</button>
        <button className="primary" disabled={!hits.length} onClick={() => { const n = replaceAll(q, rep, o); setMsg(`Replaced ${n}.`) }}>Replace all</button>
      </div>
    </Modal>
  )
}

function LinkDialog() {
  const book = useBook()
  const s = useStore.getState()
  const cell = book.getCell(book.activeSheet.id, s.sel.r, s.sel.c)
  const [url, setUrl] = useState(cell?.link ?? 'https://')
  const [text, setText] = useState(String(book.value(book.activeSheet.id, s.sel.r, s.sel.c) ?? ''))
  const apply = () => {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : url.includes('@') && !url.includes('/') ? 'mailto:' + url.trim() : 'https://' + url.trim()
    if (!canWrite([{ r1: s.sel.r, c1: s.sel.c, r2: s.sel.r, c2: s.sel.c }])) return
    book.transaction('Link', () => { if (text) book.setInput(book.activeSheet.id, s.sel.r, s.sel.c, text); book.patchCell(book.activeSheet.id, s.sel.r, s.sel.c, { link: href }) })
    mark(); close()
  }
  return (
    <Modal title="Insert link" onClose={close} actions={<>{cell?.link && <button className="ghost" onClick={() => { book.patchCell(book.activeSheet.id, s.sel.r, s.sel.c, { link: undefined }); mark(); close() }}>Remove link</button>}<Foot onOk={apply} ok="Apply" /></>}>
      <label>Text to show<input value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label>Address<input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} /></label>
      <p className="hint">Hold Ctrl (or ⌘) and click a linked cell to open it.</p>
    </Modal>
  )
}

function NoteDialog() {
  const book = useBook()
  const s = useStore.getState()
  const cell = book.getCell(book.activeSheet.id, s.sel.r, s.sel.c)
  const [t, setT] = useState(cell?.note ?? '')
  return (
    <Modal title="Note" onClose={close} actions={<>{cell?.note && <button className="ghost" onClick={() => { book.patchCell(book.activeSheet.id, s.sel.r, s.sel.c, { note: undefined }); mark(); close() }}>Delete note</button>}<Foot onOk={() => { book.patchCell(book.activeSheet.id, s.sel.r, s.sel.c, { note: t || undefined }); mark(); close() }} ok="Save" /></>}>
      <textarea autoFocus rows={5} value={t} onChange={(e) => setT(e.target.value)} placeholder="Write a note about this cell" aria-label="Note" />
    </Modal>
  )
}

function SortDialog() {
  const book = useBook()
  const s = useStore.getState()
  const g0 = s.sel.ranges[s.sel.ranges.length - 1]
  const range = g0.r1 === g0.r2 && g0.c1 === g0.c2 ? currentRegion(s.sel.r, s.sel.c) : dataRect(g0)
  const sh = book.activeSheet
  const [header, setHeader] = useState(true)
  const [keys, setKeys] = useState<SortKey[]>([{ col: range.c1, asc: true }])
  const names = Array.from({ length: range.c2 - range.c1 + 1 }, (_, j) => (header ? String(book.value(sh.id, range.r1, range.c1 + j) ?? '') : '') || `Column ${rangeText({ r1: 0, c1: range.c1 + j, r2: 0, c2: range.c1 + j }).replace(/\d+/g, '')}`)
  return (
    <Modal title={`Sort range ${rangeText(range)}`} onClose={close} actions={<Foot ok="Sort" onOk={() => { sortRange(range, keys, header); close() }} />}>
      <label className="inline"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />Data has a header row</label>
      {keys.map((k, i) => (
        <div className="row" key={i}>
          <span>{i ? 'then by' : 'Sort by'}</span>
          <select value={k.col} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, col: Number(e.target.value) } : x)))} aria-label="Column">{names.map((n, j) => <option key={j} value={range.c1 + j}>{n}</option>)}</select>
          <select value={k.asc ? 'a' : 'd'} onChange={(e) => setKeys(keys.map((x, j) => (j === i ? { ...x, asc: e.target.value === 'a' } : x)))} aria-label="Order"><option value="a">A → Z</option><option value="d">Z → A</option></select>
          {keys.length > 1 && <button className="ghost" aria-label="Remove" onClick={() => setKeys(keys.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>}
        </div>
      ))}
      {keys.length < 5 && <button className="ghost" onClick={() => setKeys([...keys, { col: range.c1, asc: true }])}>Add another sort column</button>}
    </Modal>
  )
}

function NamesDialog() {
  const book = useBook()
  const [name, setName] = useState('')
  const [ref, setRef] = useState(() => { const s = useStore.getState(); return `${book.activeSheet.name}!${rangeText(s.sel.ranges.at(-1)!).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}` })
  const names = book.wb.names
  const valid = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)
  const add = () => { book.transaction('Name', () => { const prev = [...book.wb.names]; book.wb.names = [...prev.filter((n) => n.name.toLowerCase() !== name.toLowerCase()), { name, ref }]; }); book.recalc(true); setName(''); mark(); useStore.getState().bump() }
  return (
    <Modal title="Named ranges" onClose={close} actions={<button className="primary" onClick={close}>Done</button>}>
      {names.length === 0 && <p className="hint">No names yet. A name stands for a range or a value, so formulas can say =SUM(Sales) instead of =SUM(B2:B90).</p>}
      <ul className="name-list">
        {names.map((n) => (
          <li key={n.name + (n.scope ?? '')}><b>{n.name}</b><code>{n.ref}</code>
            <button className="ghost" onClick={() => { const t = book.addrToRef(n.name); if (t) { book.setActive(t.sheet); selectRange(t.rect.r1, t.rect.c1, t.rect.r2, t.rect.c2); close() } }}>Go</button>
            <button className="ghost" aria-label={`Delete ${n.name}`} onClick={() => { book.wb.names = book.wb.names.filter((x) => x !== n); book.recalc(true); useStore.getState().bump(); mark() }}><Icon name="trash" size={14} /></button></li>
        ))}
      </ul>
      <div className="row">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sales" /></label>
        <label>Refers to<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
      </div>
      <button className="primary" disabled={!valid || !ref} onClick={add}>Add name</button>
      {name && !valid && <p className="hint bad">A name starts with a letter, has no spaces, and is not a cell address.</p>}
    </Modal>
  )
}

function FunctionDialog() {
  const [q, setQ] = useState('')
  const all = useMemo(() => Book.functionNames(), [])
  const list = all.filter((n) => n.includes(q.toUpperCase()) || (FN_DOCS[n]?.[1] ?? '').toLowerCase().includes(q.toLowerCase())).slice(0, 80)
  const [pick, setPick] = useState<string | null>(null)
  const cur = pick ?? list[0]
  return (
    <Modal title="Insert function" onClose={close} wide actions={<Foot ok="Insert" disabled={!cur} onOk={() => { close(); startEdit({ text: `=${cur}(`, mode: 'edit', caret: cur.length + 2 }) }} />}>
      <input autoFocus placeholder="Search functions, for example SUM or lookup" value={q} onChange={(e) => { setQ(e.target.value); setPick(null) }} aria-label="Search functions" />
      <div className="fn-browser">
        <ul role="listbox">{list.map((n) => <li key={n} role="option" aria-selected={n === cur} className={n === cur ? 'on' : ''} onClick={() => setPick(n)} onDoubleClick={() => { close(); startEdit({ text: `=${n}(`, mode: 'edit', caret: n.length + 2 }) }}>{n}</li>)}</ul>
        <div className="fn-doc">{cur ? <><h3>{cur}</h3><code>{FN_DOCS[cur]?.[0] ?? `${cur}(…)`}</code><p>{FN_DOCS[cur]?.[1] ?? 'See the function name for its purpose. Type it into a cell with an opening bracket to see hints.'}</p></> : <p>No matching function.</p>}</div>
      </div>
      <p className="hint">{all.length} functions available.</p>
    </Modal>
  )
}

function PasteSpecialDialog() {
  const clip = useStore((s) => s.clip)
  const [mode, setMode] = useState<PasteMode>('values')
  const opts: [PasteMode, string][] = [['all', 'Everything'], ['values', 'Values only'], ['formulas', 'Formulas only'], ['formats', 'Formatting only'], ['values+fmt', 'Values and number formats'], ['transpose', 'Transposed (swap rows and columns)'], ['widths', 'Column widths only']]
  return (
    <Modal title="Paste special" onClose={close} actions={<Foot ok="Paste" disabled={!clip} onOk={() => { if (clip) pasteBlock(clip, mode); close() }} />}>
      {!clip && <p className="hint">Copy some cells first. This works with cells copied in this window.</p>}
      {opts.map(([m, l]) => <label key={m} className="inline"><input type="radio" name="ps" checked={mode === m} onChange={() => setMode(m)} />{l}</label>)}
    </Modal>
  )
}

function InsertCellsDialog() {
  const mode = useStore.getState().dialogArg as 'insert' | 'delete'
  const [what, setWhat] = useState<'rows' | 'cols'>('rows')
  const sel = useStore.getState().sel.ranges.at(-1)!
  const n = what === 'rows' ? sel.r2 - sel.r1 + 1 : sel.c2 - sel.c1 + 1
  return (
    <Modal title={mode === 'insert' ? 'Insert' : 'Delete'} onClose={close} actions={<Foot onOk={() => { close(); if (mode === 'insert') (what === 'rows' ? insertRows('above') : insertCols('left')); else (what === 'rows' ? deleteRows() : deleteCols()) }} />}>
      <label className="inline"><input type="radio" checked={what === 'rows'} onChange={() => setWhat('rows')} />{mode === 'insert' ? `Insert ${n} row${n > 1 ? 's' : ''} above` : `Delete the selected row${n > 1 ? 's' : ''}`}</label>
      <label className="inline"><input type="radio" checked={what === 'cols'} onChange={() => setWhat('cols')} />{mode === 'insert' ? `Insert ${n} column${n > 1 ? 's' : ''} to the left` : 'Delete the selected columns'}</label>
    </Modal>
  )
}

function RowColDialog() {
  const axis = useStore.getState().dialogArg as 'row' | 'col'
  const sel = useStore.getState().sel.ranges.at(-1)!
  const book = useBook()
  const L = axis === 'col' ? book.activeSheet.colW.get(sel.c1) ?? book.activeSheet.defaultColW : book.activeSheet.rowH.get(sel.r1) ?? book.activeSheet.defaultRowH
  const [v, setV] = useState(String(Math.round(L)))
  return (
    <Modal title={axis === 'col' ? 'Column width' : 'Row height'} onClose={close} actions={<Foot onOk={() => { const n = Number(v); if (n > 0) { if (axis === 'col') setColWidth(sel.c1, sel.c2, n); else setRowHeight(sel.r1, sel.r2, n) } close() }} />}>
      <label>{axis === 'col' ? 'Width' : 'Height'} in pixels<input autoFocus type="number" min="6" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (document.querySelector('.modal .primary') as HTMLElement)?.click()} /></label>
    </Modal>
  )
}

function GotoDialog() {
  const book = useBook()
  const [t, setT] = useState('')
  const go = () => { const r = book.addrToRef(t.trim()); if (!r) return useStore.getState().toast('error', `"${t}" is not a cell, a range or a name.`); if (r.sheet !== book.activeSheet.id) book.setActive(r.sheet); setSel({ ranges: [r.rect], r: r.rect.r1, c: r.rect.c1, ar: r.rect.r1, ac: r.rect.c1 }); close() }
  return <Modal title="Go to" onClose={close} actions={<Foot onOk={go} ok="Go" />}><label>Cell, range or name<input autoFocus value={t} onChange={(e) => setT(e.target.value)} placeholder="B12 or A1:D20 or Sales" onKeyDown={(e) => e.key === 'Enter' && go()} /></label></Modal>
}

function DedupeDialog() {
  const book = useBook()
  const s = useStore.getState()
  const g0 = s.sel.ranges.at(-1)!
  const range = g0.r1 === g0.r2 && g0.c1 === g0.c2 ? currentRegion(s.sel.r, s.sel.c) : dataRect(g0)
  const [header, setHeader] = useState(true)
  const names = Array.from({ length: range.c2 - range.c1 + 1 }, (_, j) => (header ? String(book.value(book.activeSheet.id, range.r1, range.c1 + j) ?? '') : '') || `Column ${j + 1}`)
  const [cols, setCols] = useState<number[]>(names.map((_, j) => range.c1 + j))
  return (
    <Modal title={`Remove duplicates in ${rangeText(range)}`} onClose={close} actions={<Foot ok="Remove" onOk={() => { const n = removeDuplicates(range, cols, header); useStore.getState().toast(n ? 'success' : 'info', n ? `Removed ${n} duplicate row${n > 1 ? 's' : ''}.` : 'No duplicates found.'); close() }} />}>
      <label className="inline"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />Data has a header row</label>
      <p className="hint">Rows are duplicates when these columns match:</p>
      {names.map((n, j) => <label key={j} className="inline"><input type="checkbox" checked={cols.includes(range.c1 + j)} onChange={(e) => setCols(e.target.checked ? [...cols, range.c1 + j] : cols.filter((c) => c !== range.c1 + j))} />{n}</label>)}
    </Modal>
  )
}

function SplitDialog() {
  const [d, setD] = useState(',')
  const [custom, setCustom] = useState('')
  return (
    <Modal title="Split text to columns" onClose={close} actions={<Foot ok="Split" onOk={() => { textToColumns(d === 'custom' ? custom || ',' : d === 'space' ? ' ' : d === 'tab' ? '\t' : d); close() }} />}>
      <p className="hint">Splits each cell of the selected column into several columns.</p>
      {[[',', 'Comma'], [';', 'Semicolon'], ['space', 'Space'], ['tab', 'Tab'], ['|', 'Pipe'], ['custom', 'Custom']].map(([v, l]) => <label key={v} className="inline"><input type="radio" checked={d === v} onChange={() => setD(v)} />{l}</label>)}
      {d === 'custom' && <input value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Separator" placeholder="Separator" />}
    </Modal>
  )
}

function ProtectDialog() {
  const book = useBook()
  const sh = book.activeSheet
  return (
    <Modal title={sh.protected ? 'Unprotect sheet' : 'Protect sheet'} onClose={close} actions={<Foot ok={sh.protected ? 'Unprotect' : 'Protect'} onOk={() => { book.transaction('Protect', () => book.prop(sh, 'protected', !sh.protected || undefined)); mark(); close() }} />}>
      <p style={{ margin: 0 }}>{sh.protected ? 'Anyone will be able to change this sheet again.' : 'Locked cells cannot be changed while the sheet is protected. All cells are locked unless you unlock them first (Format cells → Protection).'}</p>
      <p className="hint">This keeps accidental edits out. It is not security: the file itself is not encrypted.</p>
    </Modal>
  )
}

function PageSetupDialog() {
  const [landscape, setLandscape] = useState(false)
  const [grid, setGrid] = useState(true)
  const [scale, setScale] = useState(100)
  return (
    <Modal title="Print setup" onClose={close} actions={<Foot ok="Print…" onOk={() => { close(); printSheet({ landscape, gridlines: grid, scale: scale / 100 }) }} />}>
      <label className="inline"><input type="radio" checked={!landscape} onChange={() => setLandscape(false)} />Portrait</label>
      <label className="inline"><input type="radio" checked={landscape} onChange={() => setLandscape(true)} />Landscape</label>
      <label className="inline"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />Show gridlines</label>
      <label>Scale (%)<input type="number" min="30" max="200" value={scale} onChange={(e) => setScale(Number(e.target.value))} /></label>
      <p className="hint">Choose “Save as PDF” in the print window to make a PDF.</p>
    </Modal>
  )
}

function PictureDialog() {
  const book = useBook()
  const add = async (f: File | undefined) => {
    if (!f) return
    const img = await fileToImage(f)
    if (!img) return useStore.getState().toast('error', `${f.name} is not a picture Kwiiva Grid can use.`)
    const sh = book.activeSheet
    book.transaction('Picture', () => book.prop(sh, 'pictures', [...sh.pictures, { id: Math.random().toString(36).slice(2, 9), src: img.src, x: 120, y: 80, w: img.width, h: img.height, alt: f.name }]))
    mark(); close()
  }
  return <Modal title="Insert picture" onClose={close}><input type="file" accept="image/*" aria-label="Picture file" onChange={(e) => void add(e.target.files?.[0])} /><p className="hint">The picture is stored inside the spreadsheet file.</p></Modal>
}

function SheetColorDialog() {
  const id = useStore.getState().dialogArg as number
  const book = useBook()
  const sh = book.sheet(id)
  return (
    <Modal title="Sheet colour" onClose={close}>
      <div className="color-grid">{COLORS.map((c) => <button key={c} type="button" aria-label={c} style={{ background: c }} onClick={() => { book.transaction('Sheet colour', () => book.prop(sh, 'tabColor', c)); close() }} />)}</div>
      <button className="ghost" onClick={() => { book.transaction('Sheet colour', () => book.prop(sh, 'tabColor', undefined)); close() }}>No colour</button>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Move / extend the selection', 'Arrows / Shift+Arrows'], ['Jump to the edge of the data', 'Ctrl+Arrows'], ['Select the whole column / row', 'Ctrl+Space / Shift+Space'], ['Select all', 'Ctrl+A'],
  ['Edit the cell', 'F2 or double-click'], ['New line in a cell', 'Alt+Enter'], ['Accept / cancel an edit', 'Enter / Esc'], ['Next cell in a row', 'Tab'],
  ['Copy / cut / paste', 'Ctrl+C / X / V'], ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Fill down / right', 'Ctrl+D / Ctrl+R'], ['Bold / italic / underline', 'Ctrl+B / I / U'],
  ['Find and replace', 'Ctrl+F'], ['Format cells', 'Ctrl+1'], ['Insert link', 'Ctrl+K'], ['Create or remove a filter', 'Ctrl+Shift+L'], ['AutoSum', 'Alt+='], ['Today’s date / the time', 'Ctrl+; / Ctrl+Shift+;'],
  ['Cycle $ in a reference', 'F4 while typing a formula'], ['Save', 'Ctrl+S'],
]
function ShortcutsDialog() {
  return <Modal title="Keyboard shortcuts" onClose={close}><table className="keys"><tbody>{SHORTCUTS.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table><p className="hint">On a Mac use ⌘ instead of Ctrl.</p></Modal>
}
function PrivacyDialog() {
  const [on, setOn] = useState(isUsageEnabled())
  return (
    <Modal title="Privacy and counters" onClose={close}>
      <p style={{ margin: 0 }}>Your spreadsheets never leave your device. Kwiiva Grid has no accounts, does not read what is in your cells, and uploads nothing.</p>
      <p style={{ margin: 0 }}>To show that people really use Kwiiva, the app sends one tiny message when it opens: the app name, and whether this is the first time on this device. It has no ID, no file names and no data, and the server does not store your address. You can turn it off:</p>
      <label className="inline"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setUsageEnabled(e.target.checked) }} />Count my launches anonymously</label>
      <p className="hint">The totals are public on the Kwiiva website.</p>
    </Modal>
  )
}
function AboutDialog() {
  return <Modal title="About Kwiiva Grid" onClose={close}><p style={{ margin: 0 }}>Kwiiva Grid 0.1.0, a free and open-source spreadsheet. Part of Kwiiva. MIT licensed.</p><p className="hint">Fonts: Carlito, Caladea and Liberation (SIL OFL). Files: .xlsx, .csv, .tsv.</p></Modal>
}

export function Dialogs() {
  const d = useStore((s) => s.dialog)
  switch (d) {
    case 'find': return <FindDialog />
    case 'link': return <LinkDialog />
    case 'note': return <NoteDialog />
    case 'sort': return <SortDialog />
    case 'names': return <NamesDialog />
    case 'function': return <FunctionDialog />
    case 'pasteSpecial': return <PasteSpecialDialog />
    case 'insertCells': return <InsertCellsDialog />
    case 'rowCol': return <RowColDialog />
    case 'goto': return <GotoDialog />
    case 'dedupe': return <DedupeDialog />
    case 'textToColumns': return <SplitDialog />
    case 'protect': return <ProtectDialog />
    case 'pageSetup': return <PageSetupDialog />
    case 'picture': return <PictureDialog />
    case 'sheetColor': return <SheetColorDialog />
    case 'shortcuts': return <ShortcutsDialog />
    case 'privacy': return <PrivacyDialog />
    case 'about': return <AboutDialog />
    case 'chart': return <ChartDialog />
    case 'cf': return <CfDialog />
    case 'format': return <FormatDialog />
    case 'validation': return <ValidationDialog />
    case 'pivot': return <PivotDialog />
    default: return null
  }
}
export { parseRange, selectCell }
