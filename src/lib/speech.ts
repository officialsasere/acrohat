import { call } from '../engine/client'
import { useStore } from '../store'

/** Reads the current page aloud with the system voices (nothing is sent anywhere). */
export async function toggleReadAloud() {
  const synth = window.speechSynthesis
  const st = useStore.getState()
  if (!synth) return st.toast('error', 'Reading aloud is not available on this system')
  if (synth.speaking) {
    synth.cancel()
    return
  }
  const doc = st.active()
  if (!doc) return
  const blocks = await st.run(() => call('blocks', { id: doc.id, page: st.page }))
  if (!blocks) return
  const text = [...blocks].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map((b) => b.text).join('\n')
  if (!text.trim()) return st.toast('info', 'This page has no text to read. If it is a scan, run text recognition first.')
  const u = new SpeechSynthesisUtterance(text)
  u.lang = navigator.language
  synth.speak(u)
}
