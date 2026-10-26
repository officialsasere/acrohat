import { useEffect, useRef, useState } from 'react'
import { call } from '../engine/client'
import type { OutlineItem } from '../engine/extras'
import { useStore } from '../store'
import { download } from '../lib/files'
import { Icon } from './Icons'

function Thumb({ docId, index, rev, w, h }: { docId: string; index: number; rev: number; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { rootMargin: '400px' })
    io.observe(ref.current!)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!vis) return
    let live = true
    const scale = 140 / w
    call('render', { id: docId, page: index, scale }).then((img) => {
      if (!live) return
      const c = ref.current!
      c.width = img.width
      c.height = img.height
      c.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0)
    })
    return () => {
      live = false
    }
  }, [vis, docId, index, rev, w])
  return <canvas ref={ref} style={{ width: 140, height: (h / w) * 140 }} />
}

function Outline({ docId, rev }: { docId: string; rev: number }) {
  const [items, setItems] = useState<OutlineItem[] | null>(null)
  const goTo = useStore((s) => s.goToPage)
  useEffect(() => {
    let live = true
    call('outline', { id: docId }).then((o) => live && setItems(o)).catch(() => live && setItems([]))
    return () => {
      live = false
    }
  }, [docId, rev])
  if (!items) return <p className="hint pad">Loading…</p>
  if (!items.length) return <p className="hint pad">This document has no bookmarks.</p>
  const render = (list: OutlineItem[], depth: number): React.ReactNode =>
    list.map((it, i) => (
      <div key={`${depth}-${i}`}>
        <button className="outline-item" style={{ paddingLeft: 8 + depth * 14 }} disabled={it.page < 0} onClick={() => goTo(it.page)} title={it.page >= 0 ? `Page ${it.page + 1}` : undefined}>
          {it.title}
        </button>
        {render(it.children, depth + 1)}
      </div>
    ))
  return <div className="outline">{render(items, 0)}</div>
}

export function Sidebar() {
  const tab = useStore((s) => s.sidebarTab)
  const doc = useStore((s) => s.active())
  const page = useStore((s) => s.page)
  const selected = useStore((s) => s.selectedPages)
  const goTo = useStore((s) => s.goToPage)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const last = useRef(0)
  if (!doc) return null
  const id = doc.id
  const sel = selected.length ? selected : [page]

  const apply = (fn: () => Promise<Awaited<ReturnType<typeof call<'deletePages'>>>>, keep = false) =>
    useStore
      .getState()
      .run(fn)
      .then((info) => {
        if (!info) return
        useStore.getState().update(id, info)
        if (!keep) useStore.setState({ selectedPages: [] })
      })

  const click = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)]
      useStore.setState({ selectedPages: Array.from({ length: b - a + 1 }, (_, k) => a + k) })
    } else if (e.metaKey || e.ctrlKey) {
      useStore.setState({ selectedPages: selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i] })
    } else useStore.setState({ selectedPages: [i] })
    last.current = i
    goTo(i)
  }

  const insertPdf = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.multiple = true
    input.onchange = async () => {
      let at = Math.max(...sel) + 1
      for (const f of Array.from(input.files ?? [])) {
        const bytes = new Uint8Array(await f.arrayBuffer())
        const info = await useStore.getState().run(() => call('insertPdf', { id, bytes, at }, [bytes.buffer]))
        if (info) {
          at += info.pageCount - doc.info.pageCount
          useStore.getState().update(id, info)
        }
      }
    }
    input.click()
  }

  const extract = async () => {
    const bytes = await useStore.getState().run(() => call('extract', { id, pages: [...sel].sort((a, b) => a - b) }))
    if (bytes) download(doc.name.replace(/\.pdf$/i, '') + `-pages.pdf`, bytes)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'pages'} className={tab === 'pages' ? 'active' : ''} onClick={() => useStore.setState({ sidebarTab: 'pages' })}>Pages</button>
        <button role="tab" aria-selected={tab === 'outline'} className={tab === 'outline' ? 'active' : ''} onClick={() => useStore.setState({ sidebarTab: 'outline' })}>Bookmarks</button>
      </div>
      {tab === 'outline' ? <Outline docId={id} rev={doc.info.rev} /> : (<>
      <div className="sidebar-actions">
        <button title="Rotate selected pages clockwise" onClick={() => apply(() => call('rotatePages', { id, pages: sel, degrees: 90 }), true)}>
          <Icon name="rotate" />
        </button>
        <button
          title="Delete selected pages"
          onClick={() => {
            if (window.confirm(`Delete ${sel.length} page${sel.length > 1 ? 's' : ''}?`)) apply(() => call('deletePages', { id, pages: sel }))
          }}
        >
          <Icon name="trash" />
        </button>
        <button title="Insert pages from another PDF (merge)" onClick={insertPdf}>
          <Icon name="merge" />
        </button>
        <button title="Extract selected pages to a new PDF" onClick={extract}>
          <Icon name="extract" />
        </button>
      </div>
      <div className="thumbs">
        {doc.info.sizes.map((s, i) => (
          <div
            key={i}
            className={'thumb' + (i === page ? ' current' : '') + (selected.includes(i) ? ' selected' : '') + (dropAt === i ? ' drop-before' : '')}
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => {
              e.preventDefault()
              setDropAt(i)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDropAt(null)
            }}
            onDrop={() => {
              if (dragFrom !== null && dragFrom !== i) {
                const group = selected.includes(dragFrom) ? selected : [dragFrom]
                const dest = i > dragFrom ? i - group.filter((g) => g < i).length + 1 : i
                apply(() => call('movePages', { id, pages: group, dest: Math.max(0, dest) }))
              }
              setDragFrom(null)
              setDropAt(null)
            }}
            onClick={(e) => click(e, i)}
          >
            <Thumb docId={id} index={i} rev={doc.info.rev} w={s.width} h={s.height} />
            <span>{i + 1}</span>
          </div>
        ))}
      </div>
      </>)}
    </aside>
  )
}
