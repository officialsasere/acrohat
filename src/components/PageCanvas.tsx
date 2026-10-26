import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { call, EngineError, type BlockInfo } from '../engine/client'
import type { FieldInfo, ImageInfo } from '../engine/protocol'
import type { PageLink } from '../engine/extras'
import { useStore } from '../store'
import { clamp, fontFamilyFor, hexToRgba, normRect } from '../lib/util'

type DR = { x: number; y: number; w: number; h: number }
type Pt = [number, number]

interface Props {
  docId: string
  index: number
  width: number
  height: number
  rev: number
}

function PageCanvasImpl({ docId, index, width, height, rev }: Props) {
  const zoom = useStore((s) => s.zoom)
  const tool = useStore((s) => s.tool)
  const hits = useStore((s) => s.search.hits)
  const hitIndex = useStore((s) => s.search.index)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const token = useRef(0)

  // Only pages near the viewport are rendered.
  useEffect(() => {
    const el = wrapRef.current!
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '1200px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    if (!visible) {
      canvas.width = 1
      canvas.height = 1
      return
    }
    const my = ++token.current
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const timer = setTimeout(async () => {
      const img = await call('render', { id: docId, page: index, scale: zoom * dpr }).catch(() => null)
      if (!img || my !== token.current) return
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0)
    }, 30)
    return () => clearTimeout(timer)
  }, [visible, docId, index, zoom, rev])

  const pageHits = hits.filter((h) => h.page === index)
  const current = hitIndex >= 0 ? hits[hitIndex] : undefined

  return (
    <div ref={wrapRef} className="page" data-page={index} style={{ width: width * zoom, height: height * zoom }}>
      <canvas ref={canvasRef} style={{ width: width * zoom, height: height * zoom }} />
      {pageHits.map((h, i) =>
        h.rects.map((r, j) => (
          <div key={`${i}-${j}`} className={'hit' + (h === current ? ' current' : '')} style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} />
        )),
      )}
      {visible && <Overlay docId={docId} index={index} width={width} height={height} rev={rev} tool={tool} zoom={zoom} />}
    </div>
  )
}

export const PageCanvas = memo(PageCanvasImpl)

function Overlay({ docId, index, rev, tool, zoom }: Props & { tool: string; zoom: number }) {
  const store = useStore
  const color = useStore((s) => s.color)
  const strokeWidth = useStore((s) => s.strokeWidth)
  const fontSize = useStore((s) => s.fontSize)
  const signature = useStore((s) => s.signature)
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ from: Pt; to: Pt; points: Pt[] } | null>(null)
  const [preview, setPreview] = useState<DR[]>([])
  const [blocks, setBlocks] = useState<BlockInfo[]>([])
  const [annots, setAnnots] = useState<{ index: number; subtype: number; rect: DR; contents: string }[]>([])
  const [selAnnot, setSelAnnot] = useState<number | null>(null)
  const [editing, setEditing] = useState<BlockInfo | null>(null)
  const [links, setLinks] = useState<PageLink[]>([])
  const [images, setImages] = useState<ImageInfo[]>([])
  const [selImg, setSelImg] = useState<number | null>(null)
  const [imgDrag, setImgDrag] = useState<{ mode: 'move' | 'size'; start: Pt; orig: DR; cur: DR } | null>(null)
  const [input, setInput] = useState<{ at: Pt; kind: 'note' | 'text' } | null>(null)
  const selText = useRef('')

  const info = (i: Awaited<ReturnType<typeof call<'markup'>>>) => store.getState().update(docId, i)

  // Text blocks for the editor, annotations for the select tool.
  useEffect(() => {
    let live = true
    if (tool === 'edit') {
      call('blocks', { id: docId, page: index }).then((b) => live && setBlocks(b)).catch(() => live && setBlocks([]))
    } else setBlocks([])
    if (tool === 'select') {
      call('annotations', { id: docId, page: index }).then((a) => live && setAnnots(a)).catch(() => {})
      call('links', { id: docId, page: index }).then((l) => live && setLinks(l)).catch(() => live && setLinks([]))
    } else {
      setAnnots([])
      setLinks([])
    }
    if (tool === 'image') call('images', { id: docId, page: index }).then((i) => live && setImages(i)).catch(() => live && setImages([]))
    else setImages([])
    setSelImg(null)
    setSelAnnot(null)
    return () => {
      live = false
    }
  }, [tool, docId, index, rev])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selAnnot !== null && (e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        store.getState().run(async () => info(await call('removeAnnotation', { id: docId, page: index, index: selAnnot })))
      }
      if (selImg !== null && (e.key === 'Delete' || e.key === 'Backspace') && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        store.getState().run(async () => info(await call('imageDelete', { id: docId, page: index, index: selImg })))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selText.current && !window.getSelection()?.toString()) {
        navigator.clipboard?.writeText(selText.current)
        store.getState().toast('info', 'Copied')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pos = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]
  }

  const markupTools = ['highlight', 'underline', 'strikeout', 'select']
  const dragTools = [...markupTools, 'pen', 'rect', 'ellipse', 'redact', 'sign', 'crop', 'field']
  const interactive = dragTools.includes(tool) || tool === 'note' || tool === 'text'

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !interactive || input) return
    const p = pos(e)
    if (tool === 'note' || tool === 'text') return // handled on pointer up so the new input keeps focus
    if (tool === 'image') return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({ from: p, to: p, points: [p] })
    setPreview([])
    setSelAnnot(null)
  }

  const onMove = (e: React.PointerEvent) => {
    if (imgDrag) {
      const p = pos(e)
      const dx = p[0] - imgDrag.start[0]
      const dy = p[1] - imgDrag.start[1]
      const o = imgDrag.orig
      if (imgDrag.mode === 'move') setImgDrag({ ...imgDrag, cur: { ...o, x: o.x + dx, y: o.y + dy } })
      else {
        const w = Math.max(8, o.w + dx)
        setImgDrag({ ...imgDrag, cur: { ...o, w, h: (w * o.h) / o.w } })
      }
      return
    }
    if (!drag) return
    const p = pos(e)
    setDrag({ ...drag, to: p, points: tool === 'pen' ? [...drag.points, p] : drag.points })
    if (markupTools.includes(tool)) {
      call('selection', { id: docId, page: index, from: drag.from, to: p }).then((r) => {
        selText.current = r.text
        setPreview(r.rects)
      })
    }
  }

  const onUp = async (e: React.PointerEvent) => {
    if ((tool === 'note' || tool === 'text') && e.button === 0 && !input) {
      setInput({ at: pos(e), kind: tool })
      return
    }
    if (imgDrag) {
      const d = imgDrag
      setImgDrag(null)
      if (selImg !== null && (Math.abs(d.cur.x - d.orig.x) > 1 || Math.abs(d.cur.w - d.orig.w) > 1 || Math.abs(d.cur.y - d.orig.y) > 1)) {
        await store.getState().run(async () => info(await call('imagePlace', { id: docId, page: index, index: selImg, rect: d.cur })))
      }
      return
    }
    if (tool === 'image' && e.button === 0 && !(e.target as Element).closest('.imgbox')) {
      const at = pos(e)
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const f = input.files?.[0]
        if (!f) return
        const bmp = await createImageBitmap(f)
        const cv = new OffscreenCanvas(bmp.width, bmp.height)
        const cx = cv.getContext('2d')!
        cx.drawImage(bmp, 0, 0)
        const d = cx.getImageData(0, 0, bmp.width, bmp.height)
        const w = Math.min(240, bmp.width)
        const h = (w * bmp.height) / bmp.width
        await store.getState().run(async () => info(await call('image', { id: docId, page: index, rgba: d.data, w: bmp.width, h: bmp.height, rect: { x: at[0], y: at[1], w, h } }, [d.data.buffer])))
      }
      input.click()
      return
    }
    if (!drag) return
    const p = pos(e)
    const d = { ...drag, to: p }
    setDrag(null)
    const r = normRect(d.from, d.to)
    const { run } = store.getState()
    const stroke = hexToRgba(color)
    if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
      const sel = await call('selection', { id: docId, page: index, from: d.from, to: p })
      setPreview([])
      if (sel.rects.length) await run(async () => info(await call('markup', { id: docId, page: index, kind: tool, rects: sel.rects, color: hexToRgba(color, tool === 'highlight' ? 150 : 255) })))
    } else if (tool === 'select') {
      // text selection only produces a preview + copyable text
    } else if (tool === 'pen') {
      setPreview([])
      if (d.points.length > 1) await run(async () => info(await call('ink', { id: docId, page: index, points: d.points, color: stroke, width: strokeWidth })))
    } else if ((tool === 'rect' || tool === 'ellipse') && r.w > 3 && r.h > 3) {
      await run(async () => info(await call('shape', { id: docId, page: index, kind: tool === 'rect' ? 'square' : 'circle', rect: r, stroke, fill: null, width: strokeWidth })))
    } else if (tool === 'redact' && r.w > 3 && r.h > 3) {
      if (window.confirm('Permanently remove everything under this box? This cannot be recovered after you save.')) {
        const res = await run(async () => call('redact', { id: docId, page: index, rect: r }))
        if (res) {
          store.getState().update(docId, res)
          store.getState().toast('success', `Redacted (${res.removed} item${res.removed === 1 ? '' : 's'} removed)`)
        }
      }
    } else if (tool === 'sign' && signature) {
      const rect = r.w > 10 ? r : { x: d.from[0], y: d.from[1], w: 150, h: 60 }
      const bmp = await createImageBitmap(await (await fetch(signature)).blob())
      const cv = new OffscreenCanvas(bmp.width, bmp.height)
      const cx = cv.getContext('2d')!
      cx.drawImage(bmp, 0, 0)
      const data = cx.getImageData(0, 0, bmp.width, bmp.height)
      const h = r.w > 10 ? rect.h : (rect.w * bmp.height) / bmp.width
      await run(async () => info(await call('image', { id: docId, page: index, rgba: data.data, w: bmp.width, h: bmp.height, rect: { ...rect, h } }, [data.data.buffer])))
    } else if (tool === 'crop' && r.w > 8 && r.h > 8) {
      const all = window.confirm('Crop every page to this area?\n\nOK = all pages, Cancel = only this page.')
      const doc = store.getState().active()!
      const pages = all ? Array.from({ length: doc.info.pageCount }, (_, i) => i) : [index]
      await run(async () => info(await call('crop', { id: docId, pages, rect: r })))
      store.getState().setTool('select')
    } else if (tool === 'field' && r.w > 6 && r.h > 6) {
      const type = store.getState().fieldType
      const name = window.prompt('Field name (used to identify the field in the form):', `${type}${Math.floor(Math.random() * 900 + 100)}`)
      if (!name) return
      let options: string[] | undefined
      if (type === 'dropdown' || type === 'list' || type === 'radio') {
        const o = window.prompt(type === 'radio' ? 'Radio options, comma-separated:' : 'List options, comma-separated:', 'Option 1, Option 2')
        if (o === null) return
        options = o.split(',').map((x) => x.trim()).filter(Boolean)
      }
      await run(async () => info(await call('addField', { id: docId, field: { type, name, page: index, rect: r, options, multiline: type === 'text' && r.h > 40 } })))
    } else if (tool === 'sign' && !signature) {
      store.getState().toast('info', 'Create a signature first (Sign button in the toolbar).')
    }
  }

  const commitInput = async (value: string) => {
    const cur = input
    setInput(null)
    if (!cur || !value.trim()) return
    const { run } = store.getState()
    if (cur.kind === 'note') await run(async () => info(await call('note', { id: docId, page: index, at: cur.at, text: value })))
    else await run(async () => info(await call('text', { id: docId, page: index, at: [cur.at[0], cur.at[1] + fontSize], text: value, size: fontSize, color: [20, 20, 20, 255] })))
  }

  const commitEdit = async (b: BlockInfo, text: string) => {
    setEditing(null)
    if (text === b.text) return
    const st = store.getState()
    const edit = (overflow?: 'push' | 'overlap') => call('editBlock', { id: docId, blockId: b.id, text, overflow })
    const res = await st.run(async () => {
      try {
        return await edit()
      } catch (e) {
        if (!(e instanceof EngineError) || e.kind !== 'Overflow') throw e
        // The paragraph would grow into something: let the user decide, nothing has been changed yet.
        const choice = await st.askOverflow(e.data as { extraLines: number; collidesWith: string; canPush: boolean })
        return choice ? edit(choice) : undefined
      }
    })
    if (!res) return
    const fresh = await call('info', { id: docId })
    st.update(docId, fresh)
    if (res.fontSubstituted) st.toast('info', 'The original font could not draw some characters, so the edited text uses a similar built-in font.')
  }

  const dr = drag ? normRect(drag.from, drag.to) : null
  const cursor = tool === 'select' ? 'text' : tool === 'edit' ? 'default' : 'crosshair'

  return (
    <div ref={ref} className="overlay" style={{ cursor, touchAction: interactive ? 'none' : 'auto' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {preview.map((r, i) => (
        <div key={i} className="sel" style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} />
      ))}
      {dr && ['rect', 'ellipse', 'redact', 'sign', 'crop', 'field'].includes(tool) && (
        <div className={'rubber ' + tool} style={{ left: dr.x * zoom, top: dr.y * zoom, width: dr.w * zoom, height: dr.h * zoom, borderColor: tool === 'redact' ? '#000' : color }} />
      )}
      {drag && tool === 'pen' && (
        <svg className="ink-preview">
          <polyline points={drag.points.map((p) => `${p[0] * zoom},${p[1] * zoom}`).join(' ')} fill="none" stroke={color} strokeWidth={strokeWidth * zoom} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {tool === 'select' &&
        links.map((l, i) => (
          <a
            key={i}
            className="link"
            href={l.uri ?? '#'}
            title={l.uri ?? `Go to page ${(l.page ?? 0) + 1}`}
            style={{ left: l.rect.x * zoom, top: l.rect.y * zoom, width: l.rect.w * zoom, height: l.rect.h * zoom }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault()
              if (l.page !== undefined) store.getState().goToPage(l.page)
              else if (l.uri && /^(https?:|mailto:)/i.test(l.uri)) window.open(l.uri, '_blank', 'noopener,noreferrer')
            }}
          />
        ))}
      {tool === 'image' &&
        images.map((im) => {
          const r = imgDrag && selImg === im.index ? imgDrag.cur : im.rect
          return (
            <div
              key={im.index}
              className={'imgbox' + (selImg === im.index ? ' on' : '')}
              style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }}
              title={im.transformed ? 'Rotated image: can be deleted or replaced, not moved' : 'Drag to move, corner to resize, Delete to remove, double-click to replace'}
              onPointerDown={(e) => {
                e.stopPropagation()
                setSelImg(im.index)
                if (!im.transformed) {
                  ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
                  setImgDrag({ mode: 'move', start: pos(e), orig: im.rect, cur: im.rect })
                }
              }}
              onDoubleClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/*'
                input.onchange = async () => {
                  const f = input.files?.[0]
                  if (!f) return
                  const bmp = await createImageBitmap(f)
                  const cv = new OffscreenCanvas(bmp.width, bmp.height)
                  const cx = cv.getContext('2d')!
                  cx.drawImage(bmp, 0, 0)
                  const d = cx.getImageData(0, 0, bmp.width, bmp.height)
                  await store.getState().run(async () => info(await call('imageReplace', { id: docId, page: index, index: im.index, rgba: d.data, w: bmp.width, h: bmp.height }, [d.data.buffer])))
                }
                input.click()
              }}
            >
              {selImg === im.index && !im.transformed && (
                <span
                  className="handle"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
                    setImgDrag({ mode: 'size', start: pos(e), orig: im.rect, cur: im.rect })
                  }}
                />
              )}
            </div>
          )
        })}
      {tool === 'select' &&
        annots.map((a) => (
          <div
            key={a.index}
            className={'annot' + (selAnnot === a.index ? ' on' : '')}
            title={a.contents || undefined}
            style={{ left: a.rect.x * zoom, top: a.rect.y * zoom, width: Math.max(a.rect.w, 8) * zoom, height: Math.max(a.rect.h, 8) * zoom }}
            onPointerDown={(e) => {
              e.stopPropagation()
              setSelAnnot(a.index)
            }}
          />
        ))}
      {tool === 'edit' &&
        blocks.map((b) => (
          <div
            key={b.id}
            className="block"
            style={{ left: b.rect.x * zoom - 3, top: b.rect.y * zoom - 2, width: b.rect.w * zoom + 6, height: b.rect.h * zoom + 4 }}
            onClick={() => setEditing(b)}
          />
        ))}
      {tool === 'select' && <FormLayer docId={docId} index={index} zoom={zoom} />}
      {editing && <BlockEditor block={editing} zoom={zoom} onDone={commitEdit} onCancel={() => setEditing(null)} />}
      {input && <InlineInput at={input.at} zoom={zoom} kind={input.kind} fontSize={fontSize} onDone={commitInput} />}
    </div>
  )
}

function BlockEditor({ block, zoom, onDone, onCancel }: { block: BlockInfo; zoom: number; onDone: (b: BlockInfo, t: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const grow = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0'
    el.style.height = el.scrollHeight + 'px'
  }, [])
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
    grow()
  }, [grow])
  const [r, g, b] = block.color
  return (
    <textarea
      ref={ref}
      className="block-editor"
      defaultValue={block.text}
      spellCheck
      style={{
        left: block.rect.x * zoom - 4,
        top: block.rect.y * zoom - 3,
        width: Math.max(block.rect.w * zoom + 24, 80),
        fontSize: block.fontSize * zoom,
        lineHeight: block.lines > 1 ? `${(block.rect.h / block.lines) * zoom}px` : 1.2,
        fontFamily: fontFamilyFor(block.fontName),
        color: `rgb(${r},${g},${b})`,
      }}
      onInput={grow}
      onBlur={(e) => onDone(block, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
      }}
    />
  )
}

function InlineInput({ at, zoom, kind, fontSize, onDone }: { at: Pt; zoom: number; kind: 'note' | 'text'; fontSize: number; onDone: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <textarea
      ref={ref}
      className={'inline-input ' + kind}
      placeholder={kind === 'note' ? 'Write a comment…' : 'Type text…'}
      style={{ left: at[0] * zoom, top: clamp(at[1] * zoom, 0, 1e6), fontSize: kind === 'text' ? fontSize * zoom : 13 }}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.value = ''
          e.currentTarget.blur()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
      }}
    />
  )
}


function FormLayer({ docId, index, zoom }: { docId: string; index: number; zoom: number }) {
  const fields = useStore((s) => s.fields)
  const mine = fields.flatMap((f) => f.widgets.map((w, i) => ({ f, w, i }))).filter(({ w }) => w.page === index)
  if (!mine.length) return null

  const commit = async (name: string, value: string | boolean) => {
    const st = useStore.getState()
    const info = await st.run(() => call('fillForm', { id: docId, values: { [name]: value } }))
    if (info) st.update(docId, info)
  }

  return (
    <>
      {mine.map(({ f, w, i }) => (
        <FieldInput key={`${f.name}-${i}`} field={f} widget={w} zoom={zoom} onCommit={commit} />
      ))}
    </>
  )
}

function FieldInput({ field, widget, zoom, onCommit }: { field: FieldInfo; widget: FieldInfo['widgets'][number]; zoom: number; onCommit: (name: string, v: string | boolean) => void }) {
  const r = widget.rect
  const style: React.CSSProperties = { left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom, fontSize: Math.max(9, Math.min(r.h * zoom * 0.62, 18 * zoom)) }
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  // Optimistic local value so the control responds instantly while the document is being rewritten.
  const [local, setLocal] = useState<string | boolean>(field.value)
  useEffect(() => setLocal(field.value), [field.value])
  const common = { className: 'field', disabled: field.readOnly, style, onPointerDown: stop, title: field.name }
  switch (field.type) {
    case 'checkbox':
      return <input {...common} type="checkbox" checked={local === true} onChange={(e) => { setLocal(e.target.checked); onCommit(field.name, e.target.checked) }} />
    case 'radio':
      return <input {...common} type="radio" name={field.name} checked={local === widget.option} onChange={() => { if (widget.option) { setLocal(widget.option); onCommit(field.name, widget.option) } }} />
    case 'dropdown':
    case 'list':
      return (
        <select {...common} value={String(local)} onChange={(e) => { setLocal(e.target.value); onCommit(field.name, e.target.value) }}>
          <option value=""></option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    default: {
      const props = {
        ...common,
        defaultValue: String(field.value),
        maxLength: field.maxLength,
        onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.value !== field.value && onCommit(field.name, e.currentTarget.value),
      }
      return field.multiline ? <textarea {...props} /> : <input {...props} type="text" onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
    }
  }
}
