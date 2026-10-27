import { printActive } from '../lib/files'
import { useStore, type Tool } from '../store'
import { Icon } from './Icons'

export type ToolsSection = 'pdfa' | 'access' | 'stamp' | 'pages' | 'redact' | 'sign' | 'protect' | 'props' | 'forms' | 'convert' | 'ocr' | 'compare'

type Item = { label: string; hint: string; icon: string; needsDoc: boolean } & ({ tool: Tool } | { section: ToolsSection } | { action: 'pages' | 'print' })

// Named and ordered like the "All tools" list people already know from other PDF editors.
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Create & edit',
    items: [
      { label: 'Edit a PDF', hint: 'Change text and images in place', icon: 'edit', needsDoc: true, tool: 'edit' },
      { label: 'Export a PDF', hint: 'To DOCX, text or images', icon: 'extract', needsDoc: false, section: 'convert' },
      { label: 'Create a PDF', hint: 'From images', icon: 'file', needsDoc: false, section: 'convert' },
      { label: 'Organize pages', hint: 'Reorder, rotate, delete, merge', icon: 'merge', needsDoc: true, action: 'pages' },
      { label: 'Combine, split & crop', hint: 'Merge, extract, split, crop', icon: 'split', needsDoc: true, section: 'pages' },
      { label: 'Header, footer & watermark', hint: 'Page and Bates numbers', icon: 'text', needsDoc: true, section: 'stamp' },
      { label: 'Scan & OCR', hint: 'Make scans searchable', icon: 'search', needsDoc: true, section: 'ocr' },
    ],
  },
  {
    title: 'Review & sign',
    items: [
      { label: 'Comment', hint: 'Notes, highlights, drawings', icon: 'note', needsDoc: true, tool: 'note' },
      { label: 'Fill & Sign', hint: 'Fill forms, place your signature', icon: 'sign', needsDoc: true, tool: 'sign' },
      { label: 'Use a certificate', hint: 'Digitally sign, check signatures', icon: 'sign', needsDoc: true, section: 'sign' },
      { label: 'Prepare a form', hint: 'Build fillable fields', icon: 'rect', needsDoc: true, section: 'forms' },
      { label: 'Compare files', hint: 'See what changed', icon: 'split', needsDoc: true, section: 'compare' },
    ],
  },
  {
    title: 'Protect & standards',
    items: [
      { label: 'Redact a PDF', hint: 'Remove sensitive content for good', icon: 'redact', needsDoc: true, section: 'redact' },
      { label: 'Protect a PDF', hint: 'Password and permissions', icon: 'save', needsDoc: true, section: 'protect' },
      { label: 'Optimize a PDF', hint: 'Make the file smaller', icon: 'save', needsDoc: true, section: 'protect' },
      { label: 'Properties & privacy', hint: 'Metadata, scripts, attachments', icon: 'select', needsDoc: true, section: 'props' },
      { label: 'PDF standards (PDF/A)', hint: 'Convert and preflight', icon: 'file', needsDoc: true, section: 'pdfa' },
      { label: 'Accessibility', hint: 'Tag for screen readers', icon: 'speaker', needsDoc: true, section: 'access' },
      { label: 'Print', hint: 'Ctrl/⌘+P', icon: 'print', needsDoc: true, action: 'print' },
    ],
  },
]

export function ToolsPane({ onSection, onSignature }: { onSection: (s: ToolsSection) => void; onSignature: () => void }) {
  const hasDoc = useStore((s) => !!s.active())
  const tool = useStore((s) => s.tool)
  const run = (it: Item) => {
    const st = useStore.getState()
    if ('tool' in it) {
      if (it.tool === 'sign' && !st.signature) onSignature()
      st.setTool(it.tool)
    } else if ('section' in it) onSection(it.section)
    else if (it.action === 'pages') useStore.setState({ sidebar: true, sidebarTab: 'pages' })
    else printActive()
  }
  return (
    <aside className="toolspane" aria-label="Tools">
      <div className="toolspane-head">
        <strong>Tools</strong>
        <button title="Close tools pane" aria-label="Close tools pane" onClick={() => useStore.getState().toggleToolsPane()}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="toolspane-body">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.items.map((it) => (
              <button
                key={it.label}
                className={'toolrow' + ('tool' in it && tool === it.tool ? ' on' : '')}
                disabled={it.needsDoc && !hasDoc}
                onClick={() => run(it)}
              >
                <span className="ico"><Icon name={it.icon} size={18} /></span>
                <span className="txt"><span className="t">{it.label}</span><span className="h">{it.hint}</span></span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  )
}

/** The thin strip of icons at the far left: page thumbnails, bookmarks, search and signatures. */
export function LeftRail({ onSignatures }: { onSignatures: () => void }) {
  const sidebar = useStore((s) => s.sidebar)
  const tab = useStore((s) => s.sidebarTab)
  const searchOpen = useStore((s) => s.search.open)
  const show = (t: 'pages' | 'outline') => {
    const st = useStore.getState()
    if (st.sidebar && st.sidebarTab === t) useStore.setState({ sidebar: false })
    else useStore.setState({ sidebar: true, sidebarTab: t })
  }
  return (
    <nav className="rail" aria-label="Panels">
      <button title="Page thumbnails" aria-label="Page thumbnails" aria-pressed={sidebar && tab === 'pages'} className={sidebar && tab === 'pages' ? 'active' : ''} onClick={() => show('pages')}><Icon name="file" size={20} /></button>
      <button title="Bookmarks" aria-label="Bookmarks" aria-pressed={sidebar && tab === 'outline'} className={sidebar && tab === 'outline' ? 'active' : ''} onClick={() => show('outline')}><Icon name="list" size={20} /></button>
      <button title="Search this document" aria-label="Search" aria-pressed={searchOpen} className={searchOpen ? 'active' : ''} onClick={() => { const s = useStore.getState().search; useStore.setState({ search: { ...s, open: !s.open } }) }}><Icon name="search" size={20} /></button>
      <button title="Signatures in this document" aria-label="Signatures" onClick={onSignatures}><Icon name="sign" size={20} /></button>
    </nav>
  )
}
