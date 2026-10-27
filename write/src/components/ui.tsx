import { useEffect, useRef, useState, type ReactNode } from 'react'

const P: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  print: 'M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01', table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14',
  left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10', justify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  bullets: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01', numbers: 'M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 11h2l-2 3h2M4 17h2v1H4.5M4 20h2v-3',
  check: 'M4 7l1.5 1.5L8 6M4 13l1.5 1.5L8 12M4 19l1.5 1.5L8 18M11 7h9M11 13h9M11 19h9', indent: 'M4 6h16M10 10h10M10 14h10M4 18h16M4 9l3 3-3 3', outdent: 'M4 6h16M10 10h10M10 14h10M4 18h16M7 9l-3 3 3 3',
  clear: 'M5 5l14 14M7 5h10M12 5l-3 14M9 19h6', spacing: 'M8 6h12M8 12h12M8 18h12M4 5v14M2 7l2-2 2 2M2 17l2 2 2-2',
  quote: 'M6 8h4v4c0 3-2 4-4 4M14 8h4v4c0 3-2 4-4 4', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14', hr: 'M4 12h16',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l5 5', menu: 'M4 6h16M4 12h16M4 18h16', home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'M6 6l12 12M18 6 6 18', down: 'm6 9 6 6 6-6', sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5',
  save: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7', open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  speaker: 'M4 10v4h4l5 4V6l-5 4zM16.5 8.5a5 5 0 0 1 0 7', outline: 'M4 5h16M7 10h13M10 15h10M7 20h13', pagebreak: 'M4 12h3M10 12h4M17 12h3M8 5v5M16 5v5M8 14v5M16 14v5',
  highlight: 'm9 11 6 6-4 3-5-1-1-5zM14 6l4 4M5 21h6', fontcolor: 'M6 18 12 4l6 14M8.5 13h7', file: 'M6 3h8l5 5v13H6zM14 3v5h5',
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
      {/* mousedown is cancelled so the editor keeps its selection while a menu opens */}
      <button type="button" className={className + (open ? ' on' : '')} title={title} aria-label={title} aria-haspopup="true" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && <div className={'menu-panel ' + panelClass} style={align === 'right' ? { left: 'auto', right: 0 } : undefined} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input,select,textarea')) e.preventDefault() }}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
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
        {children}
      </div>
    </div>
  )
}
