import { useRef } from 'react'
import { useBook } from '../hooks'
import { readChart } from '../engine/chartdata'
import type { Chart, Picture } from '../engine/model'
import { useStore } from '../store'
import { ChartView } from './ChartView'

/** Charts and pictures floating over the sheet. They move with the scrolling. */
export function ObjectLayer({ scroll, zoom, hw, hh, size }: { scroll: { x: number; y: number }; zoom: number; hw: number; hh: number; size: { w: number; h: number } }) {
  const book = useBook()
  const sheet = book.activeSheet
  const selected = useStore((s) => s.object)
  const drag = useRef<{ id: string; kind: 'move' | 'size'; x: number; y: number; ox: number; oy: number; ow: number; oh: number; last?: { x: number; y: number; w: number; h: number } } | null>(null)
  const items: { id: string; x: number; y: number; w: number; h: number; node: React.ReactNode; isChart: boolean }[] = [
    ...sheet.charts.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, isChart: true, node: <ChartView chart={c} data={readChart(book, c)} width={c.w * zoom} height={c.h * zoom} /> })),
    ...sheet.pictures.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, isChart: false, node: <img src={p.src} alt={p.alt ?? ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'fill' }} /> })),
  ]
  if (!items.length) return null

  const update = (id: string, patch: Partial<Chart & Picture>, record: boolean) => {
    if (sheet.charts.some((c) => c.id === id)) { const next = sheet.charts.map((c) => (c.id === id ? { ...c, ...patch } : c)); if (record) book.transaction('Move chart', () => book.prop(sheet, 'charts', next)); else sheet.charts = next }
    else { const next = sheet.pictures.map((p) => (p.id === id ? { ...p, ...patch } : p)); if (record) book.transaction('Move picture', () => book.prop(sheet, 'pictures', next)); else sheet.pictures = next }
  }
  return (
    <div className="objects" style={{ left: hw, top: hh, width: size.w - hw, height: size.h - hh }}>
      {items.map((o) => {
        const sel = selected === o.id
        const left = o.x * zoom - scroll.x, top = o.y * zoom - scroll.y, w = o.w * zoom, h = o.h * zoom
        if (left + w < 0 || top + h < 0 || left > size.w || top > size.h) return null
        return (
          <div
            key={o.id}
            className={'object' + (sel ? ' selected' : '')}
            style={{ left, top, width: w, height: h }}
            onPointerDown={(e) => {
              e.stopPropagation()
              useStore.setState({ object: o.id })
              ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
              drag.current = { id: o.id, kind: 'move', x: e.clientX, y: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h }
            }}
            onPointerMove={(e) => {
              const d = drag.current
              if (!d || d.id !== o.id) return
              const dx = (e.clientX - d.x) / zoom, dy = (e.clientY - d.y) / zoom
              const next = d.kind === 'move' ? { x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy), w: d.ow, h: d.oh } : { x: d.ox, y: d.oy, w: Math.max(80, d.ow + dx), h: Math.max(60, d.oh + dy) }
              d.last = next
              update(o.id, next, false)
              book.rawSize(sheet.id, 'row', -1, undefined)
            }}
            onPointerUp={() => {
              const d = drag.current
              drag.current = null
              if (d?.last) { update(o.id, { x: d.ox, y: d.oy, w: d.ow, h: d.oh }, false); update(o.id, d.last, true) }
            }}
            onDoubleClick={() => o.isChart && useStore.setState({ dialog: 'chart', dialogArg: o.id })}
            onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') removeObject(o.id) }}
            tabIndex={0}
            role="img"
          >
            {o.node}
            {sel && <div className="obj-handle" onPointerDown={(e) => { e.stopPropagation(); ;(e.currentTarget.parentElement as Element).setPointerCapture(e.pointerId); drag.current = { id: o.id, kind: 'size', x: e.clientX, y: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h } }} />}
          </div>
        )
      })}
    </div>
  )
}

export function removeObject(id: string) {
  const s = useStore.getState(), book = s.book, sh = book.activeSheet
  book.transaction('Delete object', () => {
    if (sh.charts.some((c) => c.id === id)) book.prop(sh, 'charts', sh.charts.filter((c) => c.id !== id))
    else book.prop(sh, 'pictures', sh.pictures.filter((p) => p.id !== id))
  })
  useStore.setState({ object: null })
}
