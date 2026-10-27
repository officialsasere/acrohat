import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useMemo, useRef } from 'react'
import { buildExtensions } from './editor/extensions'
import { layoutFor, paperCssVars } from './editor/pageStyle'
import { pageInfo } from './editor/pagination'
import { dialog, ed, goHome, newBlank, openFile, printDoc, save, toggleFind } from './editor/actions'
import { pagePx } from './formats/types'
import { openBytes, putDraft, wordCount } from './lib/files'
import { listDrafts } from './lib/storage'
import { reportLaunch } from '../../shared/usage'
import { isTauri } from '../../src/lib/platform'
import { useStore } from './store'
import { Dialogs } from './components/Dialogs'
import { MenuBar, MobileMenu } from './components/MenuBar'
import { FindBar, Home, Outline, StatusBar } from './components/Panels'
import { Toolbar } from './components/Toolbar'
import { Icon } from './components/ui'

const asset = (f: string) => `${import.meta.env.BASE_URL}${f}`

export default function App() {
  const screen = useStore((s) => s.screen)
  const doc = useStore((s) => s.doc)
  const settings = useStore((s) => s.settings)
  const view = useStore((s) => s.view)
  const zoom = useStore((s) => s.zoom)
  const theme = useStore((s) => s.theme)
  const toasts = useStore((s) => s.toasts)
  const outer = useRef<HTMLDivElement>(null)
  const paper = useRef<HTMLDivElement>(null)

  const extensions = useMemo(
    () => buildExtensions(() => { const s = useStore.getState(); return layoutFor(s.settings, s.view === 'print') }, 'Start writing…'),
    [],
  )
  const editor = useEditor({
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: { attributes: { spellcheck: 'true', 'aria-label': 'Document', role: 'textbox', 'aria-multiline': 'true' }, handleClickOn: (_v, _p, _n, _np, e) => { const a = (e.target as HTMLElement).closest('a'); if (a && (e.ctrlKey || e.metaKey)) { window.open(a.getAttribute('href') ?? '', '_blank', 'noopener'); return true } return false } },
    onUpdate: ({ editor: e }) => {
      useStore.setState((s) => ({ doc: { ...s.doc, dirty: true }, stats: { ...s.stats, words: e.storage.characterCount.words(), chars: e.storage.characterCount.characters() } }))
      scheduleDraft()
    },
  })

  useEffect(() => {
    if (!editor) return
    useStore.setState({ editor })
    // Automated tests drive the editor directly.
    if (navigator.webdriver) (window as unknown as { __kw: typeof editor }).__kw = editor
    let raf = 0
    const tick = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const p = pageInfo(editor.view)
        useStore.setState((s) => ({ tick: s.tick + 1, stats: { ...s.stats, page: p.page, pages: p.total } }))
      })
    }
    editor.on('transaction', tick)
    return () => { editor.off('transaction', tick); cancelAnimationFrame(raf) }
  }, [editor])

  // Drafts: saved in this browser a moment after you stop typing.
  const timer = useRef(0)
  function scheduleDraft() {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const s = useStore.getState()
      if (!s.editor || s.screen !== 'edit') return
      void putDraft({ id: s.doc.id, title: s.doc.title, doc: s.editor.getJSON() as never, settings: s.settings, updatedAt: Date.now(), fileName: s.doc.fileName ?? undefined, words: wordCount(s.editor.getText()) })
    }, 700)
  }
  useEffect(() => { if (screen === 'edit') scheduleDraft() }, [doc.title, settings]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void listDrafts().then((r) => useStore.setState({ recents: r })) }, [screen])

  // Page layout follows the settings.
  useEffect(() => { editor?.commands.refreshLayout() }, [editor, settings, view])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme)
  }, [theme])
  useEffect(() => { document.title = `${doc.title}${doc.dirty ? ' •' : ''} – Kwiiva Write` }, [doc.title, doc.dirty])
  useEffect(() => { void reportLaunch('write') }, [])

  // Desktop: documents opened from the OS (double-click, "Open with").
  useEffect(() => {
    if (!isTauri || !editor) return
    const take = async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      for (const path of await invoke<string[]>('take_opened_files')) {
        try {
          const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_doc', { path }))
          await openBytes(path.split(/[\\/]/).pop() || path, bytes, undefined, path)
        } catch (e) { useStore.getState().toast('error', `Could not open ${path}: ${e}`) }
      }
    }
    void take()
    let off: (() => void) | undefined
    import('@tauri-apps/api/event').then(({ listen }) => listen('open-files', take)).then((u) => (off = u))
    return () => off?.()
  }, [editor])

  // The paper is scaled for zoom; keep the scroll area as tall as the scaled page.
  useEffect(() => {
    const o = outer.current, p = paper.current
    if (!o || !p) return
    const size = () => {
      const z = view === 'print' ? zoom : 1
      o.style.height = view === 'print' ? `${p.offsetHeight * z + 108}px` : ''
      o.style.width = view === 'print' ? `${pagePx(settings).w * z}px` : ''
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(p)
    return () => ro.disconnect()
  }, [zoom, view, settings, screen])

  // On a phone the page shrinks to fit the screen.
  useEffect(() => {
    if (view !== 'print') return
    const fit = () => {
      const w = window.innerWidth
      if (w < 720) useStore.setState({ zoom: Math.max(0.3, Math.min(1, (w - 16) / pagePx(useStore.getState().settings).w)) })
    }
    fit()
  }, [view, settings.size, settings.orientation])

  // Document-editor keyboard shortcuts that the editor itself does not know.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || !useStore.getState().editor) return
      const k = e.key.toLowerCase()
      const inEditor = useStore.getState().screen === 'edit'
      const c = () => ed().chain().focus()
      const go = (fn: () => void) => { e.preventDefault(); fn() }
      if (k === 's') return go(() => save({ saveAs: e.shiftKey }))
      if (k === 'o') return go(openFile)
      if (k === 'n' && e.altKey) return go(newBlank)
      if (!inEditor) return
      if (k === 'p') return go(printDoc)
      if (k === 'f') return go(() => toggleFind(false))
      if (k === 'h') return go(() => toggleFind(true))
      if (k === 'k') return go(() => dialog('link'))
      if (e.altKey || (e.target instanceof HTMLInputElement) || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (k === 'l') return go(() => c().setTextAlign('left').run())
      if (k === 'e') return go(() => c().setTextAlign('center').run())
      if (k === 'r') return go(() => c().setTextAlign('right').run())
      if (k === 'j') return go(() => c().setTextAlign('justify').run())
      if (e.key === ']') return go(() => c().indent().run())
      if (e.key === '[') return go(() => c().outdent().run())
      if (e.key === '\\') return go(() => c().unsetAllMarks().run())
      if (e.key === '=' || e.key === '+') return go(() => useStore.setState((s) => ({ zoom: Math.min(2, Math.round((s.zoom + 0.1) * 10) / 10) })))
      if (e.key === '-') return go(() => useStore.setState((s) => ({ zoom: Math.max(0.4, Math.round((s.zoom - 0.1) * 10) / 10) })))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Desktop: leaving with unsaved edits is safe because drafts are kept, but say so in the title.
  const vars = paperCssVars(settings, view === 'print') as React.CSSProperties
  const style = { ...vars, '--page-h': `${pagePx(settings).h}px` } as React.CSSProperties

  return (
    <div className="app" data-view={view} style={{ ['--canvas' as string]: undefined }}>
      <header className="titlebar">
        <button type="button" className="only-mobile" aria-label="Open menu" onClick={() => useStore.setState({ menuOpen: true })}><Icon name="menu" /></button>
        <img className="logo only-desktop" src={asset('write.svg')} alt="Kwiiva Write" onClick={goHome} />
        <div className="name">
          <input className="title-input" aria-label="Document name" value={doc.title} onChange={(e) => useStore.setState((s) => ({ doc: { ...s.doc, title: e.target.value, dirty: true } }))} />
          <div className="only-desktop" style={{ display: 'flex', alignItems: 'center' }}>
            <MenuBar />
            <span className="save-state">{doc.fileName ? (doc.dirty ? `Unsaved changes to ${doc.fileName}` : `Saved as ${doc.fileName}`) : 'Kept in this browser; use File → Save to make a file'}</span>
          </div>
        </div>
        <button type="button" title="Home" aria-label="Home" onClick={goHome}><Icon name="home" /></button>
        <button type="button" className="primary" onClick={() => save()}>Save</button>
      </header>
      {screen === 'edit' && <Toolbar />}
      <div className="body">
        {screen === 'edit' && <Outline />}
        <main className="canvas" style={{ display: screen === 'edit' ? undefined : 'none' }}>
          {screen === 'edit' && <FindBar />}
          <div className="paper-outer" ref={outer}>
            <div className="paper-scale" style={{ transform: view === 'print' && zoom !== 1 ? `scale(${zoom})` : undefined, width: view === 'print' ? pagePx(settings).w : undefined }}>
              <div className="paper" ref={paper} style={style}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </div>
        </main>
        {screen === 'home' && <Home />}
      </div>
      {screen === 'edit' && <StatusBar />}
      <MobileMenu />
      <Dialogs />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={'toast ' + t.kind} onClick={() => useStore.getState().dismiss(t.id)}>{t.text}</div>)}
      </div>
    </div>
  )
}
