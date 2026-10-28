import { call } from '../engine/client'
import { useStore } from '../store'
import { errText, nativeRead, nativeWrite } from '../../shared/native'
import { isTauri } from './platform'

type PickerWindow = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>
}

const PDF_TYPES = [{ description: 'PDF documents', accept: { 'application/pdf': ['.pdf'] } }]

function baseName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

async function openFilesTauri() {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { openBytes, toast } = useStore.getState()
  const picked = await open({ multiple: true, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })
  for (const path of picked ?? []) {
    try {
      await openBytes(baseName(path), await nativeRead(path, 'read_pdf'), undefined, path)
    } catch (e) {
      toast('error', `Could not read ${baseName(path)}: ${e}`)
    }
  }
}

/** Opens files the OS passed to the app (double-click, "Open with", command line). Desktop only. */
export async function openPending() {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  const { openBytes, toast } = useStore.getState()
  const paths = await invoke<string[]>('take_opened_files')
  for (const path of paths) {
    try {
      const bytes = new Uint8Array(await invoke<ArrayBuffer>('read_pdf', { path }))
      await openBytes(baseName(path), bytes, undefined, path)
    } catch (e) {
      toast('error', `Could not open ${baseName(path)}: ${e}`)
    }
  }
}

export async function openFiles() {
  if (isTauri) return openFilesTauri()
  const w = window as PickerWindow
  const { openBytes, toast } = useStore.getState()
  try {
    if (w.showOpenFilePicker) {
      const handles = await w.showOpenFilePicker({ types: PDF_TYPES, multiple: true })
      for (const h of handles) {
        const f = await h.getFile()
        await openBytes(f.name, new Uint8Array(await f.arrayBuffer()), h)
      }
      return
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    toast('error', (e as Error).message)
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/pdf,.pdf'
  input.multiple = true
  input.onchange = () => openFileList(input.files)
  input.click()
}

export async function openFileList(files: FileList | File[] | null) {
  if (!files) return
  const { openBytes, toast } = useStore.getState()
  for (const f of Array.from(files)) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      toast('error', `${f.name} is not a PDF`)
      continue
    }
    await openBytes(f.name, new Uint8Array(await f.arrayBuffer()))
  }
}

/** Hands a file to the user: a save dialog on desktop, a browser download on the web. */
export async function download(name: string, bytes: Uint8Array) {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const ext = name.split('.').pop() ?? ''
    const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined })
    if (path) await nativeWrite(path, bytes)
    return
  }
  const type = name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Saves the active document. `saveAs` always asks for a location. */
export async function saveActive(saveAs = false) {
  const s = useStore.getState()
  const doc = s.active()
  if (!doc) return
  const bytes = await s.run(() => call('save', { id: doc.id }))
  if (!bytes) return
  const w = window as PickerWindow
  try {
    if (isTauri) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      let path = saveAs ? undefined : doc.path
      path ??= (await save({ defaultPath: doc.name, filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })) ?? undefined
      if (!path) return
      await nativeWrite(path, bytes)
      s.markSaved(doc.id, baseName(path), undefined, path)
      s.toast('success', `Saved ${baseName(path)}`)
      return
    }
    let handle = saveAs ? undefined : doc.handle
    if (!handle && w.showSaveFilePicker) handle = await w.showSaveFilePicker({ suggestedName: doc.name, types: PDF_TYPES })
    if (handle) {
      const stream = await handle.createWritable()
      await stream.write(bytes as BlobPart)
      await stream.close()
      s.markSaved(doc.id, handle.name, handle)
      s.toast('success', `Saved ${handle.name}`)
      return
    }
    download(doc.name, bytes)
    s.markSaved(doc.id)
    s.toast('success', `Downloaded ${doc.name}`)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') s.toast('error', `Could not save: ${errText(e)}`)
  }
}

/** Prints every page of the active document. Pages are drawn as images into a print-only layer, which works in every browser and in the desktop webview. */
export async function printActive() {
  const s = useStore.getState()
  const doc = s.active()
  if (!doc) return
  s.toast('info', 'Preparing to print…')
  const root = document.createElement('div')
  root.className = 'print-root'
  try {
    for (let i = 0; i < doc.info.pageCount; i++) {
      const img = await call('render', { id: doc.id, page: i, scale: 2.5 })
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      cv.getContext('2d')!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0)
      const el = document.createElement('img')
      el.src = cv.toDataURL('image/jpeg', 0.92)
      el.className = img.width > img.height ? 'landscape' : 'portrait'
      root.appendChild(el)
    }
    document.body.appendChild(root)
    await Promise.all(Array.from(root.querySelectorAll('img')).map((i) => i.decode().catch(() => undefined)))
    window.print()
  } catch (e) {
    s.toast('error', `Could not print: ${(e as Error).message}`)
  } finally {
    setTimeout(() => root.remove(), 1000)
  }
}
