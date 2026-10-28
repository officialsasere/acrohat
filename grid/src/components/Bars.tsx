import { useEffect, useMemo, useRef, useState } from 'react'
import { cellName } from '../engine/address'
import { useBook } from '../hooks'
import { useStore } from '../store'
import { COLORS, Icon, Pop } from './ui'

export function SheetTabs() {
  const book = useBook()
  const wb = book.wb
  const [rename, setRename] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (rename !== null) input.current?.select() }, [rename])
  const activate = (id: number) => { book.setActive(id); const s = useStore.getState(); useStore.setState({ sel: s.selBySheet[id] ?? s.sel, edit: null, object: null }) }
  const menu = (e: React.MouseEvent, id: number) => {
    e.preventDefault()
    const sh = book.sheet(id)
    useStore.setState({
      menu: {
        x: Math.min(e.clientX, window.innerWidth - 230), y: Math.max(8, e.clientY - 250),
        items: [
          { label: 'Rename', run: () => setRename(id) },
          { label: 'Duplicate', run: () => { const c = book.duplicateSheet(id); activate(c.id) } },
          { label: 'Delete', danger: true, disabled: wb.sheets.length < 2, run: () => { if (window.confirm(`Delete "${sh.name}"? This can be undone.`)) { book.removeSheet(id); useStore.getState().bump() } } },
          'sep',
          { label: 'Change colour…', run: () => useStore.setState({ dialog: 'sheetColor', dialogArg: id }) },
          { label: sh.hidden ? 'Show sheet' : 'Hide sheet', disabled: wb.sheets.filter((s) => !s.hidden).length < 2 && !sh.hidden, run: () => book.transaction('Hide sheet', () => book.prop(sh, 'hidden', !sh.hidden)) },
          { label: 'Move left', disabled: wb.sheets.indexOf(sh) === 0, run: () => book.moveSheet(id, wb.sheets.indexOf(sh) - 1) },
          { label: 'Move right', disabled: wb.sheets.indexOf(sh) === wb.sheets.length - 1, run: () => book.moveSheet(id, wb.sheets.indexOf(sh) + 1) },
        ],
      },
    })
  }
  const hidden = wb.sheets.filter((s) => s.hidden)
  return (
    <div className="sheet-tabs" role="tablist" aria-label="Sheets">
      <button type="button" title="Add sheet" aria-label="Add sheet" onClick={() => { const s = book.addSheet(); activate(s.id) }}><Icon name="plus" /></button>
      {hidden.length > 0 && (
        <Pop title="Hidden sheets" trigger={<Icon name="menu" />}>
          {(close) => hidden.map((h) => <button key={h.id} type="button" className="menu-item" onClick={() => { book.transaction('Show sheet', () => book.prop(h, 'hidden', false)); activate(h.id); close() }}>{h.name}</button>)}
        </Pop>
      )}
      <div className="tabs-scroll">
        {wb.sheets.filter((s) => !s.hidden).map((s) => (
          <div
            key={s.id}
            role="tab"
            aria-selected={s.id === wb.active}
            tabIndex={0}
            className={'tab' + (s.id === wb.active ? ' active' : '') + (drag === s.id ? ' dragging' : '')}
            style={{ boxShadow: s.tabColor ? `inset 0 -3px 0 ${s.tabColor}` : undefined }}
            draggable={rename !== s.id}
            onDragStart={() => setDrag(s.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag !== null && drag !== s.id) book.moveSheet(drag, wb.sheets.indexOf(s)); setDrag(null) }}
            onDragEnd={() => setDrag(null)}
            onClick={() => activate(s.id)}
            onDoubleClick={() => setRename(s.id)}
            onContextMenu={(e) => menu(e, s.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') activate(s.id); if (e.key === 'F2') setRename(s.id) }}
          >
            {rename === s.id ? (
              <input
                ref={input}
                defaultValue={s.name}
                aria-label="Sheet name"
                onBlur={(e) => { if (!book.renameSheet(s.id, e.target.value)) useStore.getState().toast('error', 'That name is empty, already used, or has characters that are not allowed ( \\ / ? * [ ] : ).'); setRename(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRename(null) }}
              />
            ) : s.name}
            <button type="button" className="tab-menu" aria-label={`${s.name} menu`} onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); menu({ preventDefault() {}, clientX: r.left, clientY: r.top } as React.MouseEvent, s.id) }}><Icon name="down" size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Sum, average and count of what is selected, like the corner of other spreadsheets. */
export function StatusBar() {
  const book = useBook()
  const sel = useStore((s) => s.sel)
  const zoom = useStore((s) => s.zoom)
  const file = useStore((s) => s.file)
  const sh = book.activeSheet
  const stats = useMemo(() => {
    let n = 0, count = 0, sum = 0, min = Infinity, max = -Infinity
    for (const g of sel.ranges) {
      const r2 = Math.min(g.r2, book.usedRange(sh.id).rows - 1), c2 = Math.min(g.c2, book.usedRange(sh.id).cols - 1)
      for (let r = g.r1; r <= r2; r++) for (let c = g.c1; c <= c2; c++) {
        if (sh.hiddenRows.has(r) || sh.hiddenCols.has(c)) continue
        const v = book.value(sh.id, r, c)
        if (v === null || v === '') continue
        n++
        if (typeof v === 'number') { count++; sum += v; min = Math.min(min, v); max = Math.max(max, v) }
      }
    }
    return { n, count, sum, min, max }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, book.version])
  const f = (x: number) => (Math.abs(x) >= 1e9 ? x.toExponential(3) : String(+x.toPrecision(10)))
  const g = sel.ranges[sel.ranges.length - 1]
  const cells = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)
  return (
    <footer className="statusbar">
      <span>{file.dirty ? 'Unsaved changes' : 'All changes kept'}</span>
      <span className="spacer" />
      {stats.n > 1 && <span>Count: <b>{stats.n.toLocaleString()}</b></span>}
      {stats.n > 1 && stats.count > 0 && (
        <>
          <span>Sum: <b>{f(stats.sum)}</b></span>
          <span className="only-desktop">Average: <b>{f(stats.sum / stats.count)}</b></span>
          <span className="only-desktop">Min: <b>{f(stats.min)}</b></span>
          <span className="only-desktop">Max: <b>{f(stats.max)}</b></span>
        </>
      )}
      {cells > 1 && <span className="muted only-desktop">{cells.toLocaleString()} cells</span>}
      <span className="muted only-desktop">{cellName(sel.r, sel.c)}</span>
      <input type="range" className="only-desktop" min="50" max="200" step="10" value={Math.round(zoom * 100)} aria-label="Zoom" onChange={(e) => useStore.setState({ zoom: Number(e.target.value) / 100 })} />
      <span style={{ minWidth: 38, textAlign: 'right' }}>{Math.round(zoom * 100)}%</span>
    </footer>
  )
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) useStore.setState({ menu: null }) }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useStore.setState({ menu: null })
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key); window.addEventListener('blur', () => useStore.setState({ menu: null }))
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
  }, [menu])
  if (!menu) return null
  return (
    <div className="context-menu" ref={ref} style={{ left: menu.x, top: menu.y }} role="menu">
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
export { COLORS }
