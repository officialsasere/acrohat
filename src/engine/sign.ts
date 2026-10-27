import { Buffer } from 'buffer'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import { P12Signer } from '@signpdf/signer-p12'
import { SignPdf } from '@signpdf/signpdf'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'

// signpdf and node-forge expect Node's Buffer.
;(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer

/** Certificate-based (PKCS#7 / CMS detached) digital signatures. */

export class CertificateError extends Error {}

export interface CertificateInfo {
  commonName: string
  issuer: string
  validFrom: Date
  validTo: Date
  selfSigned: boolean
}

function loadP12(p12: Uint8Array, password: string) {
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(p12).toString('binary')))
    const parsed = forge.pkcs12.pkcs12FromAsn1(asn1, password)
    const bags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []
    const cert = bags[0]?.cert
    if (!cert) throw new CertificateError('The file contains no certificate')
    return cert
  } catch (e) {
    if (e instanceof CertificateError) throw e
    const msg = (e as Error).message ?? ''
    if (/mac|password|pkcs12/i.test(msg)) throw new CertificateError('Wrong password, or this is not a .p12/.pfx certificate file')
    throw new CertificateError(`Cannot read the certificate: ${msg}`)
  }
}

export function inspectCertificate(p12: Uint8Array, password: string): CertificateInfo {
  const cert = loadP12(p12, password)
  const cn = (a: forge.pki.Certificate['subject']) => String(a.getField('CN')?.value ?? a.getField('O')?.value ?? 'Unknown')
  return {
    commonName: cn(cert.subject),
    issuer: cn(cert.issuer),
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    selfSigned: cert.subject.hash === cert.issuer.hash,
  }
}

export interface SignOptions {
  reason?: string
  location?: string
  contact?: string
  /** Signature field rectangle in PDF user space [x1, y1, x2, y2]; omit for an invisible signature. */
  rect?: [number, number, number, number]
  pageIndex?: number
}

/** Signs a PDF. Returns new bytes; any later rewrite of the file (e.g. a plain re-save) would invalidate the signature. */
export async function signWithCertificate(bytes: Uint8Array, p12: Uint8Array, password: string, opts: SignOptions = {}): Promise<Uint8Array> {
  const info = inspectCertificate(p12, password)
  if (info.validTo < new Date()) throw new CertificateError(`This certificate expired on ${info.validTo.toLocaleDateString()}`)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const page = doc.getPage(opts.pageIndex ?? 0)
  pdflibAddPlaceholder({
    pdfDoc: doc,
    pdfPage: page,
    reason: opts.reason || 'I approve this document',
    contactInfo: opts.contact || '',
    name: info.commonName,
    location: opts.location || '',
    signingTime: new Date(),
    widgetRect: opts.rect ?? [0, 0, 0, 0],
    appName: 'Kwiiva Paper',
    signatureLength: 16384,
  })
  // signpdf needs a classic cross-reference table, not object streams.
  const prepared = Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }))
  const signer = new P12Signer(Buffer.from(p12), { passphrase: password })
  const signed = await new SignPdf().sign(prepared, signer)
  return new Uint8Array(signed)
}
