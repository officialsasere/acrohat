import type { PMDoc, PageSettings } from '../formats/types'

/** Drafts are saved in this browser (IndexedDB) as you type, so closing a tab never loses work. Nothing leaves the device. */
export interface Draft {
  id: string
  title: string
  doc: PMDoc
  settings: PageSettings
  updatedAt: number
  /** Where it was last saved on disk, if anywhere, for the "Recent" list. */
  fileName?: string
  words: number
}

const DB = 'kwiiva-write'
const STORE = 'drafts'

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open()
  return new Promise((res, rej) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export const putDraft = (d: Draft) => tx('readwrite', (s) => s.put(d)).catch(() => undefined)
export const getDraft = (id: string) => tx<Draft | undefined>('readonly', (s) => s.get(id)).catch(() => undefined)
export const deleteDraft = (id: string) => tx('readwrite', (s) => s.delete(id)).catch(() => undefined)
export async function listDrafts(limit = 24): Promise<Draft[]> {
  try {
    const all = await tx<Draft[]>('readonly', (s) => s.getAll())
    return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  } catch {
    return []
  }
}
