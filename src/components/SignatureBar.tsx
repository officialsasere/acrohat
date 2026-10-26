import { useStore } from '../store'

/** Shows what is known about digital signatures in the file as it was opened. */
export function SignatureBar({ onDetails }: { onDetails: () => void }) {
  const doc = useStore((s) => s.active())
  const sigs = doc?.signatures
  if (!doc || !sigs?.length) return null
  const edited = doc.info.rev > 0
  const worst = sigs.some((s) => s.status === 'invalid' || s.status === 'modified') ? 'bad' : sigs.some((s) => s.status === 'unsupported' || !s.coversWholeFile || s.certificateExpired) ? 'warn' : 'valid'
  const who = sigs.map((s) => s.signer).join(', ')
  const text =
    worst === 'valid'
      ? `Signed by ${who}. The document has not been changed since it was signed.`
      : sigs.some((s) => s.status === 'modified' || s.status === 'invalid')
        ? `Signed by ${who}, but the document was changed after signing. The signature is not valid.`
        : sigs.some((s) => !s.coversWholeFile)
          ? `Signed by ${who}. Content was added after the signature.`
          : `Signed by ${who}. The signature could not be fully checked.`
  return (
    <div className={'sigbar ' + worst} role="status">
      <strong>{worst === 'valid' ? 'Signature valid' : worst === 'bad' ? 'Signature invalid' : 'Signature needs attention'}</strong>
      <span>{text}</span>
      {edited && <span>You have edited this file; saving it will remove the signature's validity.</span>}
      <span className="spacer" />
      <button onClick={onDetails}>Details</button>
    </div>
  )
}
