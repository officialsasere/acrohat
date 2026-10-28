import { useEffect, useRef, useState } from 'react'
import { writeXlsx } from './formats/xlsxWrite'
import { Dialogs } from './components/Dialogs'
import { Grid } from './components/Grid'
import { ContextMenu, SheetTabs, StatusBar, Toasts } from './components/Bars'
import { FormulaBar } from './components/FormulaBar'
import { MenuBar, MobileMenu } from './components/MenuBar'
import { Toolbar } from './components/Toolbar'
import { Icon } from './components/ui'
import { gridApi } from './actions/nav'
import { newBook, openBytes, openDraft, openFile, putDraft, listDrafts, deleteDraft, save, type Draft } from './lib/files'
import { TEMPLATES } from './templates'
import { useBook } from './hooks'
import { useStore } from './store'
import { reportLaunch } from '../../shared/usage'
import { isTauri } from '../../src/lib/platform'

const asset = (f: string) => `${import.meta.env.BASE_URL}${f}`

function Home() {
  const [recents, setRecents] = useState<Draft[]>([])
  useEffect(() => { void listDrafts().then(setRecents) }, [])
  return (
    <div className="home">
      <div className="home-inner">
        <div className="hero">
          <h1>Grid</h1>
          <button type="button" className="ghost" onClick={() => void openFile()}><Icon name="open" size={16} /> Open a file</button>
        </div>
        <h2>Start a new spreadsheet</h2>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => newBook(t.id)}>
              <div className="thumb" aria-hidden><div className="gt">{Array.from({ length: 24 }, (_, i) => <i key={i} className={i < 4 ? 'h' : ''} />)}</div></div>
              <div className="meta"><strong>{t.name}</strong><span>{t.blurb}</span></div>
            </button>
          ))}
        </div>
        <h2>Recent</h2>
        {recents.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>Spreadsheets you work on appear here. They are saved in this browser as you go.</p> : (
          <div className="recent">
            {recents.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="item" onClick={() => openDraft(d)}><Icon name="table" size={18} /><span className="t">{d.title || 'Untitled spreadsheet'}</span><span className="d">{new Date(d.updatedAt).toLocaleDateString()}</span></button>
                <button type="button" aria-label={`Remove ${d.title} from recent`} title="Remove from this list" onClick={async () => { await deleteDraft(d.id); setRecents(await listDrafts()) }}><Icon name="close" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const book = useBook()
  const screen = useStore((s) => s.screen)
  const file = useStore((s) => s.file)
  const theme = useStore((s) => s.theme)
  const formulaBar = useStore((s) => s.formulaBar)
  const dialog = useStore((s) => s.dialog)
  const draftId = useStore((s) => s.draftId)
  const [dropping, setDropping] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => { document.title = `${file.name || 'Untitled spreadsheet'}${file.dirty ? ' •' : ''} – Kwiiva Grid` }, [file.name, file.dirty])
  useEffect(() => { void reportLaunch('grid'); if (navigator.webdriver) (window as unknown as { __kwg: unknown }).__kwg = { store: useStore } }, [])
  useEffect(() => { if (!dialog && screen === 'edit') setTimeout(() => gridApi()?.focus(), 0) }, [dialog, screen])

  // A copy kept in this browser a moment after each change.
  const timer = useRef(0)
  const lastVersion = useRef(book.version)
  useEffect(() => {
    if (screen !== 'edit' || book.version === lastVersion.current) { lastVersion.current = book.version; return }
    lastVersion.current = book.version
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const s = useStore.getState()
      if (s.screen !== 'edit') return
      try {
        const cells = s.book.wb.sheets.reduce((n, sh) => n + sh.cells.size, 0)
        void putDraft({ id: s.draftId, title: s.file.name || 'Untitled spreadsheet', bytes: writeXlsx(s.book), updatedAt: Date.now(), cells })
      } catch (e) { console.error('Could not keep a copy', e) }
    }, 1500)
  }, [book.version, screen, draftId])

  // Desktop: files opened from the OS.
  useEffect(() => {
    if (!isTauri) return
    const take = async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      for (const path of await invoke<string[]>('take_opened_files')) {
        try { openBytes(path.split(/[\\/]/).pop() || path, new Uint8Array(await invoke<ArrayBuffer>('read_doc', { path })), undefined, path) }
        catch (e) { useStore.getState().toast('error', `Could not open ${path}: ${e}`) }
      }
    }
    void take()
    let off: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => listen('open-files', take)).then((u) => (off = u))
    return () => off?.()
  }, [])

  // Files dropped on the window.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDropping(true) } }
    const leave = (e: DragEvent) => { if (e.target === document.documentElement || !e.relatedTarget) setDropping(false) }
    const drop = async (e: DragEvent) => { e.preventDefault(); setDropping(false); const f = e.dataTransfer?.files?.[0]; if (f) openBytes(f.name, new Uint8Array(await f.arrayBuffer())) }
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop) }
  }, [])

  // Shortcuts that are not about cells.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); void save({ saveAs: e.shiftKey }) }
      else if (k === 'o') { e.preventDefault(); void openFile() }
      else if (k === 'p') { e.preventDefault(); void import('./lib/files').then((m) => m.printSheet()) }
      else if (k === 'n' && e.altKey) { e.preventDefault(); newBook() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <header className="titlebar">
        <button type="button" className="only-mobile" aria-label="Open menu" onClick={() => useStore.setState({ menuOpen: true })}><Icon name="menu" /></button>
        <img className="logo only-desktop" src={asset('grid.svg')} alt="Kwiiva Grid" onClick={() => useStore.setState({ screen: 'home' })} />
        <div className="name">
          <input className="title-input" aria-label="Spreadsheet name" value={file.name} onChange={(e) => useStore.setState((s) => ({ file: { ...s.file, name: e.target.value, dirty: true } }))} />
          <div className="only-desktop" style={{ display: 'flex', alignItems: 'center' }}>
            <MenuBar />
            <span className="save-state">{file.dirty ? 'Kept in this browser. Use File → Save to make a file.' : 'All changes kept'}</span>
          </div>
        </div>
        <button type="button" title="Home" aria-label="Home" onClick={() => useStore.setState({ screen: 'home' })}><Icon name="home" /></button>
        <button type="button" className="primary" onClick={() => void save()}>Save</button>
      </header>
      {screen === 'edit' ? (
        <>
          <Toolbar />
          {formulaBar && <FormulaBar />}
          <Grid />
          <SheetTabs />
          <StatusBar />
        </>
      ) : <Home />}
      <MobileMenu />
      <Dialogs />
      <ContextMenu />
      <Toasts />
      {dropping && <div className="drop-hint">Drop a spreadsheet to open it</div>}
    </div>
  )
}
