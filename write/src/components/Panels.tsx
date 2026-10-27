import { useEffect, useRef, useState } from 'react'
import { ed } from '../editor/actions'
import { findKey } from '../editor/find'
import { TEMPLATES } from '../templates'
import { newDocument, openDraft, openFile, removeDraft } from '../lib/files'
import { listDrafts } from '../lib/storage'
import { useStore } from '../store'
import { Icon } from './ui'

export function FindBar() {
  const editor = useStore((s) => s.editor)!
  const { open, replace } = useStore((s) => s.find)
  useStore((s) => s.tick)
  const [q, setQ] = useState('')
  const [r, setR] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [whole, setWhole] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) { input.current?.focus(); input.current?.select() } }, [open, replace])
  useEffect(() => { if (open) editor.commands.setFind({ query: q, matchCase, wholeWord: whole }); else editor.commands.clearFind() }, [open, q, matchCase, whole, editor])
  if (!open) return null
  const st = findKey.getState(editor.state)
  const close = () => { useStore.setState({ find: { open: false, replace: false } }); editor.commands.focus() }
  const go = (d: 1 | -1) => { editor.commands.findNext(d); const m = findKey.getState(editor.state)?.matches[findKey.getState(editor.state)?.current ?? 0]; if (m) editor.chain().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run() }
  return (
    <div className="findbar" role="search">
      <div className="row">
        <input ref={input} value={q} placeholder="Find in document" aria-label="Find in document" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(e.shiftKey ? -1 : 1); if (e.key === 'Escape') close() }} />
        <span className="count">{st?.matches.length ? `${st.current + 1} of ${st.matches.length}` : q ? 'No results' : ''}</span>
        <button type="button" aria-label="Previous match" onClick={() => go(-1)}><Icon name="down" size={16} /></button>
        <button type="button" aria-label="Next match" style={{ transform: 'rotate(180deg)' }} onClick={() => go(1)}><Icon name="down" size={16} /></button>
        <button type="button" aria-label="Close find" onClick={close}><Icon name="close" size={16} /></button>
      </div>
      <div className="row">
        <label><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />Match case</label>
        <label><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />Whole word</label>
        <button type="button" className="ghost" onClick={() => useStore.setState({ find: { open: true, replace: !replace } })}>{replace ? 'Hide replace' : 'Replace…'}</button>
      </div>
      {replace && (
        <div className="row">
          <input value={r} placeholder="Replace with" aria-label="Replace with" onChange={(e) => setR(e.target.value)} />
          <button type="button" className="ghost" onClick={() => { editor.commands.replaceCurrent(r); go(1) }}>Replace</button>
          <button type="button" className="ghost" onClick={() => editor.commands.replaceAll(r)}>All</button>
        </div>
      )}
    </div>
  )
}

export function Outline() {
  const editor = useStore((s) => s.editor)!
  const show = useStore((s) => s.outline)
  useStore((s) => s.tick)
  if (!show) return null
  const heads: { level: number; text: string; pos: number }[] = []
  editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading' && n.textContent.trim()) heads.push({ level: Number(n.attrs.level), text: n.textContent, pos }); return n.type.name !== 'heading' })
  return (
    <aside className="outline" aria-label="Outline">
      <h3>Outline <button type="button" aria-label="Hide outline" onClick={() => useStore.setState({ outline: false })}><Icon name="close" size={14} /></button></h3>
      <div className="list">
        {heads.length === 0 && <div className="empty">Headings you add appear here, so you can jump around a long document.</div>}
        {heads.map((h, i) => (
          <button key={i} type="button" className="row" style={{ paddingLeft: 8 + (h.level - 1) * 14, fontWeight: h.level === 1 ? 600 : 400 }} onClick={() => {
            editor.chain().setTextSelection(h.pos + 1).scrollIntoView().run()
            ;(editor.view.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            if (window.matchMedia('(max-width: 720px)').matches) useStore.setState({ outline: false })
          }}>{h.text}</button>
        ))}
      </div>
    </aside>
  )
}

export function StatusBar() {
  const s = useStore((x) => x.stats)
  const zoom = useStore((x) => x.zoom)
  const view = useStore((x) => x.view)
  return (
    <footer className="statusbar">
      {view === 'print' && <span>Page {s.page} of {s.pages}</span>}
      <span>{s.words.toLocaleString()} {s.words === 1 ? 'word' : 'words'}</span>
      <span className="spacer" />
      <button type="button" className="only-desktop" title="Toggle outline" aria-label="Toggle outline" onClick={() => useStore.setState((x) => ({ outline: !x.outline }))}><Icon name="outline" size={15} /></button>
      {view === 'print' && (
        <>
          <input type="range" min="40" max="200" step="5" value={Math.round(zoom * 100)} aria-label="Zoom" onChange={(e) => useStore.setState({ zoom: Number(e.target.value) / 100 })} />
          <span style={{ minWidth: 38, textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
        </>
      )}
    </footer>
  )
}

export function Home() {
  const recents = useStore((s) => s.recents)
  useEffect(() => { void listDrafts().then((r) => useStore.setState({ recents: r })) }, [])
  return (
    <div className="home">
      <div className="home-inner">
        <div className="hero">
          <h1>Write</h1>
          <button type="button" className="ghost" onClick={openFile}><Icon name="open" size={16} /> Open a file</button>
        </div>
        <h2>Start a new document</h2>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" className="tpl" onClick={() => newDocument(t.doc(), t.id === 'blank' ? 'Untitled document' : t.name)}>
              <div className="thumb" aria-hidden>
                <div className="h" /><div className="l" style={{ width: '90%' }} /><div className="l" style={{ width: '80%' }} /><div className="l" style={{ width: '88%' }} /><div className="l" style={{ width: '60%' }} />
              </div>
              <div className="meta"><strong>{t.name}</strong><span>{t.blurb}</span></div>
            </button>
          ))}
        </div>
        <h2>Recent</h2>
        {recents.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>Documents you write appear here. They are saved in this browser as you type.</p> : (
          <div className="recent">
            {recents.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="item" onClick={() => openDraft(d.id)}>
                  <Icon name="file" size={18} /><span className="t">{d.title || 'Untitled document'}</span><span className="d">{d.words.toLocaleString()} words · {new Date(d.updatedAt).toLocaleDateString()}</span>
                </button>
                <button type="button" aria-label={`Remove ${d.title} from recent`} title="Remove from this list" onClick={async () => { await removeDraft(d.id); useStore.setState({ recents: (await listDrafts()) }) }}><Icon name="close" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const editorFocus = () => ed().commands.focus()
