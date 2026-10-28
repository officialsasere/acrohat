import { errText, nativeRead, nativeWrite } from '../../../shared/native'
import { handleWritable, makeAutosaver } from '../../../shared/autosave'
import { isTauri } from '../../../src/lib/platform'
import type { Book } from '../engine/book'
import { readCsv, writeCsv, writeHtml, writeJson } from '../formats/csv'
import { readXlsx } from '../formats/xlsxRead'
import { writeXlsx } from '../formats/xlsxWrite'
import { useStore, type FileKind } from '../store'
import { Book as BookClass } from '../engine/book'
import { newWorkbook } from '../engine/model'
import { TEMPLATES } from '../templates'

type Picker = Window & { showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>; showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }

export const KINDS: Record<FileKind, { label: string; ext: string; mime: string }> = {
  xlsx: { label: 'Spreadsheet (.xlsx)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  csv: { label: 'Comma-separated values (.csv)', ext: 'csv', mime: 'text/csv' },
  tsv: { label: 'Tab-separated values (.tsv)', ext: 'tsv', mime: 'text/tab-separated-values' },
  html: { label: 'Web page (.html)', ext: 'html', mime: 'text/html' },
  json: { label: 'JSON (.json)', ext: 'json', mime: 'application/json' },
}
const OPENABLE = ['xlsx', 'csv', 'tsv', 'txt']
const baseName = (p: string) => p.split(/[\\/]/).pop() || p
const stem = (n: string) => n.replace(/\.[^.]+$/, '')
export const kindOf = (name: string): FileKind | null => { const e = name.split('.').pop()?.toLowerCase(); return e === 'xlsx' ? 'xlsx' : e === 'csv' ? 'csv' : e === 'tsv' || e === 'txt' ? 'tsv' : null }

export function newBook(templateId = 'blank') {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0]
  const b = t.build()
  useStore.getState().setBook(b, { name: t.id === 'blank' ? 'Untitled spreadsheet' : t.name, kind: null, dirty: false })
  useStore.setState({ file: { name: b.wb.title, kind: null, dirty: false } })
}

/** A file's type from its name, or from its first bytes when the name does not say (a zip is a spreadsheet). */
const sniff = (name: string, bytes: Uint8Array): FileKind | null => kindOf(name) ?? (bytes[0] === 0x50 && bytes[1] === 0x4b ? 'xlsx' : !name.includes('.') && !bytes.slice(0, 512).includes(0) ? 'csv' : null)

export function openBytes(name: string, bytes: Uint8Array, handle?: FileSystemFileHandle, path?: string) {
  const kind = sniff(name, bytes)
  const s = useStore.getState()
  try {
    let book: Book
    if (kind === 'xlsx') book = readXlsx(bytes, name)
    else if (kind === 'csv' || kind === 'tsv') book = readCsv(new TextDecoder().decode(bytes), name, kind === 'tsv' ? '\t' : undefined)
    else return s.toast('error', `${name} is not a type of file Kwiiva Grid can open. Try .xlsx, .csv or .tsv.`)
    s.setBook(book, { name: stem(name), kind: kind === 'xlsx' ? 'xlsx' : kind, handle, path, dirty: false })
  } catch (e) {
    s.toast('error', `Could not open ${name}: ${(e as Error).message}`)
  }
}

export async function openFile() {
  const w = window as Picker
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ multiple: false, filters: [{ name: 'Spreadsheets', extensions: OPENABLE }] })
    if (typeof path === 'string') openBytes(baseName(path), await nativeRead(path), undefined, path)
    return
  }
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: [{ description: 'Spreadsheets', accept: { 'application/*': ['.xlsx'], 'text/*': ['.csv', '.tsv', '.txt'] } }] })
      const f = await h.getFile()
      openBytes(f.name, new Uint8Array(await f.arrayBuffer()), h)
    } catch (e) { if ((e as Error).name !== 'AbortError') useStore.getState().toast('error', (e as Error).message) }
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = OPENABLE.map((e) => '.' + e).join(',')
  input.onchange = async () => { const f = input.files?.[0]; if (f) openBytes(f.name, new Uint8Array(await f.arrayBuffer())) }
  input.click()
}

export function encode(book: Book, kind: FileKind): Uint8Array {
  switch (kind) {
    case 'xlsx': return writeXlsx(book)
    case 'csv': return new TextEncoder().encode('﻿' + writeCsv(book, ','))
    case 'tsv': return new TextEncoder().encode(writeCsv(book, '\t'))
    case 'html': return new TextEncoder().encode(writeHtml(book))
    case 'json': return new TextEncoder().encode(writeJson(book))
  }
}

function download(name: string, bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Saves the spreadsheet. A copy in another format never replaces the file you are working on. */
export async function save(o: { saveAs?: boolean; kind?: FileKind; silent?: boolean } = {}) {
  const s = useStore.getState(), book = s.book
  // Automatic saving only updates the file this spreadsheet already has; it never asks where to put one.
  if (o.silent && (!s.file.dirty || o.kind || o.saveAs || !(s.file.path || s.file.handle) || (s.file.handle && !(await handleWritable(s.file.handle))))) return
  const kind: FileKind = o.kind ?? (s.file.kind === 'xlsx' || !s.file.kind ? 'xlsx' : 'xlsx')
  const asCopy = !!o.kind && o.kind !== 'xlsx'
  const name = `${(s.file.name || 'Spreadsheet').replace(/[\\/:*?"<>|]+/g, '')}.${KINDS[kind].ext}`
  const bytes = encode(book, kind)
  const w = window as Picker
  const version = book.version
  const done = (fileName: string, extra: { handle?: FileSystemFileHandle; path?: string } = {}) => {
    if (!asCopy) useStore.setState({ file: { ...useStore.getState().file, name: stem(fileName), kind: 'xlsx', dirty: !!o.silent && useStore.getState().book.version !== version, ...extra } })
    if (!o.silent) s.toast('success', `Saved ${fileName}`)
  }
  try {
    if (isTauri) {
      const { save: dlg } = await import('@tauri-apps/plugin-dialog')
      let path = !o.saveAs && !asCopy ? s.file.path : undefined
      path ??= (await dlg({ defaultPath: name, filters: [{ name: KINDS[kind].label, extensions: [KINDS[kind].ext] }] })) ?? undefined
      if (!path) return
      await nativeWrite(path, bytes)
      return done(baseName(path), { path })
    }
    let handle = !o.saveAs && !asCopy ? s.file.handle : undefined
    if (!handle && w.showSaveFilePicker) handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: KINDS[kind].label, accept: { [KINDS[kind].mime]: ['.' + KINDS[kind].ext] } }] })
    if (handle) { const st = await handle.createWritable(); await st.write(bytes as BlobPart); await st.close(); return done(handle.name, { handle }) }
    download(name, bytes, KINDS[kind].mime)
    done(name)
  } catch (e) { if ((e as Error).name !== 'AbortError') s.toast('error', o.silent ? `Automatic save failed: ${errText(e)}` : `Could not save: ${errText(e)}`) }
}

/** Prints the active sheet's data through the system print dialog ("Save as PDF" there makes a PDF). */
export function printSheet(opts: { landscape?: boolean; gridlines?: boolean; scale?: number } = {}) {
  const book = useStore.getState().book
  const html = writeHtml(book).replace('</style>', `${opts.gridlines === false ? 'td{border:0!important}' : ''}@page{size:${opts.landscape ? 'landscape' : 'portrait'};margin:12mm}body{zoom:${opts.scale ?? 1}}</style>`)
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = html
  frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 5000) }
  document.body.append(frame)
}

// ------------------------------------------------------------------ drafts
const DB = 'kwiiva-grid', STORE = 'drafts'
export interface Draft { id: string; title: string; bytes: Uint8Array; updatedAt: number; cells: number }
const open = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => { const db = await open(); return new Promise((res, rej) => { const r = fn(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) }) }
export const putDraft = (d: Draft) => tx('readwrite', (s) => s.put(d)).catch(() => undefined)
export const getDraft = (id: string) => tx<Draft | undefined>('readonly', (s) => s.get(id)).catch(() => undefined)
export const deleteDraft = (id: string) => tx('readwrite', (s) => s.delete(id)).catch(() => undefined)
export async function listDrafts(limit = 24): Promise<Draft[]> { try { return (await tx<Draft[]>('readonly', (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit) } catch { return [] } }
export function openDraft(d: Draft) {
  try { const b = readXlsx(d.bytes, d.title); useStore.getState().setBook(b, { name: d.title, kind: null, dirty: false }); useStore.setState({ draftId: d.id }) }
  catch (e) { useStore.getState().toast('error', `Could not open the saved copy: ${(e as Error).message}`) }
}
export { BookClass, newWorkbook }

export const autosaver = makeAutosaver(() => save({ silent: true }))
