import { isTauri } from '../../../src/lib/platform'
import { readDocx } from '../formats/docxRead'
import { writeDocx } from '../formats/docxWrite'
import { fromMarkdown, fromText, toMarkdown, toText } from '../formats/markdown'
import { DEFAULT_SETTINGS, type PMDoc, type WriteDocument } from '../formats/types'
import { printCss } from '../editor/pageStyle'
import { newId, useStore, type FileKind } from '../store'
import { deleteDraft, getDraft, putDraft } from './storage'

type Picker = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>
}

export const KINDS: Record<FileKind, { label: string; ext: string; mime: string }> = {
  docx: { label: 'Document (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  html: { label: 'Web page (.html)', ext: 'html', mime: 'text/html' },
  md: { label: 'Markdown (.md)', ext: 'md', mime: 'text/markdown' },
  txt: { label: 'Plain text (.txt)', ext: 'txt', mime: 'text/plain' },
}
const OPENABLE = ['docx', 'html', 'htm', 'md', 'markdown', 'txt']
const baseName = (p: string) => p.split(/[\\/]/).pop() || p
const stem = (n: string) => n.replace(/\.[^.]+$/, '')
export const kindOf = (name: string): FileKind | null => {
  const e = name.split('.').pop()?.toLowerCase()
  return e === 'docx' ? 'docx' : e === 'html' || e === 'htm' ? 'html' : e === 'md' || e === 'markdown' ? 'md' : e === 'txt' ? 'txt' : null
}

export function currentDocument(): WriteDocument {
  const s = useStore.getState()
  return { title: s.doc.title, doc: s.editor!.getJSON() as PMDoc, settings: s.settings }
}

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

/** Puts a document on the page (replacing what was there) and shows the editor. */
export function loadDocument(wd: WriteDocument | { html: string; title: string }, meta: { fileName?: string | null; kind?: FileKind | null; handle?: FileSystemFileHandle; path?: string; id?: string } = {}) {
  const s = useStore.getState()
  const ed = s.editor
  if (!ed) return
  const settings = 'settings' in wd ? wd.settings : { ...DEFAULT_SETTINGS }
  useStore.setState({
    settings,
    screen: 'edit',
    dialog: null,
    find: { open: false, replace: false },
    doc: { id: meta.id ?? newId(), title: wd.title, fileName: meta.fileName ?? null, kind: meta.kind ?? null, handle: meta.handle, path: meta.path, dirty: false },
  })
  // Same size and margins first, so the page is laid out right the moment the text arrives.
  ed.chain().setContent('html' in wd ? wd.html : wd.doc, { emitUpdate: false }).setMeta('addToHistory', false).run()
  ed.commands.setTextSelection(1)
  ed.commands.focus('start')
  useStore.setState((st) => ({ stats: { ...st.stats, words: ed.storage.characterCount.words(), chars: ed.storage.characterCount.characters() } }))
}

export function newDocument(doc?: PMDoc, title = 'Untitled document') {
  loadDocument({ title, doc: doc ?? { type: 'doc', content: [{ type: 'paragraph' }] }, settings: { ...DEFAULT_SETTINGS } })
  useStore.setState((s) => ({ doc: { ...s.doc, dirty: false } }))
}

export async function openBytes(name: string, bytes: Uint8Array, handle?: FileSystemFileHandle, path?: string) {
  const kind = kindOf(name)
  const { toast } = useStore.getState()
  try {
    if (kind === 'docx') loadDocument(readDocx(bytes, name), { fileName: name, kind, handle, path })
    else if (kind === 'html') {
      const html = new TextDecoder().decode(bytes)
      const doc = new DOMParser().parseFromString(html, 'text/html')
      loadDocument({ html: doc.body.innerHTML, title: doc.title || stem(name) }, { fileName: name, kind, handle, path })
    } else if (kind === 'md') loadDocument({ title: stem(name), doc: fromMarkdown(new TextDecoder().decode(bytes)), settings: { ...DEFAULT_SETTINGS } }, { fileName: name, kind, handle, path })
    else if (kind === 'txt') loadDocument({ title: stem(name), doc: fromText(new TextDecoder().decode(bytes)), settings: { ...DEFAULT_SETTINGS } }, { fileName: name, kind, handle, path })
    else toast('error', `${name} is not a type of file Kwiiva Write can open. Try .docx, .html, .md or .txt.`)
  } catch (e) {
    toast('error', `Could not open ${name}: ${(e as Error).message}`)
  }
}

export async function openFile() {
  const w = window as Picker
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const path = await open({ multiple: false, filters: [{ name: 'Documents', extensions: OPENABLE }] })
    if (typeof path === 'string') await openBytes(baseName(path), await readFile(path), undefined, path)
    return
  }
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: 'Documents', accept: { 'application/*': ['.docx'], 'text/*': ['.html', '.htm', '.md', '.txt'] } }] })
      const f = await h.getFile()
      await openBytes(f.name, new Uint8Array(await f.arrayBuffer()), h)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') useStore.getState().toast('error', (e as Error).message)
    }
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = OPENABLE.map((e) => '.' + e).join(',')
  input.onchange = async () => { const f = input.files?.[0]; if (f) await openBytes(f.name, new Uint8Array(await f.arrayBuffer())) }
  input.click()
}

export async function openDraft(id: string) {
  const d = await getDraft(id)
  if (!d) return useStore.getState().toast('error', 'That document is no longer in this browser.')
  loadDocument({ title: d.title, doc: d.doc, settings: d.settings }, { id: d.id, fileName: d.fileName ?? null })
  useStore.setState((s) => ({ doc: { ...s.doc, dirty: false } }))
}
export const removeDraft = (id: string) => deleteDraft(id)

// ---- saving ----
export function htmlPage(wd: WriteDocument, bodyHtml: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(wd.title)}</title>\n<style>body{max-width:46rem;margin:2rem auto;padding:0 1rem;font:11pt/1.5 Calibri,Carlito,"Liberation Sans",Arial,sans-serif;color:#222}table{border-collapse:collapse}td,th{border:1px solid #888;padding:4px 8px}img{max-width:100%}pre{background:#f3f3f3;padding:8px}blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:1em;color:#555}</style></head>\n<body>\n${bodyHtml}\n</body></html>\n`
}

export function encode(kind: FileKind): Uint8Array {
  const wd = currentDocument()
  switch (kind) {
    case 'docx': return writeDocx(wd)
    case 'html': return new TextEncoder().encode(htmlPage(wd, useStore.getState().editor!.getHTML()))
    case 'md': return new TextEncoder().encode(toMarkdown(wd.doc))
    case 'txt': return new TextEncoder().encode(toText(wd.doc))
  }
}

function download(name: string, bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Saves the document. `saveAs` (or a document with no file yet) asks where to put it. */
export async function save(opts: { saveAs?: boolean; kind?: FileKind } = {}) {
  const s = useStore.getState()
  if (!s.editor) return
  const kind: FileKind = opts.kind ?? s.doc.kind ?? 'docx'
  const name = (s.doc.fileName && !opts.kind ? s.doc.fileName : `${s.doc.title.replace(/[\\/:*?"<>|]+/g, '') || 'Document'}.${KINDS[kind].ext}`).replace(/\.[^.]+$/, '') + '.' + KINDS[kind].ext
  const bytes = encode(kind)
  const w = window as Picker
  const done = (fileName: string, extra: Partial<{ handle: FileSystemFileHandle; path: string }> = {}) => {
    useStore.setState((st) => ({ doc: { ...st.doc, fileName, kind, dirty: false, handle: extra.handle, path: extra.path } }))
    s.toast('success', `Saved ${fileName}`)
  }
  try {
    if (isTauri) {
      const { save: dlg } = await import('@tauri-apps/plugin-dialog')
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      let path = !opts.saveAs && !opts.kind && s.doc.kind === kind ? s.doc.path : undefined
      path ??= (await dlg({ defaultPath: name, filters: [{ name: KINDS[kind].label, extensions: [KINDS[kind].ext] }] })) ?? undefined
      if (!path) return
      await writeFile(path, bytes)
      return done(baseName(path), { path })
    }
    let handle = !opts.saveAs && !opts.kind && s.doc.kind === kind ? s.doc.handle : undefined
    if (!handle && w.showSaveFilePicker) handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: KINDS[kind].label, accept: { [KINDS[kind].mime]: ['.' + KINDS[kind].ext] } }] })
    if (handle) {
      const stream = await handle.createWritable()
      await stream.write(bytes as BlobPart)
      await stream.close()
      return done(handle.name, { handle })
    }
    download(name, bytes, KINDS[kind].mime)
    done(name)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') s.toast('error', `Could not save: ${(e as Error).message}`)
  }
}

/** Makes a PDF through the system print dialog ("Save as PDF"), with the page size and margins of this document. */
export function printDoc() {
  const s = useStore.getState()
  let style = document.getElementById('kw-print') as HTMLStyleElement | null
  if (!style) { style = document.createElement('style'); style.id = 'kw-print'; document.head.append(style) }
  style.textContent = printCss(s.settings)
  document.title = s.doc.title
  window.print()
}

export { putDraft, wordCount }
