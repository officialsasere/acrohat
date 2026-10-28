import { autosaveOn, setAutosave } from '../../../shared/autosave'
import { Fragment, useState } from 'react'
import { addPageNumbers, dialog, ed, goHome, insertDate, KINDS, newBlank, openFile, pickImage, printDoc, save, speechToggle, toggleFind, toggleTheme } from '../editor/actions'
import { clearFormatting } from '../editor/commands'
import { useStore, type FileKind } from '../store'
import { Icon, Pop } from './ui'

type Item = { label: string; key?: string; run?: () => void; checked?: boolean; disabled?: boolean; sub?: Item[] } | 'sep' | { heading: string }
const isSep = (i: Item): i is 'sep' => i === 'sep'
const isHeading = (i: Item): i is { heading: string } => typeof i === 'object' && 'heading' in i

const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const K = (s: string) => (mac ? s.replace('Ctrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : s)

function menus(): { name: string; items: Item[] }[] {
  const s = useStore.getState()
  const e = s.editor
  const c = () => ed().chain().focus()
  const inTable = !!e?.isActive('table')
  const exportAs = (kind: FileKind) => ({ label: KINDS[kind].label, run: () => save({ saveAs: true, kind }) })
  return [
    {
      name: 'File',
      items: [
        { label: 'New document', key: K('Ctrl+Alt+N'), run: newBlank },
        { label: 'Open…', key: K('Ctrl+O'), run: openFile },
        { label: 'Home (templates and recent)', run: goHome },
        'sep',
        { label: 'Save automatically', checked: autosaveOn(), run: () => { setAutosave(!autosaveOn()); useStore.setState((s) => ({ doc: { ...s.doc } })) } },
        { label: 'Save', key: K('Ctrl+S'), run: () => save() },
        { label: 'Save a copy as', sub: (['docx', 'html', 'md', 'txt'] as FileKind[]).map(exportAs) },
        { label: 'Print / Save as PDF…', key: K('Ctrl+P'), run: printDoc },
        'sep',
        { label: 'Page setup…', run: () => dialog('pageSetup') },
        { label: 'Document statistics', run: () => dialog('stats') },
      ],
    },
    {
      name: 'Edit',
      items: [
        { label: 'Undo', key: K('Ctrl+Z'), run: () => c().undo().run(), disabled: !e?.can().undo() },
        { label: 'Redo', key: K('Ctrl+Y'), run: () => c().redo().run(), disabled: !e?.can().redo() },
        'sep',
        { label: 'Cut', key: K('Ctrl+X'), run: () => { ed().view.focus(); document.execCommand('cut') } },
        { label: 'Copy', key: K('Ctrl+C'), run: () => { ed().view.focus(); document.execCommand('copy') } },
        { label: 'Select all', key: K('Ctrl+A'), run: () => c().selectAll().run() },
        'sep',
        { label: 'Find…', key: K('Ctrl+F'), run: () => toggleFind(false) },
        { label: 'Find and replace…', key: K('Ctrl+H'), run: () => toggleFind(true) },
      ],
    },
    {
      name: 'View',
      items: [
        { label: 'Print layout (pages)', checked: s.view === 'print', run: () => useStore.setState({ view: 'print' }) },
        { label: 'Web layout (fits the screen)', checked: s.view === 'web', run: () => useStore.setState({ view: 'web' }) },
        'sep',
        { label: 'Show outline', checked: s.outline, run: () => useStore.setState((x) => ({ outline: !x.outline })) },
        { label: 'Zoom in', key: K('Ctrl++'), run: () => useStore.setState((x) => ({ zoom: Math.min(2, Math.round((x.zoom + 0.1) * 10) / 10) })) },
        { label: 'Zoom out', key: K('Ctrl+-'), run: () => useStore.setState((x) => ({ zoom: Math.max(0.4, Math.round((x.zoom - 0.1) * 10) / 10) })) },
        { label: 'Actual size', run: () => useStore.setState({ zoom: 1 }) },
        'sep',
        { label: `Theme: ${s.theme}`, run: toggleTheme },
      ],
    },
    {
      name: 'Insert',
      items: [
        { label: 'Picture…', run: pickImage },
        { label: 'Table…', run: () => dialog('table') },
        { label: 'Link…', key: K('Ctrl+K'), run: () => dialog('link') },
        { label: 'Horizontal line', run: () => c().setHorizontalRule().run() },
        { label: 'Page break', key: K('Ctrl+Enter'), run: () => c().insertPageBreak().run() },
        { label: 'Table of contents', run: () => c().insertToc().run() },
        { label: 'Special characters…', run: () => dialog('symbols') },
        { label: "Today's date", run: insertDate },
        'sep',
        { heading: 'Header and footer' },
        { label: 'Page numbers (footer)', run: () => addPageNumbers('center') },
        { label: 'Header and footer text…', run: () => dialog('headerFooter') },
      ],
    },
    {
      name: 'Format',
      items: [
        { label: 'Bold', key: K('Ctrl+B'), checked: e?.isActive('bold'), run: () => c().toggleBold().run() },
        { label: 'Italic', key: K('Ctrl+I'), checked: e?.isActive('italic'), run: () => c().toggleItalic().run() },
        { label: 'Underline', key: K('Ctrl+U'), checked: e?.isActive('underline'), run: () => c().toggleUnderline().run() },
        { label: 'Strikethrough', key: K('Ctrl+Shift+X'), checked: e?.isActive('strike'), run: () => c().toggleStrike().run() },
        { label: 'Superscript', key: K('Ctrl+.'), checked: e?.isActive('superscript'), run: () => c().toggleSuperscript().run() },
        { label: 'Subscript', key: K('Ctrl+,'), checked: e?.isActive('subscript'), run: () => c().toggleSubscript().run() },
        { label: 'Code', checked: e?.isActive('code'), run: () => c().toggleCode().run() },
        'sep',
        { label: 'Align left', key: K('Ctrl+L'), run: () => c().setTextAlign('left').run() },
        { label: 'Centre', key: K('Ctrl+E'), run: () => c().setTextAlign('center').run() },
        { label: 'Align right', key: K('Ctrl+R'), run: () => c().setTextAlign('right').run() },
        { label: 'Justify', key: K('Ctrl+J'), run: () => c().setTextAlign('justify').run() },
        'sep',
        { label: 'Bulleted list', run: () => c().toggleBulletList().run() },
        { label: 'Numbered list', run: () => c().toggleOrderedList().run() },
        { label: 'Checklist', run: () => c().toggleTaskList().run() },
        { label: 'Paragraph spacing…', run: () => dialog('spacing') },
        'sep',
        { label: 'Clear formatting', key: K('Ctrl+\\'), run: () => clearFormatting(ed()) },
      ],
    },
    ...(inTable ? [{
      name: 'Table',
      items: [
        { label: 'Insert row above', run: () => c().addRowBefore().run() },
        { label: 'Insert row below', run: () => c().addRowAfter().run() },
        { label: 'Insert column left', run: () => c().addColumnBefore().run() },
        { label: 'Insert column right', run: () => c().addColumnAfter().run() },
        'sep' as const,
        { label: 'Delete row', run: () => c().deleteRow().run() },
        { label: 'Delete column', run: () => c().deleteColumn().run() },
        { label: 'Delete table', run: () => c().deleteTable().run() },
        'sep' as const,
        { label: 'Merge cells', run: () => c().mergeCells().run() },
        { label: 'Split cell', run: () => c().splitCell().run() },
        { label: 'Header row on/off', run: () => c().toggleHeaderRow().run() },
        { label: 'Shade cell…', sub: ['#fff2cc', '#d9ead3', '#cfe2f3', '#f4cccc', '#ead1dc', '#efefef'].map((col) => ({ label: col, run: () => c().setCellAttribute('backgroundColor', col).run() })).concat([{ label: 'No shading', run: () => c().setCellAttribute('backgroundColor', null as never).run() }]) },
      ],
    }] : []),
    {
      name: 'Tools',
      items: [
        { label: 'Document statistics…', run: () => dialog('stats') },
        { label: 'Read aloud', run: speechToggle },
        { label: 'Special characters…', run: () => dialog('symbols') },
      ],
    },
    {
      name: 'Help',
      items: [
        { label: 'Keyboard shortcuts', run: () => dialog('shortcuts') },
        { label: 'Privacy and counters', run: () => dialog('privacy') },
        { label: 'About Kwiiva Write', run: () => dialog('about') },
      ],
    },
  ]
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
            {it.sub.map((s, j) => (!isSep(s) && !isHeading(s) ? <button key={j} type="button" className="menu-item" style={{ paddingLeft: 22 }} onClick={() => { close(); s.run?.() }}>{s.label}</button> : null))}
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
  useStore((s) => s.tick); useStore((s) => s.view); useStore((s) => s.outline); useStore((s) => s.theme)
  return (
    <nav className="menubar only-desktop" aria-label="Menu">
      {menus().map((m) => (
        <Pop key={m.name} title={m.name} trigger={m.name} className="menu-btn">{(close) => <List items={m.items} close={close} />}</Pop>
      ))}
    </nav>
  )
}

/** On a phone the menus live in a full-screen sheet. */
export function MobileMenu() {
  const open = useStore((s) => s.menuOpen)
  const [, force] = useState(0)
  void force
  if (!open) return null
  const close = () => useStore.setState({ menuOpen: false })
  return (
    <div className="mobile-menu" role="dialog" aria-label="Menu">
      <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 18 }}>Menu</strong>
        <button type="button" aria-label="Close menu" onClick={close}><Icon name="close" /></button>
      </div>
      {menus().map((m) => (
        <details key={m.name}>
          <summary>{m.name}</summary>
          <List items={m.items} close={close} />
        </details>
      ))}
    </div>
  )
}
