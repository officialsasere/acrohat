import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { css, type Color } from '../model'

const P: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  print: 'M7 9V3h10v6M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  copy: 'M9 9h10v11H9zM5 15V4h10', cut: 'M6 6a2.5 2.5 0 1 0 0 .01M6 18a2.5 2.5 0 1 0 0 .01M8 7.5 20 18M8 16.5 20 6', paste: 'M9 4h6v3H9zM7 5H5v15h14V5h-2',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', close: 'M6 6l12 12M18 6 6 18', down: 'm6 9 6 6 6-6', up: 'm6 15 6-6 6 6', right: 'm9 6 6 6-6 6', left: 'm15 6-6 6 6 6', menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6', search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l5 5', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  open: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', save: 'M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 3v5h7V3M8 21v-7h8v7',
  slide: 'M3 5h18v12H3zM8 21h8M12 17v4', newslide: 'M3 4h14v10H3zM7 18h6M10 14v4M19 9v8M15 13h8',
  textbox: 'M4 4h16v16H4zM8 9h8M12 9v7', shape: 'M4 20V9l8-5 8 5v11zM9 20v-5h6v5', line: 'M5 19 19 5', arrow: 'M5 19 19 5M10 5h9v9', elbow: 'M5 5h7v14h7', curve: 'M5 19C5 8 19 16 19 5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01', table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14', chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3', audio: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', italic: 'M10 4h8M6 20h8M14 4 10 20', underline: 'M7 4v7a5 5 0 0 0 10 0V4M5 21h14', strike: 'M5 12h14M8 7c.5-2 2-3 4-3s4 1 4 3c0 3-8 2-8 6 0 2 2 3 4 3s3.500-1 4-3',
  fontcolor: 'M6 18 12 4l6 14M8.5 13h7', highlight: 'M5 20h14M8 15l8-8 3 3-8 8H8zM14 9l3 3', fill: 'M6 12 12 6l6 6-6 6zM18 13c1.500 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4', outline: 'M5 5h14v14H5z',
  alignL: 'M4 6h16M4 10h10M4 14h16M4 18h10', alignC: 'M4 6h16M7 10h10M4 14h16M7 18h10', alignR: 'M4 6h16M10 10h10M4 14h16M10 18h10', alignJ: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  bullets: 'M9 6h11M9 12h11M9 18h11M4.500 6h.01M4.500 12h.01M4.500 18h.01', numbers: 'M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 11h2l-2 3h2M4 17h2v1H4v1h2',
  indent: 'M4 6h16M10 10h10M10 14h10M4 18h16M4 9l3 3-3 3', outdent: 'M4 6h16M10 10h10M10 14h10M4 18h16M7 9l-3 3 3 3', lineheight: 'M8 6h12M8 12h12M8 18h12M4 8V4M2 6l2-2 2 2M4 16v4M2 18l2 2 2-2',
  vtop: 'M4 4h16M8 8h8v6H8z', vmid: 'M4 12h2M18 12h2M8 8h8v8H8z', vbot: 'M4 20h16M8 10h8v6H8z', shadow: 'M5 5h11v11H5zM18 8v11H8', opacity: 'M12 3s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z',
  front: 'M8 8h12v12H8zM4 4h8v4M4 4v8h4', back: 'M4 4h12v12H4zM12 20h8v-8', group: 'M3 3h8v8H3zM13 13h8v8h-8zM11 7h6v6', ungroup: 'M3 3h8v8H3zM13 13h8v8h-8z', rotate: 'M20 11a8 8 0 1 0-2.500 6M20 4v7h-7', flip: 'M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', unlock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.500-2', play: 'M7 4v16l13-8z', presenter: 'M3 4h18v11H3zM8 21l4-6 4 6M7 19h10', notes: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  theme: 'M12 3a9 9 0 1 0 0 18c1.500 0 2-1 1.500-2s0-2 1.500-2h2a3 3 0 0 0 3-3 9 9 0 0 0-8-11zM7.500 11h.01M10 7.500h.01M15 8h.01', layout: 'M4 4h16v16H4zM4 10h16M10 10v10', background: 'M4 4h16v16H4zM4 16l5-5 4 4 7-7',
  transition: 'M3 5h8v14H3zM13 5h8v14h-8zM11 12h2', anim: 'M12 3l2.500 6.500L21 12l-6.500 2.500L12 21l-2.500-6.500L3 12l6.500-2.500z', sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5',
  grid: 'M4 4h16v16H4zM4 9.300h16M4 14.700h16M9.300 4v16M14.700 4v16', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  align: 'M4 4v16M8 7h12M8 12h8M8 17h10', check: 'm5 12 5 5 9-10', pointer: 'M5 4l14 6-6 2-2 6z', symbol: 'M7 19c3 0 3-5 1.500-10S9 5 12 5M5 14h6M15 19v-8l4 8v-8', crop: 'M7 3v14h14M3 7h14v14', more: 'M5 12h.01M12 12h.01M19 12h.01',
  sort: 'M3 5h8v6H3zM13 5h8v6h-8zM3 13h8v6H3zM13 13h8v6h-8z', mergecell: 'M4 5h16v14H4zM9 12h6M12 9v6', cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.500 4.500 0 0 1-.5 9z',
}
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? ''} />
    </svg>
  )
}

/** A button that opens a panel under it; closes on outside click or Escape. */
export function Pop({ trigger, title, children, className = '', panelClass = '', align = 'left', disabled }: { trigger: ReactNode; title: string; children: (close: () => void) => ReactNode; className?: string; panelClass?: string; align?: 'left' | 'right'; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // The panel is fixed to the window, so a toolbar that scrolls or clips never cuts it off; it is kept inside the screen.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const t = ref.current?.getBoundingClientRect(), p = panel.current?.getBoundingClientRect()
    if (!t || !p) return
    let left = align === 'right' ? t.right - p.width : t.left
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8))
    let top = t.bottom + 2
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, Math.min(t.top - p.height - 2, window.innerHeight - p.height - 8))
    setPos({ left, top })
  }, [open, align])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down); document.addEventListener('touchstart', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" disabled={disabled} className={className + (open ? ' on' : '')} title={title} aria-label={title} aria-haspopup="true" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>{trigger}</button>
      {open && <div ref={panel} className={'menu-panel ' + panelClass} style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, right: 'auto', visibility: pos ? 'visible' : 'hidden', maxHeight: 'calc(100vh - 16px)' }} onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input,select,textarea')) e.preventDefault() }}>{children(() => setOpen(false))}</div>}
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
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(820px, 100%)' } : undefined}>
        <button className="close" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  )
}

const BASE = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79']
const THEME_COLORS = ['bg', 'text', 'bg2', 'text2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const
const THEME_NAMES: Record<string, string> = { bg: 'Background', text: 'Text', bg2: 'Background 2', text2: 'Text 2' }

/** Colour chooser: the deck's theme colours first (they follow theme changes), then a standard palette. */
export function ColorGrid({ value, onPick, none }: { value?: Color; onPick: (c: Color | undefined) => void; none?: string }) {
  const theme = useStore((s) => s.deck.theme)
  const [custom, setCustom] = useState(value && value[0] === '#' ? value : '#8a5a36')
  return (
    <div className="color-panel">
      <div className="color-label">Theme colours</div>
      <div className="color-grid">{THEME_COLORS.map((n) => <button key={n} type="button" aria-label={THEME_NAMES[n] ?? n} title={THEME_NAMES[n] ?? n.replace('accent', 'Accent ')} style={{ background: css('@' + n, theme) }} className={value === '@' + n ? 'cur' : ''} onClick={() => onPick('@' + n)} />)}</div>
      <div className="color-label">Standard</div>
      <div className="color-grid">{BASE.map((c) => <button key={c} type="button" aria-label={c} title={c} style={{ background: c }} className={c === value ? 'cur' : ''} onClick={() => onPick(c)} />)}</div>
      <div className="row">
        <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom colour" />
        <button type="button" className="ghost" onClick={() => onPick(custom)}>Use this</button>
        {none && <button type="button" onClick={() => onPick(undefined)}>{none}</button>}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
/** A number that can be typed freely and is applied when it parses. */
export function Num({ value, onChange, min, max, step = 1, label, suffix }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; label: string; suffix?: string }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(Math.round(value * 100) / 100)
  return (
    <span className="num">
      <input aria-label={label} inputMode="decimal" value={shown} onFocus={(e) => e.target.select()} onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))) }} onBlur={() => setText(null)} onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = value + (e.key === 'ArrowUp' ? step : -step); onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, +n.toFixed(4)))); setText(null) } }} />
      {suffix && <i>{suffix}</i>}
    </span>
  )
}
export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map((o) => <button key={String(o.v)} type="button" title={o.title} aria-pressed={o.v === value} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>)}</div>
}
