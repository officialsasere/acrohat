import { Fragment } from 'react'
import { applyStyle, borders, clearFormats, merge, setWrap, toggle } from '../actions/format'
import { clearSelection } from '../actions/edit'
import { copy } from '../actions/clipboard'
import { fillDown, fillRight, removeDuplicates, sortSelection, toggleFilter, trimSpaces } from '../actions/data'
import { deleteCols, deleteRows, freeze, freezeAtCursor, hideCols, hideRows, insertCols, insertRows, toggleGridlines, unfreeze } from '../actions/structure'
import { KINDS, newBook, openFile, printSheet, save } from '../lib/files'
import { selectAll } from '../actions/nav'
import { useBook } from '../hooks'
import { useStore, type FileKind } from '../store'
import { Icon, Pop } from './ui'
import { autoSum } from '../shortcuts'
import { removeObject } from './Objects'

type Item = { label: string; key?: string; run?: () => void; checked?: boolean; disabled?: boolean; sub?: Item[] } | 'sep' | { heading: string }
const isSep = (i: Item): i is 'sep' => i === 'sep'
const isHeading = (i: Item): i is { heading: string } => typeof i === 'object' && 'heading' in i
const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const K = (s: string) => (mac ? s.replace('Ctrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : s)
const dlg = (d: NonNullable<ReturnType<typeof useStore.getState>['dialog']>, arg?: unknown) => () => useStore.setState({ dialog: d, dialogArg: arg })

function menus(): { name: string; items: Item[] }[] {
  const s = useStore.getState(), book = s.book, sh = book.activeSheet
  const exportAs = (k: FileKind): Item => ({ label: KINDS[k].label, run: () => save({ kind: k, saveAs: true }) })
  return [
    { name: 'File', items: [
      { label: 'New spreadsheet', run: () => { if (!s.file.dirty || window.confirm('This spreadsheet has changes that are kept in Recent. Start a new one?')) newBook() } },
      { label: 'Open…', key: K('Ctrl+O'), run: () => void openFile() },
      { label: 'Home (templates and recent)', run: () => useStore.setState({ screen: 'home' }) },
      'sep',
      { label: 'Save', key: K('Ctrl+S'), run: () => void save() },
      { label: 'Save as…', key: K('Ctrl+Shift+S'), run: () => void save({ saveAs: true }) },
      { label: 'Download a copy as', sub: (['xlsx', 'csv', 'tsv', 'html', 'json'] as FileKind[]).map(exportAs) },
      { label: 'Print…', key: K('Ctrl+P'), run: () => printSheet() },
      'sep',
      { label: 'Page setup…', run: dlg('pageSetup') },
    ] },
    { name: 'Edit', items: [
      { label: 'Undo', key: K('Ctrl+Z'), disabled: !book.canUndo, run: () => { book.undo(); s.bump() } },
      { label: 'Redo', key: K('Ctrl+Y'), disabled: !book.canRedo, run: () => { book.redo(); s.bump() } },
      'sep',
      { label: 'Cut', key: K('Ctrl+X'), run: () => void copy(true) },
      { label: 'Copy', key: K('Ctrl+C'), run: () => void copy(false) },
      { label: 'Paste special…', run: dlg('pasteSpecial') },
      'sep',
      { label: 'Select all', key: K('Ctrl+A'), run: selectAll },
      { label: 'Clear contents', key: 'Del', run: () => clearSelection('contents') },
      { label: 'Delete selected rows', run: deleteRows },
      { label: 'Delete selected columns', run: deleteCols },
      'sep',
      { label: 'Find and replace…', key: K('Ctrl+F'), run: dlg('find') },
      { label: 'Go to…', key: K('Ctrl+G'), run: dlg('goto') },
    ] },
    { name: 'View', items: [
      { label: 'Freeze', sub: [
        { label: 'No frozen rows or columns', run: unfreeze },
        { label: '1 row', run: () => freeze(1, sh.frozenCols) }, { label: '2 rows', run: () => freeze(2, sh.frozenCols) },
        { label: '1 column', run: () => freeze(sh.frozenRows, 1) }, { label: '2 columns', run: () => freeze(sh.frozenRows, 2) },
        { label: 'Up to the cursor', run: freezeAtCursor },
      ] },
      { label: 'Gridlines', checked: sh.gridlines, run: toggleGridlines },
      { label: 'Row and column headings', checked: s.headings, run: () => useStore.setState({ headings: !s.headings }) },
      { label: 'Formula bar', checked: s.formulaBar, run: () => useStore.setState({ formulaBar: !s.formulaBar }) },
      'sep',
      { label: 'Zoom in', run: () => useStore.setState({ zoom: Math.min(2, Math.round((s.zoom + 0.1) * 10) / 10) }) },
      { label: 'Zoom out', run: () => useStore.setState({ zoom: Math.max(0.5, Math.round((s.zoom - 0.1) * 10) / 10) }) },
      { label: 'Actual size', run: () => useStore.setState({ zoom: 1 }) },
      'sep',
      { label: `Theme: ${s.theme}`, run: () => { const n = s.theme === 'system' ? 'light' : s.theme === 'light' ? 'dark' : 'system'; try { localStorage.setItem('kwiiva-grid.theme', n) } catch { /* private mode */ } useStore.setState({ theme: n }) } },
    ] },
    { name: 'Insert', items: [
      { label: 'Row above', run: () => insertRows('above') }, { label: 'Row below', run: () => insertRows('below') },
      { label: 'Column left', run: () => insertCols('left') }, { label: 'Column right', run: () => insertCols('right') },
      { label: 'Cells…', run: dlg('insertCells', 'insert') },
      'sep',
      { label: 'Chart…', run: dlg('chart') },
      { label: 'Pivot table…', run: dlg('pivot') },
      { label: 'Function…', run: dlg('function') },
      { label: 'AutoSum', key: K('Alt+='), run: autoSum },
      'sep',
      { label: 'Link…', key: K('Ctrl+K'), run: dlg('link') },
      { label: 'Note…', run: dlg('note') },
      { label: 'Picture…', run: dlg('picture') },
      { label: 'Check box', run: () => insertCheckbox() },
      { label: 'Drop-down list…', run: dlg('validation', 'list') },
      'sep',
      { label: 'New sheet', run: () => { const n = book.addSheet(); s.bump(); void n } },
    ] },
    { name: 'Format', items: [
      { label: 'Number', sub: [
        { label: 'Automatic', run: () => applyStyle({ fmt: undefined }) }, { label: 'Plain number  1,000.12', run: () => applyStyle({ fmt: '#,##0.00' }) },
        { label: 'Percent  10.12%', run: () => applyStyle({ fmt: '0.00%' }) }, { label: 'Currency  $1,000.12', run: () => applyStyle({ fmt: '$#,##0.00' }) },
        { label: 'Date  3/14/2026', run: () => applyStyle({ fmt: 'm/d/yyyy' }) }, { label: 'Time  3:59 PM', run: () => applyStyle({ fmt: 'h:mm AM/PM' }) },
        { label: 'Scientific  1.01E+03', run: () => applyStyle({ fmt: '0.00E+00' }) }, { label: 'Plain text', run: () => applyStyle({ fmt: '@' }) },
        { label: 'More formats…', run: dlg('format') },
      ] },
      { label: 'Bold', key: K('Ctrl+B'), run: () => toggle('bold') }, { label: 'Italic', key: K('Ctrl+I'), run: () => toggle('italic') },
      { label: 'Underline', key: K('Ctrl+U'), run: () => toggle('underline') }, { label: 'Strikethrough', key: K('Ctrl+5'), run: () => toggle('strike') },
      'sep',
      { label: 'Wrap text', run: () => setWrap(true) }, { label: 'Overflow text', run: () => setWrap(false) },
      { label: 'Merge cells', run: () => merge('all') }, { label: 'Unmerge', run: () => merge('unmerge') },
      { label: 'Borders: all', run: () => borders('all') }, { label: 'Borders: none', run: () => borders('none') },
      'sep',
      { label: 'Conditional formatting…', run: dlg('cf') },
      { label: 'Format cells…', key: K('Ctrl+1'), run: dlg('format') },
      { label: 'Clear formatting', run: clearFormats },
    ] },
    { name: 'Data', items: [
      { label: 'Sort A → Z', run: () => sortSelection(true) }, { label: 'Sort Z → A', run: () => sortSelection(false) },
      { label: 'Sort range…', run: dlg('sort') },
      { label: 'Create a filter', key: K('Ctrl+Shift+L'), checked: !!sh.filter, run: toggleFilter },
      'sep',
      { label: 'Data validation…', run: dlg('validation') },
      { label: 'Named ranges…', run: dlg('names') },
      { label: sh.protected ? 'Unprotect sheet' : 'Protect sheet…', run: dlg('protect') },
      'sep',
      { label: 'Remove duplicates…', run: dlg('dedupe') },
      { label: 'Trim whitespace', run: trimSpaces },
      { label: 'Split text to columns…', run: dlg('textToColumns') },
      { label: 'Fill down', key: K('Ctrl+D'), run: fillDown }, { label: 'Fill right', key: K('Ctrl+R'), run: fillRight },
      { label: 'Hide rows', run: () => hideRows(true) }, { label: 'Hide columns', run: () => hideCols(true) },
      { label: 'Pivot table…', run: dlg('pivot') },
    ] },
    { name: 'Help', items: [
      { label: 'Keyboard shortcuts', run: dlg('shortcuts') },
      { label: 'Function list', run: dlg('function') },
      { label: 'Privacy and counters', run: dlg('privacy') },
      { label: 'About Kwiiva Grid', run: dlg('about') },
    ] },
  ]
}

function insertCheckbox() {
  const s = useStore.getState(), sh = s.book.activeSheet
  s.book.transaction('Check box', () => {
    s.book.prop(sh, 'validations', [...sh.validations, { id: Math.random().toString(36).slice(2, 9), ranges: s.sel.ranges.map((g) => ({ ...g })), type: 'checkbox', checked: 'TRUE', unchecked: 'FALSE' }])
    for (const g of s.sel.ranges) for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 2000); r++) for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 50); c++) if (s.book.value(sh.id, r, c) === null) s.book.setInput(sh.id, r, c, 'FALSE')
  })
}

function List({ items, close }: { items: Item[]; close: () => void }) {
  return (
    <>
      {items.map((it, i) => {
        if (isSep(it)) return <div key={i} className="menu-sep" />
        if (isHeading(it)) return <div key={i} className="menu-label">{it.heading}</div>
        if (it.sub) return (
          <Fragment key={i}>
            <div className="menu-label">{it.label}</div>
            {it.sub.map((x, j) => (!isSep(x) && !isHeading(x) ? <button key={j} type="button" className="menu-item" style={{ paddingLeft: 22 }} onClick={() => { close(); x.run?.() }}>{x.label}</button> : null))}
          </Fragment>
        )
        return (
          <button key={i} type="button" className="menu-item" disabled={it.disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); it.run?.() }}>
            <span className="chk">{it.checked ? '✓' : ''}</span>{it.label}{it.key && <span className="key">{it.key}</span>}
          </button>
        )
      })}
    </>
  )
}

export function MenuBar() {
  useBook(); useStore((s) => s.tick); useStore((s) => s.sel)
  return (
    <nav className="menubar only-desktop" aria-label="Menu">
      {menus().map((m) => <Pop key={m.name} title={m.name} trigger={m.name} className="menu-btn">{(close) => <List items={m.items} close={close} />}</Pop>)}
    </nav>
  )
}

export function MobileMenu() {
  const open = useStore((s) => s.menuOpen)
  if (!open) return null
  const close = () => useStore.setState({ menuOpen: false })
  return (
    <div className="mobile-menu" role="dialog" aria-label="Menu">
      <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 18 }}>Menu</strong>
        <button type="button" aria-label="Close menu" onClick={close}><Icon name="close" /></button>
      </div>
      {menus().map((m) => <details key={m.name}><summary>{m.name}</summary><List items={m.items} close={close} /></details>)}
    </div>
  )
}
export { removeObject, removeDuplicates }
