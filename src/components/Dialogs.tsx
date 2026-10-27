import { useEffect, useRef, useState } from 'react'
import { call } from '../engine/client'
import { download } from '../lib/files'
import { zipSync } from 'fflate'
import { useStore } from '../store'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [typed, setTyped] = useState('')
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0b2a6f'
  }, [mode])

  const pt = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return [((e.clientX - r.left) * canvas.current!.width) / r.width, ((e.clientY - r.top) * canvas.current!.height) / r.height]
  }

  const save = () => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    if (mode === 'type') {
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.fillStyle = '#0b2a6f'
      ctx.font = 'italic 80px "Snell Roundhand", "Segoe Script", "Brush Script MT", cursive'
      ctx.textBaseline = 'middle'
      ctx.fillText(typed, 20, c.height / 2, c.width - 40)
    } else if (!dirty.current) return
    // Trim transparent margins.
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)
    let x0 = width, y0 = height, x1 = 0, y1 = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    if (x1 <= x0) return
    const out = document.createElement('canvas')
    out.width = x1 - x0 + 8
    out.height = y1 - y0 + 8
    out.getContext('2d')!.drawImage(c, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height)
    const url = out.toDataURL('image/png')
    try { localStorage.setItem('kwiiva-paper.signature', url) } catch { /* private mode: keep it for this session only */ }
    useStore.setState({ signature: url, tool: 'sign' })
    onClose()
  }

  return (
    <Modal title="Your signature" onClose={onClose}>
      <div className="tabs">
        <button className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>Draw</button>
        <button className={mode === 'type' ? 'active' : ''} onClick={() => setMode('type')}>Type</button>
      </div>
      {mode === 'draw' ? (
        <canvas
          ref={canvas}
          width={600}
          height={200}
          className="sigpad"
          onPointerDown={(e) => { drawing.current = true; dirty.current = true; const [x, y] = pt(e); const ctx = canvas.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(x, y); e.currentTarget.setPointerCapture(e.pointerId) }}
          onPointerMove={(e) => { if (!drawing.current) return; const [x, y] = pt(e); const ctx = canvas.current!.getContext('2d')!; ctx.lineTo(x, y); ctx.stroke() }}
          onPointerUp={() => (drawing.current = false)}
        />
      ) : (
        <>
          <input autoFocus className="typed" placeholder="Type your name" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <canvas ref={canvas} width={600} height={200} hidden />
        </>
      )}
      <p className="hint">Stored only in this browser. Click or drag on a page with the Sign tool to place it. This is a visual signature, not a certificate-based digital signature.</p>
      <div className="actions">
        <button onClick={() => { const c = canvas.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); dirty.current = false }}>Clear</button>
        {useStore.getState().signature && <button onClick={() => { localStorage.removeItem('kwiiva-paper.signature'); useStore.setState({ signature: null }); onClose() }}>Delete saved</button>}
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>Use signature</button>
      </div>
    </Modal>
  )
}

export function SplitDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.active())!
  const [mode, setMode] = useState<'ranges' | 'every'>('ranges')
  const [ranges, setRanges] = useState('')
  const [every, setEvery] = useState(1)
  const base = doc.name.replace(/\.pdf$/i, '')

  const go = async () => {
    const { run, toast } = useStore.getState()
    const n = doc.info.pageCount
    let groups: number[][]
    try {
      if (mode === 'every') {
        groups = []
        for (let i = 0; i < n; i += every) groups.push(Array.from({ length: Math.min(every, n - i) }, (_, k) => i + k))
      } else {
        const { parseRanges } = await import('../engine/pages')
        groups = ranges.split(';').map((r) => parseRanges(r, n)).filter((g) => g.length)
      }
    } catch (e) {
      return toast('error', (e as Error).message)
    }
    if (!groups.length) return toast('error', 'Enter at least one page range, e.g. 1-3; 4-6')
    const files: Record<string, Uint8Array> = {}
    let k = 1
    for (const pages of groups) {
      const bytes = await run(() => call('extract', { id: doc.id, pages }))
      if (bytes) files[`${base}-part${k++}.pdf`] = bytes
    }
    const names = Object.keys(files)
    if (names.length === 1) download(names[0], files[names[0]])
    else if (names.length) downloadBlob(`${base}-split.zip`, new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }))
    toast('success', `Created ${names.length} file${names.length > 1 ? 's' : ''}`)
    onClose()
  }

  return (
    <Modal title="Split PDF" onClose={onClose}>
      <p className="hint">{doc.name} has {doc.info.pageCount} pages.</p>
      <label className="row"><input type="radio" checked={mode === 'ranges'} onChange={() => setMode('ranges')} /> By page ranges</label>
      {mode === 'ranges' && <input autoFocus placeholder="1-3; 4-6; 7-" value={ranges} onChange={(e) => setRanges(e.target.value)} />}
      <label className="row"><input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} /> Every
        <input type="number" min={1} max={doc.info.pageCount} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value)))} style={{ width: 70, margin: '0 6px' }} /> page(s)
      </label>
      <p className="hint">Separate ranges with semicolons; each range becomes its own file.</p>
      <div className="actions"><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" onClick={go}>Split</button></div>
    </Modal>
  )
}

export async function downloadBlob(name: string, blob: Blob) {
  await download(name, new Uint8Array(await blob.arrayBuffer()))
}
