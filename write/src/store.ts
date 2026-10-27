import type { Editor } from '@tiptap/core'
import { create } from 'zustand'
import { DEFAULT_SETTINGS, type PageSettings } from './formats/types'
import type { Draft } from './lib/storage'

export type Dialog = 'pageSetup' | 'headerFooter' | 'link' | 'table' | 'symbols' | 'stats' | 'shortcuts' | 'privacy' | 'about' | 'spacing' | null
export type FileKind = 'docx' | 'html' | 'md' | 'txt'

export interface DocMeta {
  id: string
  title: string
  /** Name on disk, if it has been saved or opened from a file. */
  fileName: string | null
  kind: FileKind | null
  handle?: FileSystemFileHandle
  path?: string
  dirty: boolean
}

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

interface State {
  editor: Editor | null
  screen: 'home' | 'edit'
  doc: DocMeta
  settings: PageSettings
  view: 'print' | 'web'
  zoom: number
  outline: boolean
  menuOpen: boolean
  find: { open: boolean; replace: boolean }
  dialog: Dialog
  theme: 'system' | 'light' | 'dark'
  toasts: Toast[]
  recents: Draft[]
  stats: { words: number; chars: number; page: number; pages: number }
  /** Bumped when the editor's selection changes, so toolbars redraw their active states. */
  tick: number
  set: (p: Partial<State>) => void
  toast: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
  patchSettings: (p: Partial<PageSettings>) => void
}

const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
export const newId = () => crypto.randomUUID()

let toastId = 1
export const useStore = create<State>((set, get) => ({
  editor: null,
  screen: 'home',
  doc: { id: newId(), title: 'Untitled document', fileName: null, kind: null, dirty: false },
  settings: DEFAULT_SETTINGS,
  view: phone ? 'web' : 'print',
  zoom: 1,
  outline: !phone,
  menuOpen: false,
  find: { open: false, replace: false },
  dialog: null,
  theme: (read('kwiiva-write.theme') as State['theme']) || 'system',
  toasts: [],
  recents: [],
  stats: { words: 0, chars: 0, page: 1, pages: 1 },
  tick: 0,
  set: (p) => set(p),
  toast: (kind, text) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p }, doc: { ...s.doc, dirty: true } })),
}))
