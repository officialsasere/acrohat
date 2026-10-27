import { useStore } from '../store'

/** Reads the selection (or the whole document) aloud with the device's own voices; nothing is sent anywhere. */
export function speechToggle() {
  const synth = window.speechSynthesis
  if (!synth) return useStore.getState().toast('error', 'This device has no speech voices.')
  if (synth.speaking) return synth.cancel()
  const ed = useStore.getState().editor!
  const { from, to, empty } = ed.state.selection
  const text = empty ? ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n') : ed.state.doc.textBetween(from, to, '\n')
  if (!text.trim()) return
  synth.speak(new SpeechSynthesisUtterance(text))
}
