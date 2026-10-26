import { useStore } from '../store'
import { Modal } from './Dialogs'

/** Shown when an edit makes a paragraph taller and it would run into other content. */
export function OverflowDialog() {
  const p = useStore((s) => s.overflowPrompt)
  if (!p) return null
  return (
    <Modal title="This paragraph is now longer" onClose={() => p.resolve(null)}>
      <p>
        Your edit adds <strong>{p.extraLines} line{p.extraLines === 1 ? '' : 's'}</strong>, and the paragraph would run into {p.collidesWith}. PDFs don't re-flow the way a word processor does, so you decide what happens.
      </p>
      <div className="actions overflow-actions">
        <button className="primary" disabled={!p.canPush} onClick={() => p.resolve('push')} title={p.canPush ? undefined : 'There is not enough room on the page'}>
          Move the content below down
        </button>
        <button onClick={() => p.resolve('overlap')}>Let it overlap</button>
        <span className="spacer" />
        <button onClick={() => p.resolve(null)}>Cancel</button>
      </div>
      {!p.canPush && <p className="hint">There isn't enough room below to move the content down. Shorten the text, or choose to let it overlap.</p>}
    </Modal>
  )
}
