import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { K, menus, type Item } from '../menus'
import { Icon, Pop } from './ui'

const isSep = (i: Item): i is 'sep' => i === 'sep'
const isHeading = (i: Item): i is { heading: string } => typeof i === 'object' && 'heading' in i
type Leaf = { label: string; run?: () => void; disabled?: boolean; checked?: boolean; key?: string }

function List({ items, close }: { items: Item[]; close: () => void }) {
  return (
    <>
      {items.map((it, i) => {
        if (isSep(it)) return <div key={i} className="menu-sep" />
        if (isHeading(it)) return <div key={i} className="menu-label">{it.heading}</div>
        if ('sub' in it) return (
          <Fragment key={i}>
            <div className="menu-label">{it.label}</div>
            {it.sub.map((x, j) => (!isSep(x) && !isHeading(x) && !('sub' in x) ? <button key={j} type="button" className="menu-item" style={{ paddingLeft: 22 }} onClick={() => { close(); x.run?.() }}>{x.label}</button> : null))}
          </Fragment>
        )
        const leaf = it as Leaf
        return (
          <button key={i} type="button" className="menu-item" disabled={leaf.disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); leaf.run?.() }}>
            <span className="chk">{leaf.checked ? '✓' : ''}</span>{leaf.label}{leaf.key && <span className="key">{leaf.key}</span>}
          </button>
        )
      })}
    </>
  )
}

export function MenuBar() {
  useStore((s) => s.tick); useStore((s) => s.sel); useStore((s) => s.panels); useStore((s) => s.theme); useStore((s) => s.past.length); useStore((s) => s.future.length)
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 18 }}>Menu</strong>
        <button type="button" aria-label="Close menu" onClick={close}><Icon name="close" /></button>
      </div>
      {menus().map((m) => <details key={m.name}><summary>{m.name}</summary><List items={m.items} close={close} /></details>)}
    </div>
  )
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) useStore.setState({ menu: null }) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useStore.setState({ menu: null })
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
  }, [menu])
  if (!menu) return null
  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((it, i) => it === 'sep' ? <div key={i} className="menu-sep" /> : (
        <button key={i} type="button" role="menuitem" className={'menu-item' + (it.danger ? ' danger' : '')} disabled={it.disabled} onClick={() => { useStore.setState({ menu: null }); it.run?.() }}>
          <span className="chk">{it.checked ? '✓' : ''}</span>{it.label}{it.key && <span className="key">{it.key}</span>}
        </button>
      ))}
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind} onClick={() => useStore.getState().dismiss(t.id)}>{t.text}</div>)}</div>
}

export function StatusBar() {
  const deck = useStore((s) => s.deck)
  const cur = useStore((s) => s.cur)
  const zoom = useStore((s) => s.zoom)
  const panels = useStore((s) => s.panels)
  const i = Math.max(0, deck.slides.findIndex((s) => s.id === cur))
  const pct = typeof zoom === 'number' ? Math.round(zoom * 100) : null
  const setZoom = (z: number | 'fit') => useStore.setState({ zoom: z })
  return (
    <div className="statusbar">
      <span>Slide {i + 1} of {deck.slides.length}</span>
      <span className="grow" />
      <button type="button" className={panels.sorter ? 'on' : ''} onClick={() => useStore.setState({ panels: { ...panels, sorter: !panels.sorter } })} title="Slide sorter"><Icon name="sort" size={15} /> <span className="only-desktop">Sorter</span></button>
      <button type="button" className={panels.notes ? 'on' : ''} onClick={() => useStore.setState({ panels: { ...panels, notes: !panels.notes } })} title="Speaker notes"><Icon name="notes" size={15} /> <span className="only-desktop">Notes</span></button>
      <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.1, (typeof zoom === 'number' ? zoom : 1) / 1.2))}><Icon name="minus" size={14} /></button>
      <button type="button" className="zoom-readout" onClick={() => setZoom('fit')} title="Fit to window">{pct ? `${pct}%` : 'Fit'}</button>
      <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(4, (typeof zoom === 'number' ? zoom : 1) * 1.2))}><Icon name="plus" size={14} /></button>
    </div>
  )
}
export { K }
