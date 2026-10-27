import { useState } from 'react'
import { zipSync } from 'fflate'
import { call, type DocInfo } from '../engine/client'
import type { StampSpec } from '../engine/extras'
import { download } from '../lib/files'
import { ocrWorker, wordsOf } from '../lib/ocr'
import { useStore } from '../store'
import { downloadBlob, Modal } from './Dialogs'
import { Icon } from './Icons'

export type Section = 'pdfa' | 'access' | 'stamp' | 'pages' | 'redact' | 'sign' | 'protect' | 'props' | 'forms' | 'convert' | 'ocr' | 'compare'

const NAV: { id: Section; label: string; icon: string; needsDoc: boolean }[] = [
  { id: 'stamp', label: 'Header, footer & watermark', icon: 'text', needsDoc: true },
  { id: 'pages', label: 'Pages & cleanup', icon: 'file', needsDoc: true },
  { id: 'redact', label: 'Find & redact', icon: 'redact', needsDoc: true },
  { id: 'pdfa', label: 'PDF/A & preflight', icon: 'save', needsDoc: true },
  { id: 'access', label: 'Accessibility', icon: 'speaker', needsDoc: true },
  { id: 'sign', label: 'Certificate signature', icon: 'sign', needsDoc: true },
  { id: 'protect', label: 'Password & size', icon: 'save', needsDoc: true },
  { id: 'props', label: 'Properties & privacy', icon: 'select', needsDoc: true },
  { id: 'forms', label: 'Create form fields', icon: 'rect', needsDoc: true },
  { id: 'ocr', label: 'Recognize text (OCR)', icon: 'search', needsDoc: true },
  { id: 'compare', label: 'Compare documents', icon: 'split', needsDoc: true },
  { id: 'convert', label: 'Export & convert', icon: 'extract', needsDoc: false },
]

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

async function decode(file: File) {
  const bmp = await createImageBitmap(file)
  const cv = new OffscreenCanvas(bmp.width, bmp.height)
  const cx = cv.getContext('2d')!
  cx.fillStyle = '#fff'
  cx.fillRect(0, 0, bmp.width, bmp.height)
  cx.drawImage(bmp, 0, 0)
  const d = cx.getImageData(0, 0, bmp.width, bmp.height)
  return { rgba: d.data, w: bmp.width, h: bmp.height }
}

function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}

function Issues({ issues }: { issues: { severity: 'error' | 'warning'; message: string }[] }) {
  if (!issues.length) return null
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={i.severity}><strong>{i.severity === 'error' ? 'Problem' : 'Note'}</strong> {i.message}</li>
      ))}
    </ul>
  )
}

export function ToolsDialog({ onClose, initial }: { onClose: () => void; initial?: Section }) {
  const st = useStore.getState()
  const doc = st.active()
  const [section, setSection] = useState<Section>(initial ?? (doc ? 'stamp' : 'convert'))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const base = doc?.name.replace(/\.pdf$/i, '') ?? 'document'

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const apply = async <T extends DocInfo>(fn: () => Promise<T>, done?: (r: T) => string) => {
    const r = await st.run(fn)
    if (!r || !doc) return undefined
    st.update(doc.id, r)
    if (done) st.toast('success', done(r))
    return r
  }

  return (
    <Modal title="Tools" onClose={onClose} wide>
      <div className="tools">
        <nav className="tools-nav" aria-label="Tool categories">
          {NAV.map((n) => (
            <button key={n.id} className={section === n.id ? 'active' : ''} disabled={n.needsDoc && !doc} onClick={() => setSection(n.id)}>
              <Icon name={n.icon} size={16} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="tools-body">
          {section === 'stamp' && doc && <StampSection doc={doc} guard={guard} busy={busy} apply={apply} onClose={onClose} />}
          {section === 'pages' && doc && <PagesSection doc={doc} guard={guard} busy={busy} apply={apply} onClose={onClose} />}
          {section === 'redact' && doc && <RedactSection doc={doc} guard={guard} busy={busy} apply={apply} onClose={onClose} />}
          {section === 'pdfa' && doc && <PdfASection doc={doc} guard={guard} busy={busy} onClose={onClose} />}
          {section === 'access' && doc && <AccessSection doc={doc} guard={guard} busy={busy} onClose={onClose} />}
          {section === 'sign' && doc && <SignSection doc={doc} guard={guard} busy={busy} onClose={onClose} />}
          {section === 'protect' && doc && <ProtectSection doc={doc} base={base} guard={guard} busy={busy} apply={apply} onClose={onClose} />}
          {section === 'props' && doc && <PropsSection doc={doc} guard={guard} busy={busy} apply={apply} onClose={onClose} />}
          {section === 'forms' && doc && <FormsSection onClose={onClose} />}
          {section === 'ocr' && doc && <OcrSection doc={doc} guard={guard} busy={busy} progress={progress} setProgress={setProgress} onClose={onClose} />}
          {section === 'compare' && doc && <CompareSection doc={doc} guard={guard} busy={busy} />}
          {section === 'convert' && <ConvertSection doc={doc} base={base} guard={guard} busy={busy} onClose={onClose} />}
        </div>
      </div>
    </Modal>
  )
}

type Doc = NonNullable<ReturnType<typeof useStore.getState>['docs'][number]>
type Common = { doc: Doc; guard: (fn: () => Promise<void>) => Promise<void>; busy: boolean; onClose: () => void }
type Applier = { apply: <T extends DocInfo>(fn: () => Promise<T>, done?: (r: T) => string) => Promise<T | undefined> }

/* ---------- Header, footer, watermark, page & Bates numbers ---------- */
function StampSection({ doc, guard, busy, apply, onClose }: Common & Applier) {
  const [text, setText] = useState('Page {page} of {pages}')
  const [position, setPosition] = useState<StampSpec['position']>('bottom-center')
  const [size, setSize] = useState(10)
  const [color, setColor] = useState('#444444')
  const [alpha, setAlpha] = useState(100)
  const [angle, setAngle] = useState(0)
  const [range, setRange] = useState('')
  const [bates, setBates] = useState(1)

  const preset = (p: Partial<{ text: string; position: StampSpec['position']; size: number; color: string; alpha: number; angle: number }>) => {
    if (p.text !== undefined) setText(p.text)
    if (p.position) setPosition(p.position)
    if (p.size) setSize(p.size)
    if (p.color) setColor(p.color)
    if (p.alpha) setAlpha(p.alpha)
    if (p.angle !== undefined) setAngle(p.angle)
  }

  const go = () =>
    guard(async () => {
      let pages = Array.from({ length: doc.info.pageCount }, (_, i) => i)
      if (range.trim()) {
        const { parseRanges } = await import('../engine/pages')
        try {
          pages = parseRanges(range, doc.info.pageCount)
        } catch (e) {
          return useStore.getState().toast('error', (e as Error).message)
        }
      }
      const spec: StampSpec = { text, size, color: hexRgb(color), alpha: Math.round((alpha / 100) * 255), angle, position, margin: 28, batesStart: bates, batesDigits: 6 }
      const r = await apply(() => call('stamp', { id: doc.id, pages, spec }), () => `Added to ${pages.length} page${pages.length > 1 ? 's' : ''}`)
      if (r) onClose()
    })

  return (
    <>
      <h3>Header, footer &amp; watermark</h3>
      <p className="hint">Add text to every page (or a range). Use <code>{'{page}'}</code>, <code>{'{pages}'}</code>, <code>{'{date}'}</code> and <code>{'{bates}'}</code> for automatic values.</p>
      <div className="chips">
        <button onClick={() => preset({ text: 'Page {page} of {pages}', position: 'bottom-center', size: 10, color: '#444444', alpha: 100, angle: 0 })}>Page numbers</button>
        <button onClick={() => preset({ text: 'DOC-{bates}', position: 'bottom-right', size: 9, color: '#222222', alpha: 100, angle: 0 })}>Bates numbers</button>
        <button onClick={() => preset({ text: 'CONFIDENTIAL', position: 'center', size: 80, color: '#d62828', alpha: 28, angle: 45 })}>Watermark</button>
        <button onClick={() => preset({ text: 'DRAFT', position: 'center', size: 110, color: '#888888', alpha: 25, angle: 45 })}>Draft</button>
        <button onClick={() => preset({ text: '{date}', position: 'top-right', size: 10, color: '#444444', alpha: 100, angle: 0 })}>Date header</button>
      </div>
      <label>Text <input value={text} onChange={(e) => setText(e.target.value)} /></label>
      <div className="grid2">
        <label>Position
          <select value={position} onChange={(e) => setPosition(e.target.value as StampSpec['position'])}>
            {['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>Size <input type="number" min={6} max={300} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
        <label>Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <label>Opacity {alpha}% <input type="range" min={5} max={100} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} /></label>
        <label>Angle <input type="number" min={-180} max={180} value={angle} onChange={(e) => setAngle(Number(e.target.value))} /></label>
        <label>Bates starts at <input type="number" min={0} value={bates} onChange={(e) => setBates(Number(e.target.value))} /></label>
      </div>
      <label>Pages (blank = all) <input placeholder="e.g. 1-3, 5" value={range} onChange={(e) => setRange(e.target.value)} /></label>
      <div className="actions"><span className="spacer" /><button className="primary" disabled={busy || !text} onClick={go}>Apply</button></div>
    </>
  )
}

/* ---------- Blank page, crop, flatten ---------- */
function PagesSection({ doc, guard, busy, apply, onClose }: Common & Applier) {
  const page = useStore((s) => s.page)
  return (
    <>
      <h3>Pages &amp; cleanup</h3>
      <div className="stack">
        <div className="card-row">
          <div><strong>Insert a blank page</strong><p className="hint">After page {page + 1}, same size as that page.</p></div>
          <button disabled={busy} onClick={() => guard(async () => void (await apply(() => call('insertBlank', { id: doc.id, at: page + 1 }), () => 'Blank page added')))}>Insert</button>
        </div>
        <div className="card-row">
          <div><strong>Crop pages</strong><p className="hint">Drag a box on a page. You choose whether it applies to one page or all.</p></div>
          <button onClick={() => { useStore.getState().setTool('crop'); onClose() }}>Choose area</button>
        </div>
        <div className="card-row">
          <div><strong>Flatten</strong><p className="hint">Bakes comments, drawings and filled-in form fields into the page so they can no longer be changed.</p></div>
          <button disabled={busy} onClick={() => {
            if (window.confirm('Flatten every page? Annotations and form fields will no longer be editable (you can still undo).')) guard(async () => { await apply(() => call('flatten', { id: doc.id }), () => 'Flattened') })
          }}>Flatten all</button>
        </div>
      </div>
    </>
  )
}

/* ---------- Find & redact ---------- */
const PATTERNS: Record<string, { label: string; source: string; flags: string }> = {
  email: { label: 'Email addresses', source: '[\\w.+-]+@[\\w-]+\\.[\\w.]+', flags: 'g' },
  phone: { label: 'Phone numbers', source: '(?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(\\d{3}\\)|\\d{3})[\\s.-]\\d{3}[\\s.-]\\d{4}', flags: 'g' },
  ssn: { label: 'US Social Security numbers', source: '\\b\\d{3}-\\d{2}-\\d{4}\\b', flags: 'g' },
  card: { label: 'Credit-card numbers', source: '\\b(?:\\d[ -]?){13,19}\\b', flags: 'g' },
  iban: { label: 'IBAN', source: '\\b[A-Z]{2}\\d{2}(?:\\s?[A-Z0-9]{4}){3,7}(?:\\s?[A-Z0-9]{1,3})?\\b', flags: 'g' },
}

function RedactSection({ doc, guard, busy, apply, onClose }: Common & Applier) {
  const [on, setOn] = useState<Record<string, boolean>>({ email: true })
  const [custom, setCustom] = useState('')
  const [found, setFound] = useState<{ page: number; text: string }[] | null>(null)

  const patterns = () => {
    const list = Object.entries(on).filter(([, v]) => v).map(([k]) => ({ source: PATTERNS[k].source, flags: PATTERNS[k].flags }))
    for (const w of custom.split('\n').map((x) => x.trim()).filter(Boolean)) list.push({ source: w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags: 'gi' })
    return list
  }
  const run = (dry: boolean) =>
    guard(async () => {
      const p = patterns()
      if (!p.length) return useStore.getState().toast('error', 'Pick something to look for')
      if (!dry && !window.confirm('Permanently remove everything found? After you save this cannot be recovered.')) return
      const r = await useStore.getState().run(() => call('redactMatches', { id: doc.id, patterns: p, dryRun: dry }))
      if (!r) return
      setFound(r.found)
      if (!dry) {
        useStore.getState().update(doc.id, r)
        useStore.getState().toast('success', `Redacted ${r.found.length} item${r.found.length === 1 ? '' : 's'}`)
        onClose()
      }
    })
  void apply

  return (
    <>
      <h3>Find &amp; redact</h3>
      <p className="hint">Search for sensitive information and remove it permanently. Review the matches first.</p>
      {Object.entries(PATTERNS).map(([k, v]) => (
        <label key={k} className="row"><input type="checkbox" checked={!!on[k]} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} /> {v.label}</label>
      ))}
      <label>Specific words or phrases (one per line)
        <textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Project Falcon&#10;Jane Doe" />
      </label>
      {found && (
        <div className="found">
          <strong>{found.length} match{found.length === 1 ? '' : 'es'}</strong>
          <ul>{found.slice(0, 40).map((f, i) => <li key={i}>p.{f.page + 1}: <code>{f.text}</code></li>)}{found.length > 40 && <li>…and {found.length - 40} more</li>}</ul>
        </div>
      )}
      <div className="actions"><span className="spacer" />
        <button disabled={busy} onClick={() => run(true)}>Preview matches</button>
        <button className="primary" disabled={busy} onClick={() => run(false)}>Redact all matches</button>
      </div>
    </>
  )
}

/* ---------- PDF/A & preflight ---------- */
function PdfASection({ doc, guard, busy, onClose }: Common) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof call<'pdfaCheck'>>> | null>(null)
  const [flatten, setFlatten] = useState(true)
  const check = () => guard(async () => { const r = await useStore.getState().run(() => call('pdfaCheck', { id: doc.id })); if (r) setReport(r) })
  const convert = () =>
    guard(async () => {
      const st = useStore.getState()
      const r = await st.run(() => call('pdfaConvert', { id: doc.id, flatten }))
      if (!r) return
      st.update(doc.id, r)
      setReport(r.report)
      const extra = [r.fonts.replacedObjects ? `${r.fonts.replacedObjects} text run${r.fonts.replacedObjects > 1 ? 's' : ''} re-set in an embedded font` : '', r.removed.length ? `removed ${r.removed.join(', ')}` : ''].filter(Boolean).join('; ')
      st.toast(r.report.passesChecks ? 'success' : 'info', `Converted to PDF/A-2b${extra ? ` (${extra})` : ''}. Save the file to keep it.`)
    })
  void onClose
  return (
    <>
      <h3>PDF/A &amp; preflight</h3>
      <p className="hint">PDF/A-2b is the archival format: every font embedded, colours declared, no scripts or encryption. Kwiiva Paper re-sets non-embedded text in metric-compatible embedded fonts (so layout is preserved), adds the required metadata and colour profile, and removes forbidden features.</p>
      <label className="row"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten comments and form fields (recommended: their appearances often use non-embedded fonts)</label>
      <div className="actions"><span className="spacer" /><button disabled={busy} onClick={check}>Check only</button><button className="primary" disabled={busy} onClick={convert}>Convert to PDF/A-2b</button></div>
      {report && (
        <>
          <p className={'hint ' + (report.passesChecks ? 'ok' : 'bad')}>{report.passesChecks ? 'No problems found by Kwiiva Paper\'s checks.' : 'Problems found:'}</p>
          <Issues issues={report.issues} />
        </>
      )}
      <p className="hint"><strong>Be aware:</strong> this is Kwiiva Paper's own conversion and checker. It has not been certified by the official validator (veraPDF). If you need guaranteed compliance for a legal or archival requirement, validate the result with veraPDF.</p>
    </>
  )
}

/* ---------- Accessibility ---------- */
function AccessSection({ doc, guard, busy }: Common) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof call<'a11yCheck'>>> | null>(null)
  const [figs, setFigs] = useState<Awaited<ReturnType<typeof call<'a11yFigures'>>> | null>(null)
  const [alts, setAlts] = useState<Record<string, string>>({})
  const [lang, setLang] = useState(navigator.language || 'en-US')
  const [title, setTitle] = useState(doc.name.replace(/\.pdf$/i, ''))
  const run = () => guard(async () => {
    const st = useStore.getState()
    const [r, f] = await Promise.all([st.run(() => call('a11yCheck', { id: doc.id })), st.run(() => call('a11yFigures', { id: doc.id }))])
    if (r) setReport(r)
    if (f) setFigs(f)
  })
  const tag = () => guard(async () => {
    const st = useStore.getState()
    const r = await st.run(() => call('a11yTag', { id: doc.id, lang, title, alts }))
    if (!r) return
    st.update(doc.id, r)
    st.toast('success', 'Document tagged. Save the file to keep it.')
    const c = await st.run(() => call('a11yCheck', { id: doc.id }))
    if (c) setReport(c)
  })
  return (
    <>
      <h3>Accessibility</h3>
      <p className="hint">Makes a document usable with screen readers: adds a structure tree (headings, paragraphs, figures) in reading order, a document language and title, and alternative text for images. Tagging is automatic and based on layout, so skim the result in a reader before relying on it for compliance.</p>
      <div className="grid2">
        <label>Document title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Language (e.g. en-US)<input value={lang} onChange={(e) => setLang(e.target.value)} /></label>
      </div>
      {figs && figs.length > 0 && (
        <>
          <strong>Images: describe each for people who can't see it</strong>
          {figs.map((f) => (
            <label key={f.key}>Page {f.page + 1}, image at ({Math.round(f.rect.x)}, {Math.round(f.rect.y)})<input value={alts[f.key] ?? ''} placeholder="Alternative text (leave empty for decorative images)" onChange={(e) => setAlts({ ...alts, [f.key]: e.target.value })} /></label>
          ))}
        </>
      )}
      <div className="actions"><span className="spacer" /><button disabled={busy} onClick={run}>Check accessibility</button><button className="primary" disabled={busy} onClick={tag}>Tag document automatically</button></div>
      {report && (
        <>
          <p className="hint"><strong>{report.tagged ? 'Tagged' : 'Not tagged'}</strong>{report.tagged ? `: ${report.headings} headings, ${report.paragraphs} paragraphs, ${report.figures} figures` : ''}</p>
          {report.issues.length === 0 ? <p className="hint ok">No problems found by Kwiiva Paper's checks.</p> : <Issues issues={report.issues} />}
        </>
      )}
    </>
  )
}

/* ---------- Certificate signature ---------- */
function SignSection({ doc, guard, busy, onClose }: Common) {
  const [file, setFile] = useState<File | null>(null)
  const [pw, setPw] = useState('')
  const [reason, setReason] = useState('I approve this document')
  const [visible, setVisible] = useState(true)
  const [cert, setCert] = useState<{ commonName: string; issuer: string; validTo: string; selfSigned: boolean } | null>(null)
  const page = useStore((s) => s.page)

  const readCert = async (f: File, password: string) => {
    const p12 = new Uint8Array(await f.arrayBuffer())
    const r = await useStore.getState().run(() => call('certInfo', { p12, password }))
    setCert(r ?? null)
  }

  const go = () =>
    guard(async () => {
      if (!file) return
      const p12 = new Uint8Array(await file.arrayBuffer())
      const size = doc.info.sizes[Math.min(page, doc.info.sizes.length - 1)]
      const rect = visible ? { x: 36, y: size.height - 36 - 54, w: 230, h: 54 } : undefined
      const bytes = await useStore.getState().run(() => call('signCertificate', { id: doc.id, p12, password: pw, rect, page, reason, visible }))
      if (bytes) {
        await download(doc.name.replace(/\.pdf$/i, '') + '-signed.pdf', bytes)
        useStore.getState().toast('success', 'Signed copy saved. Do not edit and re-save it, or the signature will be invalidated.')
        onClose()
      }
    })

  const found = doc.signatures ?? []
  return (
    <>
      {found.length > 0 && (
        <>
          <h3>Signatures in this file</h3>
          {found.map((sg, i) => (
            <div key={i} className={'card-row sigcard ' + (sg.status === 'valid' && sg.coversWholeFile ? 'ok' : sg.status === 'valid' ? 'warn' : 'bad')}>
              <div>
                <strong>{sg.signer}</strong> <span className="hint">{sg.status === 'valid' ? 'content unchanged since signing' : sg.status === 'modified' ? 'CONTENT CHANGED AFTER SIGNING' : sg.status === 'invalid' ? 'SIGNATURE INVALID' : sg.problem ?? 'could not be checked'}</span>
                <p className="hint">
                  {sg.issuer && <>Issued by {sg.issuer}{sg.selfSigned ? ' (self-signed: identity not independently verified)' : ' (Kwiiva Paper has no trusted-root list, so the issuer is not verified)'}. </>}
                  {sg.signedAt && <>Signed {new Date(sg.signedAt).toLocaleString()}. </>}
                  {sg.validTo && <>Certificate {sg.certificateExpired ? 'expired' : 'valid until'} {new Date(sg.validTo).toLocaleDateString()}. </>}
                  {sg.reason && <>Reason: {sg.reason}. </>}
                  {!sg.coversWholeFile && <>Content was added after this signature.</>}
                </p>
              </div>
            </div>
          ))}
          <p className="hint">The cryptographic check confirms the signed content and signature match; it cannot tell you whether you should trust the signer.</p>
        </>
      )}
      <h3>Certificate signature</h3>
      <p className="hint">Applies a cryptographic digital signature using your own certificate (.p12 / .pfx). Other PDF viewers will show whether the file changed after signing. The signed copy is downloaded; your open document is unchanged.</p>
      <label>Certificate file
        <input type="file" accept=".p12,.pfx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setCert(null) }} />
      </label>
      <label>Certificate password
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onBlur={() => file && pw && readCert(file, pw)} />
      </label>
      {cert && <p className="hint ok">Signing as <strong>{cert.commonName}</strong>, issued by {cert.issuer}, valid until {new Date(cert.validTo).toLocaleDateString()}.{cert.selfSigned ? ' (Self-signed: recipients will see it as unverified unless they trust your certificate.)' : ''}</p>}
      <label>Reason <input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label className="row"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Show a signature note at the top-left of page {page + 1}</label>
      <div className="actions"><span className="spacer" /><button className="primary" disabled={busy || !file || !pw} onClick={go}>Sign and download</button></div>
    </>
  )
}

/* ---------- Password & size ---------- */
function ProtectSection({ doc, base, guard, busy, apply, onClose }: Common & Applier & { base: string }) {
  const [user, setUser] = useState('')
  const [owner, setOwner] = useState('')
  const [perm, setPerm] = useState({ print: true, modify: true, copy: true, annotate: true })
  return (
    <>
      <h3>Password protection</h3>
      <p className="hint">Creates an AES-256 encrypted copy. Your open document stays unchanged.</p>
      <input type="password" placeholder="Password to open the file" value={user} onChange={(e) => setUser(e.target.value)} />
      <input type="password" placeholder="Owner password (optional, controls permissions)" value={owner} onChange={(e) => setOwner(e.target.value)} />
      {(['print', 'copy', 'modify', 'annotate'] as const).map((k) => (
        <label key={k} className="row"><input type="checkbox" checked={perm[k]} onChange={(e) => setPerm({ ...perm, [k]: e.target.checked })} /> Allow {k === 'copy' ? 'copying text' : k === 'annotate' ? 'comments and form filling' : k === 'modify' ? 'editing' : 'printing'}</label>
      ))}
      <p className="hint">Permission limits are only enforced by well-behaved software; the password is what keeps the file private. A lost password can't be recovered.</p>
      <div className="actions"><span className="spacer" /><button className="primary" disabled={busy || !user} onClick={() => guard(async () => {
        const bytes = await useStore.getState().run(() => call('protect', { id: doc.id, user, owner: owner || undefined, perms: perm }))
        if (bytes) { await download(`${base}-protected.pdf`, bytes); useStore.getState().toast('success', 'Saved a password-protected copy. Your open document is unchanged.'); onClose() }
      })}>Encrypt and save a copy</button></div>
      <h3>Reduce file size</h3>
      <p className="hint">Recompresses the file and packs its internal objects. Pages look identical.</p>
      <div className="actions"><span className="spacer" /><button disabled={busy} onClick={() => guard(async () => {
        const r = await useStore.getState().run(() => call('optimize', { id: doc.id }))
        if (!r) return
        useStore.getState().update(doc.id, r)
        useStore.getState().toast('success', r.after < r.before ? `Reduced from ${fmtSize(r.before)} to ${fmtSize(r.after)}` : 'This file is already as small as it can get')
        onClose()
      })}>{busy ? 'Working…' : 'Reduce file size'}</button></div>
      <span hidden>{String(apply)}</span>
    </>
  )
}

/* ---------- Properties & sanitize ---------- */
function PropsSection({ doc, guard, busy, apply, onClose }: Common & Applier) {
  const [p, setP] = useState<Record<string, string> | null>(null)
  const [opt, setOpt] = useState({ metadata: true, javascript: true, attachments: true, comments: false })
  if (!p) {
    call('props', { id: doc.id }).then((x) => setP({ ...x })).catch(() => setP({}))
    return <p className="hint">Loading…</p>
  }
  return (
    <>
      <h3>Document properties</h3>
      {(['title', 'author', 'subject', 'keywords'] as const).map((k) => (
        <label key={k}>{k[0].toUpperCase() + k.slice(1)}<input value={p[k] ?? ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
      ))}
      <div className="actions"><span className="spacer" /><button className="primary" disabled={busy} onClick={() => guard(async () => { await apply(() => call('setProps', { id: doc.id, props: { title: p.title, author: p.author, subject: p.subject, keywords: p.keywords } }), () => 'Properties updated') })}>Save properties</button></div>
      <h3>Remove hidden information</h3>
      <p className="hint">Strip data you may not want to share. Good practice before sending a document outside your organization.</p>
      {([['metadata', 'Properties, XMP metadata and application data'], ['javascript', 'JavaScript and open actions'], ['attachments', 'Embedded file attachments'], ['comments', 'Comments and markup (keeps form fields and links)']] as const).map(([k, label]) => (
        <label key={k} className="row"><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} /> {label}</label>
      ))}
      <div className="actions"><span className="spacer" /><button disabled={busy} onClick={() => guard(async () => {
        const r = await useStore.getState().run(() => call('sanitize', { id: doc.id, options: opt }))
        if (!r) return
        useStore.getState().update(doc.id, r)
        useStore.getState().toast('success', r.removed.length ? `Removed: ${r.removed.join(', ')}` : 'Nothing to remove')
        onClose()
      })}>Remove selected</button></div>
    </>
  )
}

/* ---------- Create form fields ---------- */
function FormsSection({ onClose }: { onClose: () => void }) {
  const types = [['text', 'Text field'], ['checkbox', 'Check box'], ['radio', 'Radio button'], ['dropdown', 'Drop-down'], ['list', 'List box']] as const
  return (
    <>
      <h3>Create form fields</h3>
      <p className="hint">Pick a field type, then drag a box on the page where the field should go. The result is a standard fillable PDF form.</p>
      <div className="chips">
        {types.map(([t, label]) => (
          <button key={t} onClick={() => { useStore.setState({ fieldType: t, tool: 'field' }); onClose() }}>{label}</button>
        ))}
      </div>
    </>
  )
}

/* ---------- OCR ---------- */
function OcrSection({ doc, guard, busy, progress, setProgress, onClose }: Common & { progress: string; setProgress: (s: string) => void }) {
  const run = () =>
    guard(async () => {
      const st = useStore.getState()
      const SCALE = 2.5
      let done = 0
      let skipped = 0
      try {
        const worker = await ocrWorker()
        for (let i = 0; i < doc.info.pageCount; i++) {
          setProgress(`Page ${i + 1} of ${doc.info.pageCount}…`)
          if ((await call('blocks', { id: doc.id, page: i })).length) { skipped++; continue }
          const img = await call('render', { id: doc.id, page: i, scale: SCALE })
          const cv = new OffscreenCanvas(img.width, img.height)
          cv.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0)
          const { data } = await worker.recognize(cv as unknown as HTMLCanvasElement, {}, { blocks: true })
          const words = wordsOf(data as never).map((w) => ({ text: w.text, x: w.x / SCALE, y: w.y / SCALE, w: w.w / SCALE, h: w.h / SCALE }))
          if (!words.length) continue
          st.update(doc.id, await call('ocrLayer', { id: doc.id, page: i, words }))
          done++
        }
      } catch (e) {
        st.toast('error', `Text recognition failed: ${(e as Error).message}`)
        return
      } finally {
        setProgress('')
      }
      st.toast(done ? 'success' : 'info', done ? `Recognized text on ${done} page${done > 1 ? 's' : ''}${skipped ? ` (${skipped} already had text)` : ''}. You can now search, select and edit it.` : skipped ? 'Every page already has text.' : 'No text was found.')
      onClose()
    })
  return (
    <>
      <h3>Recognize text (OCR)</h3>
      <p className="hint">For scanned documents: finds the words in page images and adds an invisible text layer, so the pages become searchable, selectable and editable. Pages that already contain text are skipped. English only for now. Runs entirely on your computer.</p>
      <div className="actions"><span className="hint">{progress}</span><span className="spacer" /><button className="primary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Recognize text'}</button></div>
    </>
  )
}

/* ---------- Compare ---------- */
function CompareSection({ doc, guard, busy }: Pick<Common, 'doc' | 'guard' | 'busy'>) {
  const docs = useStore((s) => s.docs).filter((d) => d.id !== doc.id)
  const [other, setOther] = useState(docs[0]?.id ?? '')
  const [res, setRes] = useState<Awaited<ReturnType<typeof call<'compare'>>> | null>(null)
  if (!docs.length) return (<><h3>Compare documents</h3><p className="hint">Open a second PDF (a different version of this one) in another tab, then come back here.</p></>)
  return (
    <>
      <h3>Compare documents</h3>
      <p className="hint">Compares the text of <strong>{doc.name}</strong> (old) with another open document (new), paragraph by paragraph. It reports text changes; it does not compare images or layout.</p>
      <label>New version
        <select value={other} onChange={(e) => setOther(e.target.value)}>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      </label>
      <div className="actions"><span className="spacer" /><button className="primary" disabled={busy} onClick={() => guard(async () => { const r = await useStore.getState().run(() => call('compare', { a: doc.id, b: other })); if (r) setRes(r) })}>Compare</button></div>
      {res && (res.tooDifferent ? <p className="hint">These documents are too different to compare in detail.</p> : (
        <div className="found">
          <strong>{res.changes.length ? `${res.changes.length} difference${res.changes.length === 1 ? '' : 's'}` : 'The text is identical'}</strong> <span className="hint">({res.identical} paragraphs unchanged)</span>
          <ul className="diff">{res.changes.slice(0, 200).map((c, i) => <li key={i} className={c.kind}><span>{c.kind === 'added' ? '+' : '−'} p.{c.page + 1}</span> {c.text}</li>)}</ul>
        </div>
      ))}
    </>
  )
}

/* ---------- Export & convert ---------- */
function ConvertSection({ doc, base, guard, busy, onClose }: { doc?: Doc; base: string; guard: Common['guard']; busy: boolean; onClose: () => void }) {
  const st = useStore.getState()
  const mk = (label: string, hint: string, fn: () => Promise<void>) => (
    <div className="card-row"><div><strong>{label}</strong><p className="hint">{hint}</p></div><button disabled={busy} onClick={() => guard(fn)}>Export</button></div>
  )
  return (
    <>
      <h3>Export &amp; convert</h3>
      <div className="stack">
        {doc && mk('Document (.docx)', 'Text, headings and paragraphs. Layout, tables and images are not reproduced.', async () => {
          const bytes = await st.run(() => call('exportDocx', { id: doc.id }))
          if (bytes) await download(`${base}.docx`, bytes)
        })}
        {doc && mk('Plain text (.txt)', 'The text layer of every page.', async () => {
          const text = await st.run(() => call('exportText', { id: doc.id }))
          if (text !== undefined) await downloadBlob(`${base}.txt`, new Blob([text], { type: 'text/plain;charset=utf-8' }))
        })}
        {doc && mk('Images (PNG)', 'One image per page, at 144 dpi. Several pages come as a ZIP.', async () => {
          const files: Record<string, Uint8Array> = {}
          for (let i = 0; i < doc.info.pageCount; i++) {
            const img = await call('render', { id: doc.id, page: i, scale: 2 })
            const cv = new OffscreenCanvas(img.width, img.height)
            cv.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0)
            files[`${base}-page${String(i + 1).padStart(3, '0')}.png`] = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer())
          }
          const names = Object.keys(files)
          if (names.length === 1) await downloadBlob(names[0], new Blob([files[names[0]] as BlobPart], { type: 'image/png' }))
          else await downloadBlob(`${base}-images.zip`, new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }))
        })}
        <div className="card-row"><div><strong>Images to PDF</strong><p className="hint">Pick images (PNG, JPEG, WebP…). Each becomes a page, in the order you select them.</p></div>
          <button disabled={busy} onClick={() => guard(async () => {
            const files = await pickFile('image/*', true)
            if (!files.length) return
            const images = await Promise.all(files.map(decode)).catch((e) => { st.toast('error', `Could not read an image: ${(e as Error).message}`); return null })
            if (!images) return
            const id = 'img' + Date.now()
            const info = await st.run(() => call('fromImages', { id, images }, images.map((i) => i.rgba.buffer)))
            if (info) { useStore.setState((s) => ({ docs: [...s.docs, { id, name: 'Images.pdf', info, dirty: true }], activeId: id, page: 0 })); onClose() }
          })}>Choose images…</button></div>
      </div>
    </>
  )
}
