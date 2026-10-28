import { errText, nativeRead, nativeWrite } from '../../../shared/native'
import { isTauri } from '../../../src/lib/platform'
import { useStore, type FileKind } from '../store'
import { buildTemplate } from '../templates'
import type { Deck } from '../model'
import { getDraft, type Draft } from './storage'

type Picker = Window & { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>; showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }

export const KINDS: Record<FileKind, { label: string; ext: string; mime: string }> = {
  pptx: { label: 'Presentation (.pptx)', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  pdf: { label: 'PDF (.pdf)', ext: 'pdf', mime: 'application/pdf' },
  png: { label: 'Picture (.png)', ext: 'png', mime: 'image/png' },
  html: { label: 'Web page (.html)', ext: 'html', mime: 'text/html' },
  md: { label: 'Outline (.md)', ext: 'md', mime: 'text/markdown' },
  txt: { label: 'Plain text (.txt)', ext: 'txt', mime: 'text/plain' },
}
const baseName = (p: string) => p.split(/[\\/]/).pop() || p
const stem = (n: string) => n.replace(/\.[^.]+$/, '')

export function newDeck(templateId = 'blank') {
  const d = buildTemplate(templateId)
  useStore.getState().setDeck(d, { name: templateId === 'blank' ? 'Untitled presentation' : d.title, kind: null, dirty: false })
}

export function openDraft(d: Draft) { useStore.getState().setDeck(d.deck, { name: d.title, kind: null, dirty: false }); useStore.setState({ draftId: d.id }) }
export async function openDraftById(id: string) { const d = await getDraft(id); if (d) openDraft(d) }

export async function openBytes(name: string, bytes: Uint8Array, handle?: FileSystemFileHandle, path?: string) {
  const s = useStore.getState()
  try {
    if (/\.(md|txt|markdown)$/i.test(name)) {
      const { parseOutline, outlineToSlides } = await import('../formats/outline')
      const base = buildTemplate('blank'); base.slides = []
      base.slides = outlineToSlides(base, parseOutline(new TextDecoder().decode(bytes)), true)
      if (!base.slides.length) throw new Error('There is no # heading in that file to make slides from.')
      s.setDeck({ ...base, title: stem(name) }, { name: stem(name), kind: null, dirty: true })
      return
    }
    const { readPptx } = await import('../formats/pptxRead')
    const r = readPptx(bytes, name)
    s.setDeck(r.deck, { name: stem(name), kind: 'pptx', handle, path, dirty: false })
    if (r.notes.length) s.toast('info', r.notes[0])
  } catch (e) {
    s.toast('error', `Could not open ${name}: ${(e as Error).message}`)
  }
}

const OPEN_EXT = ['pptx', 'md', 'txt']
export async function openFile() {
  const w = window as Picker
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ multiple: false, filters: [{ name: 'Presentations', extensions: OPEN_EXT }] })
    if (typeof path === 'string') await openBytes(baseName(path), await nativeRead(path), undefined, path)
    return
  }
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: 'Presentations', accept: { 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'], 'text/*': ['.md', '.txt'] } }] })
      const f = await h.getFile()
      await openBytes(f.name, new Uint8Array(await f.arrayBuffer()), h)
    } catch (e) { if ((e as Error).name !== 'AbortError') useStore.getState().toast('error', (e as Error).message) }
    return
  }
  const i = document.createElement('input')
  i.type = 'file'; i.accept = '.pptx,.md,.txt'
  i.onchange = async () => { const f = i.files?.[0]; if (f) await openBytes(f.name, new Uint8Array(await f.arrayBuffer())) }
  i.click()
}

async function download(name: string, bytes: BlobPart, mime: string) {
  if (isTauri) {
    const { save: dlg } = await import('@tauri-apps/plugin-dialog')
    const path = await dlg({ defaultPath: name })
    if (path) { try { await nativeWrite(path, bytes instanceof Uint8Array ? bytes : new Uint8Array(await new Blob([bytes]).arrayBuffer())); useStore.getState().toast('success', `Saved ${baseName(path)}`) } catch (e) { useStore.getState().toast('error', `Could not save: ${errText(e)}`) } }
    return
  }
  const a = document.createElement('a')
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Pictures a .pptx cannot hold (SVG, WebP, AVIF…) become PNG in the copy that is written. */
async function withPngPictures(deck: Deck): Promise<Deck> {
  const ok = /^image\/(png|jpe?g|gif|bmp)$/
  const bad = Object.entries(deck.media).filter(([, m]) => m.mime.startsWith('image/') && !ok.test(m.mime))
  if (!bad.length) return deck
  const media = { ...deck.media }
  for (const [id, m] of bad) {
    try {
      const img = new Image()
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('picture')); img.src = m.data })
      const k = img.naturalWidth ? 1 : 1
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round((img.naturalWidth || 800) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || 600) * k))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      media[id] = { ...m, mime: 'image/png', data: c.toDataURL('image/png') }
    } catch { /* keep as it is */ }
  }
  return { ...deck, media }
}

async function render(kind: FileKind, deck: Deck): Promise<Uint8Array | string> {
  if (kind === 'pptx') { const { writePptx } = await import('../formats/pptxWrite'); return writePptx(await withPngPictures(deck), deck) }
  if (kind === 'pdf') { const { writePdf } = await import('../formats/pdf'); return writePdf(deck) }
  if (kind === 'png') { const { renderSlidePng } = await import('./raster'); return renderSlidePng(deck, useStore.getState().deck.slides.findIndex((s) => s.id === useStore.getState().cur)) }
  if (kind === 'html') { const { writeHtml } = await import('../formats/html'); return writeHtml(deck) }
  const o = await import('../formats/outline')
  return kind === 'md' ? o.deckToOutline(deck) : o.deckToText(deck)
}

export async function save(o: { saveAs?: boolean; kind?: FileKind } = {}) {
  const s = useStore.getState()
  const kind: FileKind = o.kind ?? s.file.kind ?? 'pptx'
  const name = (s.file.name.trim() || 'Untitled presentation')
  const deck = { ...s.deck, title: name }
  let data: Uint8Array | string
  try { data = await render(kind, deck) } catch (e) { s.toast('error', `Could not make the ${KINDS[kind].ext} file: ${(e as Error).message}`); return }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const k = KINDS[kind]
  const persist = kind === 'pptx' && !o.saveAs && (o.kind === undefined || o.kind === 'pptx')
  const w = window as Picker
  try {
    if (isTauri) {
      const { save: dlg } = await import('@tauri-apps/plugin-dialog')
      let path = persist ? s.file.path : undefined
      if (!path) { const p = await dlg({ defaultPath: `${name}.${k.ext}`, filters: [{ name: k.label, extensions: [k.ext] }] }); if (!p) return; path = p }
      await nativeWrite(path, bytes)
      if (kind === 'pptx') useStore.setState({ file: { ...s.file, path, name: stem(baseName(path)), kind, dirty: false } })
      s.toast('success', `Saved ${baseName(path)}`)
      return
    }
    if (w.showSaveFilePicker) {
      let handle = persist ? s.file.handle : undefined
      if (!handle) handle = await w.showSaveFilePicker({ suggestedName: `${name}.${k.ext}`, types: [{ description: k.label, accept: { [k.mime]: [`.${k.ext}`] } }] })
      const wr = await handle.createWritable()
      await wr.write(bytes as unknown as BufferSource)
      await wr.close()
      if (kind === 'pptx') useStore.setState({ file: { ...s.file, handle, name: stem(handle.name), kind, dirty: false } })
      s.toast('success', `Saved ${handle.name}`)
      return
    }
  } catch (e) { if ((e as Error).name === 'AbortError') return; s.toast('error', `Could not save: ${errText(e)}`); return }
  download(`${name}.${k.ext}`, bytes as unknown as BlobPart, k.mime)
  if (kind === 'pptx') useStore.setState({ file: { ...s.file, kind, dirty: false } })
  s.toast('success', `Downloaded ${name}.${k.ext}`)
}

export async function exportAs(k: FileKind) { await save({ kind: k, saveAs: true }) }
export function printDeck() { void import('./print').then((m) => m.printDeck()) }
export { download }
