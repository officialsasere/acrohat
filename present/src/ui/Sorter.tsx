import { useRef, useState } from 'react'
import { useStore } from '../store'
import { addSlide, deleteSlides, duplicateSlides, gotoSlide, moveSlides } from '../actions'
import { Thumb } from '../render/Thumb'
import { slideTitle } from '../model'
import { openContextMenu } from '../menus'

/** All slides as a grid: drag to reorder, double-click to open one for editing. */
export function Sorter() {
  const deck = useStore((s) => s.deck)
  const cur = useStore((s) => s.cur)
  const [over, setOver] = useState<number | null>(null)
  const drag = useRef<string | null>(null)
  const close = () => useStore.setState((s) => ({ panels: { ...s.panels, sorter: false } }))
  return (
    <div className="sorter" tabIndex={0} aria-label="Slide sorter"
      onKeyDown={(e) => { if (e.key === 'Delete') deleteSlides(); else if (e.key === 'Enter') close(); else if (e.key === 'Escape') close() }}>
      <div className="sorter-grid">
        {deck.slides.map((s, i) => (
          <div key={s.id} className={'sorter-item' + (over === i ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(i) }} onDrop={(e) => { e.preventDefault(); if (drag.current) moveSlides([drag.current], i); drag.current = null; setOver(null) }}>
            <div role="option" aria-selected={s.id === cur} aria-label={`Slide ${i + 1}`} draggable className={'slide-thumb' + (s.id === cur ? ' cur' : '') + (s.hidden ? ' hidden-slide' : '')}
              onClick={() => gotoSlide(s.id)} onDoubleClick={() => { gotoSlide(s.id); close() }}
              onDragStart={() => { drag.current = s.id }} onDragEnd={() => setOver(null)}
              onContextMenu={(e) => { e.preventDefault(); gotoSlide(s.id); openContextMenu(e.clientX, e.clientY, 'slides') }}>
              <Thumb deck={deck} slide={s} width={232} index={i} />
            </div>
            <span><b>{i + 1}</b> {slideTitle(s)}</span>
          </div>
        ))}
        <div className="sorter-item add"><button type="button" onClick={() => addSlide(undefined, deck.slides.length)}>+ New slide</button></div>
      </div>
      <div className="sorter-bar"><span>{deck.slides.length} slides. Drag to reorder. Double-click to edit a slide.</span>
        <button type="button" onClick={() => duplicateSlides()}>Duplicate</button><button type="button" onClick={() => deleteSlides()}>Delete</button><button type="button" className="primary" onClick={close}>Back to editing</button></div>
    </div>
  )
}
