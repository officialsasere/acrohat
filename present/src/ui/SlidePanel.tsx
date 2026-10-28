import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { addSlide, deleteSlides, duplicateSlides, freshSlide, gotoSlide, insertSlides, moveSlides, toggleHidden, updateSlide } from '../actions'
import { Thumb } from '../render/Thumb'
import { Icon } from './ui'
import { openContextMenu } from '../menus'
import { slideTitle } from '../model'

export function SlidePanel() {
  const [phone, setPhone] = useState(() => window.matchMedia?.('(max-width: 820px)').matches ?? false)
  useEffect(() => { const m = window.matchMedia('(max-width: 820px)'); const f = () => setPhone(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  const width = phone ? 112 : 168
  const deck = useStore((s) => s.deck)
  const cur = useStore((s) => s.cur)
  const sel = useStore((s) => s.slideSel)
  const [over, setOver] = useState<number | null>(null)
  const dragIds = useRef<string[]>([])
  const last = useRef(0)

  const click = (e: React.MouseEvent, id: string, i: number) => {
    if (e.shiftKey) {
      const a = Math.min(last.current, i), b = Math.max(last.current, i)
      useStore.setState({ slideSel: deck.slides.slice(a, b + 1).map((s) => s.id) })
      useStore.setState({ cur: id, sel: [], editing: null })
      return
    }
    if (e.metaKey || e.ctrlKey) {
      const has = sel.includes(id)
      useStore.setState({ slideSel: has ? sel.filter((x) => x !== id) : [...sel, id] })
      return
    }
    last.current = i
    gotoSlide(id)
    useStore.setState({ slideSel: [id] })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const i = deck.slides.findIndex((s) => s.id === cur)
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) { const n = deck.slides[Math.min(deck.slides.length - 1, i + 1)]; useStore.setState({ slideSel: [...new Set([...sel, n.id])], cur: n.id }) } else gotoSlide(deck.slides[Math.min(deck.slides.length - 1, i + 1)].id) }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); gotoSlide(deck.slides[Math.max(0, i - 1)].id) }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSlides() }
    else if (e.key === 'Enter') { e.preventDefault(); addSlide() }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSlides() }
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); useStore.setState({ slideSel: deck.slides.map((s) => s.id) }) }
    else if (mod && (e.key.toLowerCase() === 'c' || e.key.toLowerCase() === 'x')) { e.preventDefault(); const ids = sel.length ? sel : [cur]; useStore.setState({ clipSlides: deck.slides.filter((s) => ids.includes(s.id)).map((s) => structuredClone(s)) }); if (e.key.toLowerCase() === 'x') deleteSlides(ids) }
    else if (mod && e.key.toLowerCase() === 'v') { const cl = useStore.getState().clipSlides; if (cl?.length) { e.preventDefault(); insertSlides(cl.map(freshSlide), i + 1) } }
  }
  const dropAt = (to: number) => { if (dragIds.current.length) moveSlides(dragIds.current, to); dragIds.current = []; setOver(null) }

  return (
    <div className="slide-panel" tabIndex={0} onKeyDown={onKey} aria-label="Slides" onContextMenu={(e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, 'slides') }}>
      <div className="slide-list" role="listbox" aria-label="Slide list">
        {deck.slides.map((s, i) => (
          <div key={s.id}>
            {s.section !== undefined && <div className="section-head"><input aria-label="Section name" value={s.section} placeholder="Untitled section" onChange={(e) => updateSlide(s.id, { section: e.target.value }, 'Section', 'section' + s.id)} /></div>}
            <div className={'slide-row' + (over === i ? ' over-before' : '') + (over === i + 1 && i === deck.slides.length - 1 ? ' over-after' : '')}
              onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setOver(e.clientY > r.top + r.height / 2 ? i + 1 : i) }}
              onDrop={(e) => { e.preventDefault(); dropAt(over ?? i) }}>
              <span className="num">{i + 1}</span>
              <div role="option" aria-selected={s.id === cur} aria-label={`Slide ${i + 1}: ${slideTitle(s) || 'empty'}`} data-slide={s.id} draggable
                className={'slide-thumb' + (s.id === cur ? ' cur' : '') + (sel.includes(s.id) ? ' sel' : '') + (s.hidden ? ' hidden-slide' : '')}
                onClick={(e) => click(e, s.id, i)}
                onDragStart={(e) => { dragIds.current = sel.includes(s.id) ? sel : [s.id]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id) }}
                onDragEnd={() => setOver(null)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!sel.includes(s.id)) { gotoSlide(s.id) } openContextMenu(e.clientX, e.clientY, 'slides') }}>
                <Thumb deck={deck} slide={s} width={width} index={i} />
                {s.hidden && <span className="badge" title="Hidden in the slide show"><Icon name="eye" size={12} /></span>}
                {s.trans && <span className="badge t" title="Has a transition"><Icon name="transition" size={12} /></span>}
              </div>
            </div>
          </div>
        ))}
        <div className={'slide-end' + (over === deck.slides.length ? ' over-before' : '')} onDragOver={(e) => { e.preventDefault(); setOver(deck.slides.length) }} onDrop={(e) => { e.preventDefault(); dropAt(deck.slides.length) }} />
      </div>
      <div className="slide-panel-foot">
        <button type="button" onClick={() => addSlide()} title="New slide (Ctrl+M)"><Icon name="plus" size={16} /> New slide</button>
        <button type="button" onClick={() => toggleHidden()} title="Hide or show this slide in the slide show" aria-label="Hide slide"><Icon name="eye" size={16} /></button>
      </div>
    </div>
  )
}
