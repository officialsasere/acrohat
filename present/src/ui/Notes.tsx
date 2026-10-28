import { useStore, curSlide } from '../store'
import { updateSlide } from '../actions'

/** Speaker notes for the current slide: plain text that shows in the presenter view. */
export function Notes() {
  const slide = useStore((s) => curSlide(s))
  return (
    <div className="notes-pane">
      <textarea aria-label="Speaker notes" placeholder="Click to add speaker notes" value={slide.notes} onChange={(e) => updateSlide(slide.id, { notes: e.target.value }, 'Notes', 'notes' + slide.id)} />
    </div>
  )
}
