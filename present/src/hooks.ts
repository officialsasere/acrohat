import { useEffect } from 'react'
import { useStore } from './store'
import { addSlide, copySel, deleteSel, duplicateSel, group, pasteEls, selectAll, ungroup } from './actions'
import { insertImageFiles, newTextBox } from './insert'
import { addEl } from './actions'
import { openFile, save, printDeck, newDeck } from './lib/files'
import { startShow } from './show/start'
import { curIndex } from './store'
import { textOf, plainText } from './model'
import { startEdit } from './editor/textEdit'

const S = () => useStore.getState()
let pasteSeen = false
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || !!el.closest?.('.pm')) }

/** Shortcuts, copy and paste, and files dropped on the window. */
export function useGlobalInput() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = S()
      if (s.presenting || s.screen !== 'edit') return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (e.key === 'F5') { e.preventDefault(); startShow(e.shiftKey ? curIndex() : 0); return }
      if (!mod) return
      if (k === 's') { e.preventDefault(); void save({ saveAs: e.shiftKey }); return }
      if (k === 'o') { e.preventDefault(); void openFile(); return }
      if (k === 'p' && !typing(e.target)) { e.preventDefault(); printDeck(); return }
      if (k === 'n' && e.altKey) { e.preventDefault(); newDeck(); return }
      if (k === 'f' && !s.dialog) { e.preventDefault(); useStore.setState({ dialog: 'find' }); return }
      if (k === 'k') { e.preventDefault(); useStore.setState({ dialog: 'link' }); return }
      if (k === 'm') { e.preventDefault(); addSlide(); return }
      if (typing(e.target) && !(e.target as HTMLElement).closest('.pm')) return
      if (k === 'z' && !(e.target as HTMLElement).closest?.('.pm')) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return }
      if (k === 'y' && !(e.target as HTMLElement).closest?.('.pm')) { e.preventDefault(); s.redo(); return }
      if (typing(e.target)) return
      // Some browsers send no copy or paste event when the system clipboard is empty, so objects are also handled from the keys.
      if (k === 'c' && s.sel.length && !document.activeElement?.closest('.slide-panel')) copySel()
      else if (k === 'v' && s.clip?.length && !document.activeElement?.closest('.slide-panel')) { pasteSeen = false; setTimeout(() => { if (!pasteSeen) pasteEls() }, 120) }
      if (k === 'a') { e.preventDefault(); selectAll() }
      else if (k === 'd') { e.preventDefault(); duplicateSel() }
      else if (k === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group() }
      else if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); void import('./format').then((m) => (k === 'b' ? m.text.bold() : k === 'i' ? m.text.italic() : m.text.underline())) }
    }
    window.addEventListener('keydown', key)

    const copy = (e: ClipboardEvent, cut: boolean) => {
      const s = S()
      if (s.presenting || typing(e.target) || !s.sel.length || document.activeElement?.closest('.slide-panel')) return
      e.preventDefault()
      copySel()
      const t = s.deck.slides.find((x) => x.id === s.cur)?.els.filter((x) => s.sel.includes(x.id)).map((x) => (x.type === 'shape' ? textOf(x.text) : '')).filter(Boolean).join('\n')
      if (t) e.clipboardData?.setData('text/plain', t)
      if (cut) cutSel2()
    }
    const cutSel2 = () => deleteSel()
    const onCopy = (e: ClipboardEvent) => copy(e, false)
    const onCut = (e: ClipboardEvent) => copy(e, true)
    const onPaste = (e: ClipboardEvent) => {
      pasteSeen = true
      const s = S()
      if (s.presenting || typing(e.target) || s.screen !== 'edit' || document.activeElement?.closest('.slide-panel')) return
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length) { e.preventDefault(); void insertImageFiles(files); return }
      const t = e.clipboardData?.getData('text/plain')
      const internalText = (s.clip ?? []).filter((x) => x.type === 'shape').map((x) => textOf((x as import('./model').ShapeEl).text)).filter(Boolean).join('\n')
      if (s.clip?.length && (!t?.trim() || t.trim() === internalText.trim())) { e.preventDefault(); pasteEls(); return }
      if (t?.trim()) {
        e.preventDefault()
        const box = newTextBox(120, 120, 600, 80)
        box.text = plainText(t.replace(/\r\n?/g, '\n'))
        addEl(box)
        startEdit(box.id)
        useStore.setState({ editing: null })
      }
    }
    window.addEventListener('copy', onCopy); window.addEventListener('cut', onCut); window.addEventListener('paste', onPaste)

    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const drop = async (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      const deckFile = files.find((f) => /\.pptx$/i.test(f.name))
      if (deckFile) { const { openBytes } = await import('./lib/files'); openBytes(deckFile.name, new Uint8Array(await deckFile.arrayBuffer())); return }
      if (S().screen === 'edit') void insertImageFiles(files)
    }
    window.addEventListener('dragover', over); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('copy', onCopy); window.removeEventListener('cut', onCut); window.removeEventListener('paste', onPaste); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [])
}
