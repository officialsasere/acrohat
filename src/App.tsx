import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Toolbar, TOOL_KEYS } from './components/Toolbar'
import { Viewer } from './components/Viewer'
import { Sidebar } from './components/Sidebar'
import { SearchBar } from './components/SearchBar'
import { SignatureBar } from './components/SignatureBar'
import { OverflowDialog } from './components/OverflowDialog'
import { SignatureDialog, SplitDialog } from './components/Dialogs'
import { ToolsDialog, type Section } from './components/ToolsDialog'
import { LeftRail, ToolsPane } from './components/ToolsPane'
import { Icon } from './components/Icons'
import { call } from './engine/client'
import { autosaver, openFileList, openFiles, openPending, printActive, saveActive } from './lib/files'
import { isTauri } from './lib/platform'
import { isUsageEnabled, reportLaunch, setUsageEnabled } from '../shared/usage'

export default function App() {
  const docs = useStore((s) => s.docs)
  const activeId = useStore((s) => s.activeId)
  const sidebar = useStore((s) => s.sidebar)
  const toasts = useStore((s) => s.toasts)
  const theme = useStore((s) => s.theme)
  const toolsPane = useStore((s) => s.toolsPane)
  const [dialog, setDialog] = useState<'sig' | 'split' | 'tools' | 'tools-sign' | null>(null)
  const [section, setSection] = useState<Section | undefined>()
  const [dropping, setDropping] = useState(false)
  const active = docs.find((d) => d.id === activeId)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    document.title = active ? `${active.dirty ? '• ' : ''}${active.name} — Kwiiva Paper` : 'Kwiiva Paper'
  }, [active?.name, active?.dirty, active])

  useEffect(() => { void reportLaunch('paper') }, [])
  useEffect(() => { if (docs.some((d) => d.dirty && (d.path || d.handle))) autosaver.poke() }, [docs])

  // Desktop: files opened from the OS (double-click, "Open with").
  useEffect(() => {
    if (!isTauri) return
    openPending()
    let off: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => listen('open-files', openPending)).then((u) => (off = u))
    return () => off?.()
  }, [])

  // On a phone the page list is a drawer: close it once a page has been chosen.
  const pendingScroll = useStore((s) => s.pendingScroll)
  useEffect(() => {
    if (pendingScroll !== null && window.matchMedia('(max-width: 720px)').matches) useStore.setState({ sidebar: false })
  }, [pendingScroll])

  // Warn before losing unsaved work.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (docs.some((d) => d.dirty)) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [docs])

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const st = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFiles() }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveActive(e.shiftKey) }
      else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printActive() }
      else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); useStore.setState({ search: { ...st.search, open: true } }) }
      else if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        const d = st.active()
        if (!d) return
        const info = await st.run(() => call(e.shiftKey ? 'redo' : 'undo', { id: d.id }))
        if (info) st.update(d.id, info)
      } else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); st.setZoom(st.zoom * 1.2) }
      else if (mod && e.key === '-') { e.preventDefault(); st.setZoom(st.zoom / 1.2) }
      else if (mod && e.key === '0') { e.preventDefault(); st.setFit(true) }
      else if (!mod && !typing && !e.altKey && TOOL_KEYS[e.key.toLowerCase()] && st.active()) st.setTool(TOOL_KEYS[e.key.toLowerCase()])
      else if (!mod && !typing && st.active()) {
        if (e.key === 'PageDown') st.goToPage(Math.min(st.active()!.info.pageCount - 1, st.page + 1))
        if (e.key === 'PageUp') st.goToPage(Math.max(0, st.page - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="app"
      onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDropping(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false) }}
      onDrop={(e) => { e.preventDefault(); setDropping(false); openFileList(e.dataTransfer.files) }}
    >
      <header className="titlebar">
        <div className="brand"><img src={`${import.meta.env.BASE_URL}paper.svg`} alt="" /> Kwiiva Paper</div>
        <nav className="tabs-bar" aria-label="Open documents">
          {docs.map((d) => (
            <div key={d.id} className={'tab' + (d.id === activeId ? ' active' : '')} onClick={() => useStore.getState().activate(d.id)} title={d.name}>
              <span className="name">{d.dirty ? '• ' : ''}{d.name}</span>
              <button aria-label={`Close ${d.name}`} onClick={(e) => { e.stopPropagation(); useStore.getState().closeDoc(d.id) }}><Icon name="close" size={14} /></button>
            </div>
          ))}
        </nav>
      </header>
      <Toolbar onSignature={() => setDialog('sig')} onSplit={() => setDialog('split')} onTools={() => setDialog('tools')} />
      <SearchBar />
      <SignatureBar onDetails={() => { setSection('sign'); setDialog('tools-sign') }} />
      <main className="main">
        {active && <LeftRail onSignatures={() => { setSection('sign'); setDialog('tools-sign') }} />}
        {active && sidebar && <Sidebar />}
        {active ? <Viewer /> : <Welcome />}
        {toolsPane && <ToolsPane onSection={(s) => { setSection(s); setDialog('tools-sign') }} onSignature={() => setDialog('sig')} />}
      </main>
      {((active && sidebar) || toolsPane) && <div className="sidebar-backdrop" onClick={() => useStore.setState({ sidebar: false, toolsPane: false })} />}
      {active && <footer className="statusbar"><PageNumber /> <span>{active.name}</span></footer>}
      {dropping && <div className="drop-hint">Drop PDF files to open</div>}
      {dialog === 'sig' && <SignatureDialog onClose={() => setDialog(null)} />}
      {dialog === 'split' && active && <SplitDialog onClose={() => setDialog(null)} />}
      <OverflowDialog />
      {dialog === 'tools' && <ToolsDialog onClose={() => setDialog(null)} />}
      {dialog === 'tools-sign' && <ToolsDialog initial={section} onClose={() => setDialog(null)} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind} onClick={() => useStore.getState().dismissToast(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}

function PageNumber() {
  const page = useStore((s) => s.page)
  const doc = useStore((s) => s.active())!
  return (
    <span className="pagenum">
      Page <input
        key={page}
        defaultValue={page + 1}
        aria-label="Page number"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          const n = Number(e.currentTarget.value)
          if (n >= 1 && n <= doc.info.pageCount) useStore.getState().goToPage(n - 1)
        }}
      /> of {doc.info.pageCount}
    </span>
  )
}

function UsageSwitch() {
  const [on, setOn] = useState(isUsageEnabled())
  return (
    <p className="hint" style={{ maxWidth: 520 }}>
      Kwiiva counts app launches anonymously (no files, no ID, no address kept) so the website can show real usage.{' '}
      <button className="link-btn" onClick={() => { setUsageEnabled(!on); setOn(!on) }}>{on ? 'Turn off' : 'Turn on'}</button>
    </p>
  )
}

function Welcome() {
  return (
    <div className="welcome">
      <img className="logo" src={`${import.meta.env.BASE_URL}paper.svg`} alt="" />
      <h1>Kwiiva Paper</h1>
      <p>Edit, convert and sign PDFs. Free and open source. Your files never leave your computer.</p>
      <div className="cta">
        <button className="primary big" onClick={openFiles}>Open a PDF</button>
      </div>
      <p className="hint">or drop a file anywhere in this window</p>
      <UsageSwitch />
    </div>
  )
}
