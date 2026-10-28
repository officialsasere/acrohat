import { applyStyle, borders, currency, percent, toggle } from './actions/format'
import { canWrite, clearSelection, startEdit } from './actions/edit'
import { fillDown, fillRight, toggleFilter } from './actions/data'
import { copy } from './actions/clipboard'
import { move } from './actions/nav'
import { useStore } from './store'

const st = () => useStore.getState()

/** Sum of the numbers above or to the left, put into the active cell: Alt+= . */
export function autoSum() {
  const s = st(), book = s.book, sh = book.activeSheet
  const { r, c } = s.sel
  const isNum = (rr: number, cc: number) => rr >= 0 && cc >= 0 && typeof book.value(sh.id, rr, cc) === 'number'
  let top = r
  while (isNum(top - 1, c)) top--
  let formula: string
  if (top < r) formula = `=SUM(${colLetter(c)}${top + 1}:${colLetter(c)}${r})`
  else {
    let left = c
    while (isNum(r, left - 1)) left--
    if (left === c) formula = '=SUM()'
    else formula = `=SUM(${colLetter(left)}${r + 1}:${colLetter(c - 1)}${r + 1})`
  }
  startEdit({ text: formula, mode: 'edit', caret: formula.length - 1 })
}
const colLetter = (c: number) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

/** Shortcuts that work whenever the grid has focus. Returns true if the key was used. */
export function runGlobalShortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  const s = st()
  if (e.altKey && e.key === '=') { autoSum(); return true }
  if (!mod) return false
  switch (k) {
    case 'z': if (e.shiftKey) s.book.redo(); else s.book.undo(); s.bump(); return true
    case 'y': s.book.redo(); s.bump(); return true
    case 'b': toggle('bold'); return true
    case 'i': toggle('italic'); return true
    case 'u': toggle('underline'); return true
    case '5': toggle('strike'); return true
    case 'd': fillDown(); return true
    case 'r': fillRight(); return true
    case 'f': useStore.setState({ dialog: 'find' }); return true
    case 'h': useStore.setState({ dialog: 'find' }); return true
    case 'k': useStore.setState({ dialog: 'link' }); return true
    case '1': useStore.setState({ dialog: 'format' }); return true
    case 'l': if (e.shiftKey) { toggleFilter(); return true } return false
    case ';': {
      const sel = s.sel, d = new Date()
      if (!canWrite([{ r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c }])) return true
      s.book.setInput(s.book.activeSheet.id, sel.r, sel.c, e.shiftKey ? d.toLocaleTimeString('en-US', { hour12: false }) : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`)
      return true
    }
    case ':': return false
    case '4': if (e.shiftKey) { currency(); return true } return false
    case '5 ': return false
    case '%': percent(); return true
    case '_': borders('none'); return true
    case '&': borders('outer'); return true
    case '-': if (e.shiftKey) return false; useStore.setState({ dialog: 'insertCells', dialogArg: 'delete' }); return true
    case '+': case '=': if (e.shiftKey || k === '+') { useStore.setState({ dialog: 'insertCells', dialogArg: 'insert' }); return true } return false
    case 'g': useStore.setState({ dialog: 'goto' }); return true
    case 'home': return false
  }
  void applyStyle; void clearSelection; void copy; void move; void fillDown
  return false
}
