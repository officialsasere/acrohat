import { useStore } from '../store'

/** Start the slide show on slide `from` (0-based). */
export function startShow(from = 0, presenter = false) {
  useStore.setState({ presenting: { from, presenter }, editing: null })
}
