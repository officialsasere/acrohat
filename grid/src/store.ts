import { create } from 'zustand'
import { Book } from './engine/book'
import { newWorkbook, type Cell } from './engine/model'
import type { Rect } from './engine/types'
import { single, type Sel } from './selection'

export type Dialog =
  | 'format' | 'cf' | 'validation' | 'sort' | 'find' | 'names' | 'chart' | 'function' | 'pasteSpecial' | 'link' | 'note' | 'pivot'
  | 'pageSetup' | 'protect' | 'dedupe' | 'textToColumns' | 'shortcuts' | 'privacy' | 'about' | 'insertCells' | 'rowCol' | 'goto' | 'stats' | 'picture' | 'sheetColor' | 'dataClean' | null

export type FileKind = 'xlsx' | 'csv' | 'tsv' | 'json' | 'html'

export interface Edit {
  sheet: number
  r: number
  c: number
  text: string
  /** Where the caret was when editing started in the formula bar or the cell. */
  origin: 'cell' | 'bar'
  /** Typing replaces the cell; "edit" mode (F2 or double-click) lets the arrow keys move the caret. */
  mode: 'type' | 'edit'
  /** Caret position inside the text, so clicking a cell can insert a reference there. */
  caret: number
  /** Set while a reference is being pointed at with the mouse or arrow keys. */
  point?: { from: number; to: number }
}

export interface Clip {
  sheet: number
  rect: Rect
  block: (Cell | undefined)[][]
  cut: boolean
  text: string
}

export interface FileMeta {
  name: string
  kind: FileKind | null
  handle?: FileSystemFileHandle
  path?: string
  dirty: boolean
}

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }
export interface Menu { x: number; y: number; items: MenuItem[] }
export type MenuItem = { label: string; run?: () => void; key?: string; checked?: boolean; disabled?: boolean; danger?: boolean } | 'sep'

interface State {
  book: Book
  screen: 'home' | 'edit'
  file: FileMeta
  sel: Sel
  selBySheet: Record<number, Sel>
  edit: Edit | null
  clip: Clip | null
  zoom: number
  theme: 'system' | 'light' | 'dark'
  headings: boolean
  formulaBar: boolean
  dialog: Dialog
  dialogArg?: unknown
  menu: Menu | null
  menuOpen: boolean
  toasts: Toast[]
  painter: { block: (Cell | undefined)[][] } | null
  /** Touch: when on, dragging extends the selection instead of scrolling. */
  selectMode: boolean
  findText: string
  /** Selected chart or picture id. */
  object: string | null
  tick: number
  /** Name of this document's autosaved copy in the browser. */
  draftId: string
  set: (p: Partial<State>) => void
  toast: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
  setBook: (b: Book, file?: Partial<FileMeta>) => void
  select: (s: Sel) => void
  bump: () => void
}

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
let toastId = 1

export const useStore = create<State>((set, get) => ({
  book: new Book(newWorkbook()),
  screen: 'home',
  file: { name: 'Untitled spreadsheet', kind: null, dirty: false },
  sel: single(0, 0),
  selBySheet: {},
  edit: null,
  clip: null,
  zoom: phone ? 0.9 : 1,
  theme: (read('kwiiva-grid.theme') as State['theme']) || 'system',
  headings: true,
  formulaBar: true,
  dialog: null,
  menu: null,
  menuOpen: false,
  toasts: [],
  painter: null,
  selectMode: false,
  findText: '',
  object: null,
  tick: 0,
  draftId: crypto.randomUUID(),
  set: (p) => set(p),
  toast: (kind, text) => {
    const id = toastId++
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setBook: (b, file) => set({ draftId: crypto.randomUUID(), book: b, sel: single(0, 0), selBySheet: {}, edit: null, clip: null, screen: 'edit', dialog: null, object: null, painter: null, file: { name: b.wb.title, kind: null, dirty: false, ...file } }),
  select: (s) => set((st) => ({ sel: s, selBySheet: { ...st.selBySheet, [st.book.wb.active]: s } })),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}))

export const getBook = () => useStore.getState().book
export const activeSheet = () => useStore.getState().book.activeSheet
