import { create } from 'zustand'
import { call, EngineError, type DocInfo } from './engine/client'
import type { FieldInfo } from './engine/protocol'
import type { SignatureReport } from './engine/verify'

export type Tool = 'select' | 'edit' | 'highlight' | 'underline' | 'strikeout' | 'pen' | 'rect' | 'ellipse' | 'note' | 'text' | 'sign' | 'redact' | 'crop' | 'field' | 'image'

export interface OpenDoc {
  id: string
  name: string
  info: DocInfo
  /** Saved bytes differ from what is on disk. */
  dirty: boolean
  /** Handle for saving back in place (File System Access API). */
  handle?: FileSystemFileHandle
  /** Path on disk (desktop app only). */
  path?: string
  /** Signatures found when the file was opened. */
  signatures?: SignatureReport[]
}

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

export type Hit = { page: number; rects: { x: number; y: number; w: number; h: number }[] }

interface State {
  docs: OpenDoc[]
  activeId: string | null
  tool: Tool
  zoom: number
  fitWidth: boolean
  page: number
  sidebar: boolean
  toolsPane: boolean
  color: string
  strokeWidth: number
  fontSize: number
  toasts: Toast[]
  search: { query: string; hits: Hit[]; index: number; open: boolean; matchCase: boolean }
  selectedPages: number[]
  pendingScroll: number | null
  theme: 'system' | 'light' | 'dark'
  signature: string | null
  fields: FieldInfo[]
  overflowPrompt: { extraLines: number; collidesWith: string; canPush: boolean; resolve: (choice: 'push' | 'overlap' | null) => void } | null
  askOverflow: (d: { extraLines: number; collidesWith: string; canPush: boolean }) => Promise<'push' | 'overlap' | null>
  fieldType: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list'
  sidebarTab: 'pages' | 'outline'

  active: () => OpenDoc | undefined
  setTool: (t: Tool) => void
  setZoom: (z: number) => void
  setFit: (f: boolean) => void
  setPage: (p: number) => void
  goToPage: (p: number) => void
  toggleSidebar: () => void
  toggleToolsPane: () => void
  set: (p: Partial<State>) => void
  toast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void

  openBytes: (name: string, bytes: Uint8Array, handle?: FileSystemFileHandle, path?: string) => Promise<void>
  activate: (id: string) => void
  closeDoc: (id: string) => Promise<void>
  update: (id: string, info: DocInfo, dirty?: boolean) => void
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  markSaved: (id: string, name?: string, handle?: FileSystemFileHandle, path?: string, unchangedSince?: DocInfo) => void
}

let toastId = 1
let docId = 1

export const useStore = create<State>((set, get) => ({
  docs: [],
  activeId: null,
  tool: 'select',
  zoom: 1.25,
  fitWidth: true,
  page: 0,
  toolsPane: typeof window !== 'undefined' && window.innerWidth >= 1180, // open on a laptop or bigger, a drawer on small screens
  sidebar: !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches), // a drawer on phones, so start closed
  color: '#ffd400',
  strokeWidth: 2,
  fontSize: 14,
  toasts: [],
  search: { query: '', hits: [], index: -1, open: false, matchCase: false },
  selectedPages: [],
  pendingScroll: null,
  theme: (localStorage.getItem('kwiiva-paper.theme') as State['theme']) || 'system',
  signature: localStorage.getItem('kwiiva-paper.signature'),
  fields: [],
  overflowPrompt: null,
  askOverflow: (d) => new Promise((resolve) => set({ overflowPrompt: { ...d, resolve: (c) => { set({ overflowPrompt: null }); resolve(c) } } })),
  fieldType: 'text',
  sidebarTab: 'pages',

  active: () => get().docs.find((d) => d.id === get().activeId),
  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom: Math.min(5, Math.max(0.25, zoom)), fitWidth: false }),
  setFit: (fitWidth) => set({ fitWidth }),
  setPage: (page) => set({ page }),
  goToPage: (p) => set({ pendingScroll: p, page: p }),
  toggleSidebar: () => set((s) => ({ sidebar: !s.sidebar })),
  toggleToolsPane: () => set((s) => ({ toolsPane: !s.toolsPane })),
  set: (p) => set(p),

  toast: (kind, text) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openBytes: async (name, bytes, handle, path) => {
    const id = `d${docId++}`
    try {
      let password: string | undefined
      for (;;) {
        try {
          const info = await call('open', { id, bytes: bytes.slice(), password })
          call('signatures', { id }).then((signatures) => {
            if (signatures.length) set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, signatures } : d)) }))
          }).catch(() => {})
          set((s) => ({
            docs: [...s.docs, { id, name, info, dirty: false, handle, path }],
            activeId: id,
            page: 0,
            selectedPages: [],
            search: { ...s.search, hits: [], index: -1 },
          }))
          return
        } catch (e) {
          if (e instanceof EngineError && /Password/i.test(e.message)) {
            const pw = window.prompt(password === undefined ? `"${name}" is password protected. Enter the password:` : 'Wrong password. Try again:')
            if (pw === null) return
            password = pw
          } else throw e
        }
      }
    } catch (e) {
      get().toast('error', `Could not open ${name}: ${(e as Error).message}`)
    }
  },

  activate: (id) => set({ activeId: id, page: 0, selectedPages: [], search: { ...get().search, hits: [], index: -1 } }),

  closeDoc: async (id) => {
    const d = get().docs.find((x) => x.id === id)
    if (!d) return
    if (d.dirty && !window.confirm(`"${d.name}" has unsaved changes. Close anyway?`)) return
    await call('close', { id })
    set((s) => {
      const docs = s.docs.filter((x) => x.id !== id)
      return { docs, activeId: s.activeId === id ? (docs[docs.length - 1]?.id ?? null) : s.activeId }
    })
  },

  update: (id, info, dirty = true) =>
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, info, dirty: d.dirty || dirty } : d)) })),

  markSaved: (id, name, handle, path, unchangedSince) =>
    set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, dirty: unchangedSince !== undefined && d.info !== unchangedSince, name: name ?? d.name, handle: handle ?? d.handle, path: path ?? d.path } : d)) })),

  run: async (fn) => {
    try {
      return await fn()
    } catch (e) {
      const err = e as Error
      if (err instanceof EngineError && err.kind === 'UnsupportedCharacters') get().toast('error', `${err.message}. These characters aren't in the bundled fonts, so the edit was not applied.`)
      else get().toast('error', err.message)
      return undefined
    }
  },
}))
