import { fileToImage } from './extensions'
import { speechToggle } from '../lib/speech'
import { KINDS, newDocument, openFile, printDoc, save } from '../lib/files'
import { useStore } from '../store'

export const ed = () => useStore.getState().editor!
export const dialog = (d: NonNullable<ReturnType<typeof useStore.getState>['dialog']>) => useStore.setState({ dialog: d })

export function pickImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = async () => {
    for (const f of [...(input.files ?? [])]) {
      const i = await fileToImage(f)
      if (i) ed().chain().focus().setImage(i).run()
      else useStore.getState().toast('error', `${f.name} is not a picture Kwiiva Write can use.`)
    }
  }
  input.click()
}

export const toggleFind = (replace = false) => useStore.setState((s) => ({ find: { open: replace || !s.find.open || s.find.replace !== replace ? true : false, replace } }))

export function toggleTheme() {
  const s = useStore.getState()
  const next = s.theme === 'system' ? 'light' : s.theme === 'light' ? 'dark' : 'system'
  try { localStorage.setItem('kwiiva-write.theme', next) } catch { /* private mode */ }
  useStore.setState({ theme: next })
}

export function insertDate() {
  ed().chain().focus().insertContent(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })).run()
}

/** Puts "Page n" in the centre of the footer, the usual first thing people want. */
export function addPageNumbers(pos: 'left' | 'center' | 'right' = 'center') {
  const s = useStore.getState()
  useStore.getState().patchSettings({ footer: { ...s.settings.footer, [pos]: '{page}' } })
  ed().commands.refreshLayout()
}

export function newBlank() {
  const s = useStore.getState()
  if (s.doc.dirty && s.screen === 'edit' && !window.confirm('This document has changes that are not saved to a file. They are kept in Recent. Start a new one?')) return
  newDocument()
}

export function goHome() { useStore.setState({ screen: 'home' }) }

export { KINDS, openFile, printDoc, save, speechToggle }
