import { useEffect, useRef, useState, type ReactNode } from 'react'

const P: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  print: 'M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  paint: 'M5 4h12v5H5zM11 9v4M8 13h6v7H8z', copy: 'M9 9h10v11H9zM5 15V4h10', cut: 'M6 6a2.5 2.5 0 1 0 0 .01M6 18a2.5 2.5 0 1 0 0 .01M8 7.5 20 18M8 16.5 20 6', paste: 'M9 4h6v3H9zM7 5H5v15h14V5h-2',
  fontcolor: 'M6 18 12 4l6 14M8.5 13h7', fill: 'M6 12 12 6l6 6-6 6zM18 13c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4', borders: 'M4 4h16v16H4zM12 4v16M4 12h16',
  merge: 'M4 6h16v12H4zM8 10l-3 2 3 2M16 10l3 2-3 2M9 12h6', left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  top: 'M4 4h16M12 20V8M8 12l4-4 4 4', middle: 'M4 12h16M12 4v5M9 6l3 3 3-3M12 20v-5M9 18l3-3 3 3', bottom: 'M4 20h16M12 4v12M8 12l4 4 4-4', wrap: 'M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5M14 15l-3 3 3 3',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z', sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3', sum: 'M18 5H7l6 7-6 7h11', chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  note: 'M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-7l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l5 5', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'M6 6l12 12M18 6 6 18', down: 'm6 9 6 6 6-6', menu: 'M4 6h16M4 12h16M4 18h16', home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5', save: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', file: 'M6 3h8l5 5v13H6zM14 3v5h5', pointer: 'M5 4l14 6-6 2-2 6z', freeze: 'M4 4h16v16H4zM4 10h16M10 4v16',
  percent: 'M18 6 6 18M7 7.5a1.5 1.5 0 1 0 0 .01M17 16.5a1.5 1.5 0 1 0 0 .01', dollar: 'M12 3v18M16 7.5c-.5-1.5-2-2.5-4-2.5-2.500 0-4 1.200-4 3s1.500 2.500 4 3 4 1.200 4 3-1.500 3-4 3c-2.200 0-3.700-1-4.200-2.500', dec1: 'M4 8h5M4 16h5M13 4v16M16 8l4 4-4 4', dec2: 'M4 12h5M13 8l-4 4 4 4M16 4v16',
  indent: 'M4 6h16M10 10h10M10 14h10M4 18h16M4 9l3 3-3 3', checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6', dropdown: 'M4 6h16v12H4zM9 11l3 3 3-3', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14',
}
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? ''} />
    </svg>
  )
}

/** A button that opens a panel under it; closes on outside click or Escape. */
export function Pop({ trigger, title, children, className = '', panelClass = '', align = 'left' }: { trigger: ReactNode; title: string; children: (close: () => void) => ReactNode; className?: string; panelClass?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down); document.addEventListener('touchstart', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={className + (open ? ' on' : '')} title={title} aria-label={title} aria-haspopup="true" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>{trigger}</button>
      {open && <div className={'menu-panel ' + panelClass} style={align === 'right' ? { left: 'auto', right: 0 } : undefined} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input,select,textarea')) e.preventDefault() }}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide, actions }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; actions?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(760px, 100%)' } : undefined}>
        <button className="close" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  )
}

export const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
]
export function ColorGrid({ value, onPick, none }: { value?: string; onPick: (c: string | undefined) => void; none?: string }) {
  const [custom, setCustom] = useState(value ?? '#8a5a36')
  return (
    <div className="color-panel">
      <div className="color-grid">{COLORS.map((c) => <button key={c} type="button" aria-label={c} title={c} style={{ background: c }} className={c === value ? 'cur' : ''} onClick={() => onPick(c)} />)}</div>
      <div className="row">
        <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom colour" />
        <button type="button" className="ghost" onClick={() => onPick(custom)}>Use this</button>
        {none && <button type="button" onClick={() => onPick(undefined)}>{none}</button>}
      </div>
    </div>
  )
}
