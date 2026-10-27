import { useState } from 'react'
import { addPageNumbers, ed } from '../editor/actions'
import { FONTS } from '../editor/fonts'
import { SYMBOLS } from '../editor/commands'
import { PAGE_SIZES, type HeaderFooter, type PageSizeName } from '../formats/types'
import { isUsageEnabled, setUsageEnabled } from '../../../shared/usage'
import { useStore } from '../store'
import { Modal } from './ui'

/** Closes the dialog and puts the cursor back in the document, so typing carries on where it left off. */
const close = () => { useStore.setState({ dialog: null }); setTimeout(() => useStore.getState().editor?.commands.focus(), 0) }

export function PageSetupDialog() {
  const s = useStore((x) => x.settings)
  const [size, setSize] = useState<PageSizeName>(s.size)
  const [orientation, setOrientation] = useState(s.orientation)
  const [m, setM] = useState(s.margins)
  const [font, setFont] = useState(s.bodyFont)
  const [pt, setPt] = useState(s.bodySize)
  const field = (k: keyof typeof m, label: string) => <label>{label}<input type="number" step="0.05" min="0" max="5" value={m[k]} onChange={(e) => setM({ ...m, [k]: Math.max(0, Number(e.target.value)) })} /></label>
  return (
    <Modal title="Page setup" onClose={close}>
      <div className="row">
        <label>Paper<select value={size} onChange={(e) => setSize(e.target.value as PageSizeName)}>{Object.entries(PAGE_SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Orientation<select value={orientation} onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
      </div>
      <div className="row">{field('top', 'Top (in)')}{field('bottom', 'Bottom (in)')}{field('left', 'Left (in)')}{field('right', 'Right (in)')}</div>
      <div className="row">
        <label>Normal text font<select value={font} onChange={(e) => setFont(e.target.value)}>{FONTS.map((f) => <option key={f.name}>{f.name}</option>)}</select></label>
        <label>Size (pt)<input type="number" min="6" max="48" step="0.5" value={pt} onChange={(e) => setPt(Number(e.target.value))} /></label>
      </div>
      <div className="actions">
        <button className="ghost" onClick={close}>Cancel</button>
        <button className="primary" onClick={() => { useStore.getState().patchSettings({ size, orientation, margins: m, bodyFont: font, bodySize: pt || 11 }); close(); setTimeout(() => ed().commands.refreshLayout(), 0) }}>Apply</button>
      </div>
    </Modal>
  )
}

export function HeaderFooterDialog() {
  const s = useStore((x) => x.settings)
  const [h, setH] = useState<HeaderFooter>(s.header)
  const [f, setF] = useState<HeaderFooter>(s.footer)
  const row = (label: string, v: HeaderFooter, set: (v: HeaderFooter) => void) => (
    <>
      <strong style={{ fontSize: 13 }}>{label}</strong>
      <div className="row">
        {(['left', 'center', 'right'] as const).map((z) => <label key={z}>{z[0].toUpperCase() + z.slice(1)}<input value={v[z]} onChange={(e) => set({ ...v, [z]: e.target.value })} /></label>)}
      </div>
    </>
  )
  return (
    <Modal title="Header and footer" onClose={close}>
      {row('Header (top of every page)', h, setH)}
      {row('Footer (bottom of every page)', f, setF)}
      <p className="hint">Type <code>{'{page}'}</code> for the page number and <code>{'{pages}'}</code> for the number of pages, for example “Page {'{page}'} of {'{pages}'}”.</p>
      <div className="actions">
        <button className="ghost" onClick={() => { close(); addPageNumbers('center') }}>Just add page numbers</button>
        <button className="primary" onClick={() => { useStore.getState().patchSettings({ header: h, footer: f }); close(); setTimeout(() => ed().commands.refreshLayout(), 0) }}>Apply</button>
      </div>
    </Modal>
  )
}

export function LinkDialog() {
  const editor = ed()
  const existing = editor.getAttributes('link').href as string | undefined
  const { from, to } = editor.state.selection
  const [url, setUrl] = useState(existing ?? 'https://')
  const [text, setText] = useState(editor.state.doc.textBetween(from, to, ' '))
  const apply = () => {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url.trim()) ? url.trim() : url.includes('@') && !url.includes('/') ? 'mailto:' + url.trim() : 'https://' + url.trim()
    const c = editor.chain().focus()
    if (from === to && !existing) c.insertContent({ type: 'text', text: text || href, marks: [{ type: 'link', attrs: { href } }] }).run()
    else c.extendMarkRange('link').setLink({ href }).run()
    close()
  }
  return (
    <Modal title={existing ? 'Edit link' : 'Insert link'} onClose={close}>
      {from === to && !existing && <label>Text to show<input value={text} onChange={(e) => setText(e.target.value)} /></label>}
      <label>Address<input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} /></label>
      <div className="actions">
        {existing && <button className="ghost" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); close() }}>Remove link</button>}
        <button className="ghost" onClick={close}>Cancel</button>
        <button className="primary" onClick={apply}>Apply</button>
      </div>
    </Modal>
  )
}

export function TableDialog() {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [header, setHeader] = useState(true)
  return (
    <Modal title="Insert table" onClose={close}>
      <div className="row">
        <label>Rows<input type="number" min="1" max="50" value={rows} onChange={(e) => setRows(Math.max(1, Math.min(50, Number(e.target.value))))} /></label>
        <label>Columns<input type="number" min="1" max="12" value={cols} onChange={(e) => setCols(Math.max(1, Math.min(12, Number(e.target.value))))} /></label>
      </div>
      <label className="inline"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />&nbsp;First row is a header</label>
      <div className="actions">
        <button className="ghost" onClick={close}>Cancel</button>
        <button className="primary" onClick={() => { ed().chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run(); close() }}>Insert</button>
      </div>
    </Modal>
  )
}

export function SpacingDialog() {
  const editor = ed()
  const a = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph')
  const [line, setLine] = useState<number>(a.lineHeight ?? 1.15)
  const [before, setBefore] = useState<number>(a.spaceBefore ?? 0)
  const [after, setAfter] = useState<number>(a.spaceAfter ?? 8)
  const [first, setFirst] = useState<number>(a.firstLine ?? 0)
  return (
    <Modal title="Paragraph spacing" onClose={close}>
      <div className="row">
        <label>Line spacing<input type="number" step="0.05" min="0.8" max="5" value={line} onChange={(e) => setLine(Number(e.target.value))} /></label>
        <label>First-line indent (pt)<input type="number" step="1" min="-72" max="144" value={first} onChange={(e) => setFirst(Number(e.target.value))} /></label>
      </div>
      <div className="row">
        <label>Space before (pt)<input type="number" min="0" max="144" value={before} onChange={(e) => setBefore(Number(e.target.value))} /></label>
        <label>Space after (pt)<input type="number" min="0" max="144" value={after} onChange={(e) => setAfter(Number(e.target.value))} /></label>
      </div>
      <div className="actions">
        <button className="ghost" onClick={close}>Cancel</button>
        <button className="primary" onClick={() => { editor.chain().focus().setLineHeight(line).setSpacing({ before, after }).setFirstLine(first || null).run(); close() }}>Apply</button>
      </div>
    </Modal>
  )
}

export function SymbolsDialog() {
  return (
    <Modal title="Special characters" onClose={close}>
      <div className="sym-grid">
        {SYMBOLS.map((c, i) => <button key={i} type="button" onClick={() => { ed().chain().focus().insertContent(c).run() }} title={`U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}>{c}</button>)}
      </div>
      <p className="hint">Click a character to insert it. The window stays open so you can add several.</p>
    </Modal>
  )
}

export function StatsDialog() {
  const editor = ed()
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const paragraphs = text.split('\n').filter((l) => l.trim()).length
  const st = useStore.getState().stats
  const row = (k: string, v: string | number) => <tr key={k}><td>{k}</td><td>{v}</td></tr>
  return (
    <Modal title="Document statistics" onClose={close}>
      <table className="keys"><tbody>
        {row('Pages', st.pages)}{row('Words', words.toLocaleString())}{row('Characters (with spaces)', text.replace(/\n/g, '').length.toLocaleString())}
        {row('Characters (no spaces)', text.replace(/\s/g, '').length.toLocaleString())}{row('Paragraphs', paragraphs)}{row('Reading time', `${Math.max(1, Math.round(words / 230))} min`)}
      </tbody></table>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['Bold / Italic / Underline', 'Ctrl+B / I / U'], ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Find / Replace', 'Ctrl+F / Ctrl+H'], ['Insert link', 'Ctrl+K'],
  ['Save / Open / New', 'Ctrl+S / O / Alt+N'], ['Print or save as PDF', 'Ctrl+P'], ['Heading 1 / 2 / 3', 'Ctrl+Alt+1 / 2 / 3'], ['Normal text', 'Ctrl+Alt+0'],
  ['Align left / centre / right / justify', 'Ctrl+L / E / R / J'], ['Bulleted / numbered list', 'Ctrl+Shift+8 / 7'], ['Checklist', 'Ctrl+Shift+9'],
  ['Increase / decrease indent', 'Ctrl+] / Ctrl+['], ['Page break', 'Ctrl+Enter'], ['Superscript / subscript', 'Ctrl+. / Ctrl+,'], ['Clear formatting', 'Ctrl+\\'],
  ['Zoom in / out', 'Ctrl++ / Ctrl+-'],
]
export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" onClose={close}>
      <table className="keys"><tbody>{SHORTCUTS.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
      <p className="hint">On a Mac use ⌘ instead of Ctrl.</p>
    </Modal>
  )
}

export function PrivacyDialog() {
  const [on, setOn] = useState(isUsageEnabled())
  return (
    <Modal title="Privacy and counters" onClose={close}>
      <p style={{ margin: 0 }}>Your documents never leave your device. Kwiiva Write has no accounts, no tracking of what you write, and no uploads.</p>
      <p style={{ margin: 0 }}>To show that people really use Kwiiva, the app sends one tiny message when it opens: just the app name and whether this is the first time on this device. It has no ID, no file names, no text, and the server does not store your address. You can turn it off:</p>
      <label className="inline"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setUsageEnabled(e.target.checked) }} />&nbsp;Count my launches anonymously</label>
      <p className="hint">The totals are public on the Kwiiva website.</p>
    </Modal>
  )
}

export function AboutDialog() {
  return (
    <Modal title="About Kwiiva Write" onClose={close}>
      <p style={{ margin: 0 }}>Kwiiva Write 0.1.0, a free and open-source word processor. Part of Kwiiva. MIT licensed.</p>
      <p className="hint">Fonts: Carlito and Caladea (SIL OFL), Liberation (SIL OFL). Editor: ProseMirror and Tiptap (MIT).</p>
    </Modal>
  )
}

export function Dialogs() {
  const d = useStore((s) => s.dialog)
  switch (d) {
    case 'pageSetup': return <PageSetupDialog />
    case 'headerFooter': return <HeaderFooterDialog />
    case 'link': return <LinkDialog />
    case 'table': return <TableDialog />
    case 'spacing': return <SpacingDialog />
    case 'symbols': return <SymbolsDialog />
    case 'stats': return <StatsDialog />
    case 'shortcuts': return <ShortcutsDialog />
    case 'privacy': return <PrivacyDialog />
    case 'about': return <AboutDialog />
    default: return null
  }
}
