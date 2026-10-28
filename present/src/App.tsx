import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { Canvas } from './editor/Canvas'
import { SlidePanel } from './ui/SlidePanel'
import { Toolbar } from './ui/Toolbar'
import { SidePanel } from './ui/SidePanel'
import { Notes } from './ui/Notes'
import { Sorter } from './ui/Sorter'
import { Dialogs } from './ui/Dialogs'
import { ContextMenu, MenuBar, MobileMenu, StatusBar, Toasts } from './ui/Bars'
import { Home } from './ui/Home'
import { Icon } from './ui/ui'
import { Show } from './show/Show'
import { Audience } from './show/Audience'
import { PrintRoot } from './lib/print'
import { useGlobalInput } from './hooks'
import { autosaver, openBytes, save } from './lib/files'
import { autosaveOn } from '../../shared/autosave'
import { putDraft } from './lib/storage'
import { startShow } from './show/start'
import { reportLaunch } from '../../shared/usage'
import { isTauri } from '../../src/lib/platform'

const asset = (f: string) => `${import.meta.env.BASE_URL}${f}`

export default function App() {
  if (new URLSearchParams(location.search).has('audience')) return <Audience />
  return <Editor />
}

function Editor() {
  const screen = useStore((s) => s.screen)
  const file = useStore((s) => s.file)
  const theme = useStore((s) => s.theme)
  const deck = useStore((s) => s.deck)
  const panels = useStore((s) => s.panels)
  const presenting = useStore((s) => s.presenting)
  const draftId = useStore((s) => s.draftId)
  const [dropping, setDropping] = useState(false)
  useGlobalInput()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => { document.title = `${file.name || 'Untitled presentation'}${file.dirty ? ' •' : ''} – Kwiiva Present` }, [file.name, file.dirty])
  useEffect(() => { void reportLaunch('present'); if (navigator.webdriver) (window as unknown as { __kwp: unknown }).__kwp = { store: useStore, openBytes } }, [])

  // A copy kept in this browser a moment after each change.
  const timer = useRef(0)
  const last = useRef(deck)
  useEffect(() => {
    if (screen !== 'edit' || deck === last.current) { last.current = deck; return }
    last.current = deck
    autosaver.poke()
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const s = useStore.getState()
      if (s.screen !== 'edit') return
      void putDraft({ id: s.draftId, title: s.file.name || 'Untitled presentation', deck: s.deck, updatedAt: Date.now(), slides: s.deck.slides.length })
    }, 1500)
  }, [deck, screen, draftId])

  // Desktop: files opened from the OS.
  useEffect(() => {
    if (!isTauri) return
    const take = async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      for (const path of await invoke<string[]>('take_opened_files')) {
        try { await openBytes(path.split(/[\\/]/).pop() || path, new Uint8Array(await invoke<ArrayBuffer>('read_doc', { path })), undefined, path) }
        catch (e) { useStore.getState().toast('error', `Could not open ${path}: ${e}`) }
      }
    }
    void take()
    let off: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => listen('open-files', take)).then((u) => (off = u))
    return () => off?.()
  }, [])

  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) setDropping(true) }
    const end = () => setDropping(false)
    window.addEventListener('dragover', over); window.addEventListener('dragleave', end); window.addEventListener('drop', end)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', end); window.removeEventListener('drop', end) }
  }, [])

  return (
    <div className="app">
      <header className="titlebar">
        <button type="button" className="only-mobile" aria-label="Open menu" onClick={() => useStore.setState({ menuOpen: true })}><Icon name="menu" /></button>
        <img className="logo only-desktop" src={asset('present.svg')} alt="Kwiiva Present" onClick={() => useStore.setState({ screen: 'home' })} />
        <div className="name">
          <input className="title-input" aria-label="Presentation name" value={file.name} onChange={(e) => useStore.setState((s) => ({ file: { ...s.file, name: e.target.value, dirty: true } }))} />
          <div className="only-desktop" style={{ display: 'flex', alignItems: 'center' }}>
            <MenuBar />
            <span className="save-state">{file.path || file.handle ? (autosaveOn() ? (file.dirty ? 'Saving to the file…' : 'All changes saved to the file') : file.dirty ? 'Unsaved changes. Use File → Save' : 'Saved') : file.dirty ? 'Kept in this browser. Save once to choose a file; after that it saves by itself.' : 'All changes kept'}</span>
          </div>
        </div>
        <button type="button" title="Home" aria-label="Home" onClick={() => useStore.setState({ screen: 'home' })}><Icon name="home" /></button>
        {screen === 'edit' && <button type="button" className="only-mobile" aria-label="Format pane" onClick={() => useStore.setState((s) => ({ panels: { ...s.panels, side: s.panels.side ? null : 'format' } }))}><Icon name="sort" /></button>}
        {screen === 'edit' && <button type="button" className="only-mobile" aria-label="Slide show" onClick={() => startShow(0)}><Icon name="play" /></button>}
        <button type="button" className="primary" onClick={() => void save()}>Save</button>
      </header>
      {screen === 'edit' ? (
        <>
          <Toolbar />
          <div className="workspace">
            {panels.slides && <SlidePanel />}
            <div className="center">
              {panels.sorter ? <Sorter /> : <Canvas />}
              {panels.notes && !panels.sorter && <Notes />}
            </div>
            <SidePanel />
          </div>
          <StatusBar />
        </>
      ) : <Home />}
      <MobileMenu />
      <Dialogs />
      <ContextMenu />
      <Toasts />
      {presenting && <Show />}
      {screen === 'edit' && <PrintRoot />}
      {dropping && <div className="drop-hint">Drop a .pptx to open it, or pictures to add them</div>}
    </div>
  )
}
