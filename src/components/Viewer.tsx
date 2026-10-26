import { useEffect, useRef } from 'react'
import { call } from '../engine/client'
import { useStore } from '../store'
import { PageCanvas } from './PageCanvas'

export function Viewer() {
  const doc = useStore((s) => s.active())
  const zoom = useStore((s) => s.zoom)
  const fit = useStore((s) => s.fitWidth)
  const pending = useStore((s) => s.pendingScroll)
  const ref = useRef<HTMLDivElement>(null)

  // Fit-to-width follows the container size.
  useEffect(() => {
    const el = ref.current
    if (!el || !doc) return
    const apply = () => {
      const st = useStore.getState()
      if (!st.fitWidth) return
      const w = Math.max(...doc.info.sizes.map((s) => s.width))
      const z = Math.min(3, Math.max(0.25, (el.clientWidth - 48) / w))
      if (Math.abs(z - st.zoom) > 0.005) useStore.setState({ zoom: z })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc?.id, doc?.info.sizes.length, fit])

  // Fillable form fields, refreshed whenever the document changes.
  useEffect(() => {
    if (!doc) return
    let live = true
    call('formFields', { id: doc.id })
      .then((f) => live && useStore.setState({ fields: f }))
      .catch(() => live && useStore.setState({ fields: [] }))
    return () => {
      live = false
    }
  }, [doc?.id, doc?.info.rev])

  // Track the page nearest the top of the viewport.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight * 0.35
        let best = 0
        el.querySelectorAll<HTMLElement>('.page').forEach((p) => {
          if (p.getBoundingClientRect().top <= mid) best = Number(p.dataset.page)
        })
        if (best !== useStore.getState().page) useStore.setState({ page: best })
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [doc?.id])

  useEffect(() => {
    if (pending === null) return
    ref.current?.querySelector(`[data-page="${pending}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    useStore.setState({ pendingScroll: null })
  }, [pending])

  // Ctrl/Cmd + wheel zooms.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const st = useStore.getState()
      st.setZoom(st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Jump to search hits.
  const hit = useStore((s) => (s.search.index >= 0 ? s.search.hits[s.search.index] : undefined))
  useEffect(() => {
    if (!hit || !ref.current) return
    const page = ref.current.querySelector<HTMLElement>(`[data-page="${hit.page}"]`)
    if (!page) return
    const r = hit.rects[0]
    const top = page.offsetTop + r.y * zoom - ref.current.clientHeight / 3
    ref.current.scrollTo({ top, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit])

  if (!doc) return null
  return (
    <div className="viewer" ref={ref}>
      <div className="pages">
        {doc.info.sizes.map((s, i) => (
          <PageCanvas key={`${doc.id}-${i}`} docId={doc.id} index={i} width={s.width} height={s.height} rev={doc.info.rev} />
        ))}
      </div>
    </div>
  )
}
