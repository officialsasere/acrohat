import { call } from '../engine/client'
import { saveActive, openFiles, printActive } from '../lib/files'
import { toggleReadAloud } from '../lib/speech'
import { useStore, type Tool } from '../store'
import { Icon } from './Icons'

const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: 'select', label: 'Select text / annotations', icon: 'select', key: 'V' },
  { id: 'edit', label: 'Edit text', icon: 'edit', key: 'E' },
  { id: 'highlight', label: 'Highlight', icon: 'highlight', key: 'H' },
  { id: 'underline', label: 'Underline', icon: 'underline', key: 'U' },
  { id: 'strikeout', label: 'Strikethrough', icon: 'strikeout', key: 'S' },
  { id: 'pen', label: 'Draw', icon: 'pen', key: 'P' },
  { id: 'rect', label: 'Rectangle', icon: 'rect', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', key: 'O' },
  { id: 'note', label: 'Comment', icon: 'note', key: 'N' },
  { id: 'text', label: 'Add text', icon: 'text', key: 'T' },
  { id: 'image', label: 'Edit images', icon: 'image', key: 'I' },
  { id: 'sign', label: 'Sign / place signature', icon: 'sign', key: 'G' },
  { id: 'redact', label: 'Redact', icon: 'redact', key: 'X' },
]

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id])) as Record<string, Tool>

const COLORS = ['#ffd400', '#ff5252', '#4caf50', '#2196f3', '#9c27b0', '#111111']

export function Toolbar({ onSignature, onSplit, onTools }: { onSignature: () => void; onSplit: () => void; onTools: () => void }) {
  const s = useStore()
  const doc = s.active()
  const apply = async (kind: 'undo' | 'redo') => {
    if (!doc) return
    const info = await s.run(() => call(kind, { id: doc.id }))
    if (info) s.update(doc.id, info)
  }
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="group">
        <button title="Open (Ctrl/⌘+O)" onClick={openFiles}>
          <Icon name="open" />
        </button>
        <button title="Save (Ctrl/⌘+S)" disabled={!doc} onClick={() => saveActive()}>
          <Icon name="save" />
        </button>
        <button title="Undo (Ctrl/⌘+Z)" disabled={!doc?.info.canUndo} onClick={() => apply('undo')}>
          <Icon name="undo" />
        </button>
        <button title="Redo (Ctrl/⌘+Shift+Z)" disabled={!doc?.info.canRedo} onClick={() => apply('redo')}>
          <Icon name="redo" />
        </button>
      </div>
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={s.tool === t.id ? 'active' : ''}
            disabled={!doc}
            title={`${t.label} (${t.key})`}
            aria-pressed={s.tool === t.id}
            onClick={() => {
              if (t.id === 'sign' && !s.signature) onSignature()
              s.setTool(t.id)
            }}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </div>
      <div className="group colors" aria-label="Color">
        {COLORS.map((c) => (
          <button key={c} className={'swatch' + (s.color === c ? ' on' : '')} style={{ background: c }} title={c} onClick={() => s.set({ color: c })} />
        ))}
        <select title="Line width" value={s.strokeWidth} onChange={(e) => s.set({ strokeWidth: Number(e.target.value) })}>
          {[1, 2, 3, 5, 8].map((w) => (
            <option key={w} value={w}>
              {w}pt
            </option>
          ))}
        </select>
        <select title="Text size for Add text" value={s.fontSize} onChange={(e) => s.set({ fontSize: Number(e.target.value) })}>
          {[9, 11, 12, 14, 18, 24, 36].map((w) => (
            <option key={w} value={w}>
              {w}px
            </option>
          ))}
        </select>
      </div>
      <div className="group">
        <button title="Signature…" disabled={!doc} onClick={onSignature}>
          <Icon name="sign" />
          <span className="lbl">Signature</span>
        </button>
        <button title="Split into several PDFs…" disabled={!doc} onClick={onSplit}>
          <Icon name="split" />
          <span className="lbl">Split</span>
        </button>
        <button title="All tools: header/footer, watermark, redaction, certificate signature, password, forms, OCR, compare, export…" onClick={onTools}>
          <Icon name="tools" />
          <span className="lbl">Tools</span>
        </button>
        <button title="Print (Ctrl/⌘+P)" disabled={!doc} onClick={() => printActive()}>
          <Icon name="print" />
        </button>
        <button title="Read the current page aloud" disabled={!doc} onClick={() => toggleReadAloud()}>
          <Icon name="speaker" />
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        <button title="Find (Ctrl/⌘+F)" disabled={!doc} onClick={() => s.set({ search: { ...s.search, open: !s.search.open } })}>
          <Icon name="search" />
        </button>
        <button title="Zoom out (Ctrl/⌘ −)" disabled={!doc} onClick={() => s.setZoom(s.zoom / 1.2)}>
          <Icon name="minus" />
        </button>
        <span className="zoom">{Math.round(s.zoom * 100)}%</span>
        <button title="Zoom in (Ctrl/⌘ +)" disabled={!doc} onClick={() => s.setZoom(s.zoom * 1.2)}>
          <Icon name="plus" />
        </button>
        <button title="Fit width" disabled={!doc} className={s.fitWidth ? 'active' : ''} onClick={() => s.setFit(!s.fitWidth)}>
          <Icon name="fit" />
        </button>
        <button title="Toggle page thumbnails" onClick={s.toggleSidebar}>
          <Icon name="sidebar" />
        </button>
        <button
          title={`Theme: ${s.theme}`}
          onClick={() => {
            const next = s.theme === 'system' ? 'light' : s.theme === 'light' ? 'dark' : 'system'
            localStorage.setItem('acrohat.theme', next)
            s.set({ theme: next })
          }}
        >
          <Icon name="sun" />
        </button>
      </div>
    </div>
  )
}
