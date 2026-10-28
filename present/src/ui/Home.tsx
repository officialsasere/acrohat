import { useEffect, useMemo, useState } from 'react'
import { newDeck, openDraft, openFile } from '../lib/files'
import { deleteDraft, listDrafts, type Draft } from '../lib/storage'
import { TEMPLATES } from '../templates'
import { Thumb } from '../render/Thumb'
import { Icon } from './ui'
import { useStore } from '../store'

export function Home() {
  const [recents, setRecents] = useState<Draft[]>([])
  useEffect(() => { void listDrafts().then(setRecents) }, [])
  const built = useMemo(() => TEMPLATES.map((t) => ({ t, deck: t.build() })), [])
  return (
    <div className="home">
      <div className="home-inner">
        <div className="hero">
          <h1>Present</h1>
          <button type="button" className="ghost" onClick={() => void openFile()}><Icon name="open" size={16} /> Open a file</button>
          <button type="button" className="ghost" onClick={() => useStore.setState({ dialog: 'importOutline' })}><Icon name="notes" size={16} /> Make slides from an outline</button>
        </div>
        <h2>Start a new presentation</h2>
        <div className="tpl-grid">
          {built.map(({ t, deck }) => (
            <button key={t.id} type="button" className="tpl" onClick={() => newDeck(t.id)}>
              <div className="thumb" aria-hidden><Thumb deck={deck} slide={deck.slides[0]} width={196} /></div>
              <div className="meta"><strong>{t.name}</strong><span>{t.blurb}</span></div>
            </button>
          ))}
        </div>
        <h2>Recent</h2>
        {recents.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>Presentations you work on appear here. They are saved in this browser as you go.</p> : (
          <div className="recent">
            {recents.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="item" onClick={() => openDraft(d)}><Icon name="slide" size={18} /><span className="t">{d.title || 'Untitled presentation'}</span><span className="d">{d.slides} slides · {new Date(d.updatedAt).toLocaleDateString()}</span></button>
                <button type="button" aria-label={`Remove ${d.title} from recent`} title="Remove from this list" onClick={async () => { await deleteDraft(d.id); setRecents(await listDrafts()) }}><Icon name="close" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
