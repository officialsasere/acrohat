import { Buffer } from 'buffer'
import forge from 'node-forge'

/**
 * Validates the digital signatures inside a PDF: does the signed content still match, is the signature
 * mathematically valid, who signed, and was the file changed after signing?
 *
 * Verification uses the platform's WebCrypto (not node-forge's RSA verifier); forge is only used to parse.
 * We have no trusted-root store, so the signer's *identity* is reported as "not verified" unless the
 * certificate is self-signed (which is reported as such).
 */

export type SignatureStatus = 'valid' | 'modified' | 'invalid' | 'unsupported'

export interface SignatureReport {
  status: SignatureStatus
  signer: string
  issuer: string
  validFrom: string
  validTo: string
  certificateExpired: boolean
  selfSigned: boolean
  signedAt?: string
  reason?: string
  /** False if bytes were appended after the signature (e.g. a later edit or another signature). */
  coversWholeFile: boolean
  digestAlgorithm: string
  problem?: string
}

const HASH: Record<string, { forge: string; subtle: string }> = {
  [forge.pki.oids.sha1]: { forge: 'sha1', subtle: 'SHA-1' },
  [forge.pki.oids.sha256]: { forge: 'sha256', subtle: 'SHA-256' },
  [forge.pki.oids.sha384]: { forge: 'sha384', subtle: 'SHA-384' },
  [forge.pki.oids.sha512]: { forge: 'sha512', subtle: 'SHA-512' },
}

function cn(a: forge.pki.Certificate['subject']): string {
  return String(a.getField('CN')?.value ?? a.getField('O')?.value ?? 'Unknown')
}

function unreadable(problem: string, coversWholeFile = true): SignatureReport {
  return { status: 'unsupported', signer: 'Unknown', issuer: '', validFrom: '', validTo: '', certificateExpired: false, selfSigned: false, coversWholeFile, digestAlgorithm: '', problem }
}

export function countSignatures(bytes: Uint8Array): number {
  return findByteRanges(bytes).length
}

function findByteRanges(bytes: Uint8Array): number[][] {
  // Latin-1 decoding keeps byte offsets equal to string indices.
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
  const out: number[][] = []
  for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const r = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    // A real signature has its value directly in the gap; skip anything that doesn't look like one.
    if (r[0] === 0 && r[1] > 0 && r[2] > r[1] && r[2] + r[3] <= bytes.length) out.push(r)
  }
  return out
}

export async function verifySignatures(bytes: Uint8Array): Promise<SignatureReport[]> {
  const reports: SignatureReport[] = []
  for (const [a, b, c, d] of findByteRanges(bytes)) {
    const whole = c + d === bytes.length
    try {
      const gap = Buffer.from(bytes.subarray(a + b, c)).toString('latin1').trim()
      const hex = gap.replace(/^</, '').replace(/>$/, '').replace(/\s+/g, '')
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 100) {
        reports.push(unreadable('No signature value found', whole))
        continue
      }
      const der = forge.util.hexToBytes(hex)
      // The signature value is zero-padded to the placeholder length, so trailing bytes are expected.
      // (forge accepts an options object here; its typings only list the boolean form.)
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(der), { parseAllBytes: false } as unknown as boolean)
      const p7 = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData & {
        rawCapture: { authenticatedAttributes?: forge.asn1.Asn1[]; digestAlgorithm: string; signature: string; signerInfos?: unknown }
      }
      const cert = p7.certificates?.[0]
      if (!cert) {
        reports.push(unreadable('The signature contains no certificate', whole))
        continue
      }
      const cap = p7.rawCapture
      const hashInfo = HASH[forge.asn1.derToOid(cap.digestAlgorithm)]
      if (!hashInfo || !cap.authenticatedAttributes) {
        reports.push({ ...unreadable('Unsupported signature format', whole), signer: cn(cert.subject) })
        continue
      }

      // 1) Does the document still match the digest the signer signed?
      const covered = Buffer.concat([Buffer.from(bytes.subarray(a, a + b)), Buffer.from(bytes.subarray(c, c + d))])
      const digest = await crypto.subtle.digest(hashInfo.subtle, covered)
      let signedDigest = ''
      let signingTime: string | undefined
      for (const attr of cap.authenticatedAttributes) {
        const parts = attr.value as forge.asn1.Asn1[]
        const oid = forge.asn1.derToOid(parts[0].value as string)
        const val = parts[1].value as forge.asn1.Asn1[]
        if (oid === forge.pki.oids.messageDigest) signedDigest = val[0].value as string
        if (oid === forge.pki.oids.signingTime) signingTime = forge.asn1.utcTimeToDate(val[0].value as string)?.toISOString()
      }
      const digestMatches = forge.util.bytesToHex(signedDigest) === Buffer.from(digest).toString('hex')

      // 2) Is the signature over the signed attributes mathematically valid for the signer's key?
      const attrs = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, cap.authenticatedAttributes)
      const attrsDer = Buffer.from(forge.asn1.toDer(attrs).getBytes(), 'binary')
      const spki = Buffer.from(forge.asn1.toDer(forge.pki.publicKeyToAsn1(cert.publicKey as forge.pki.rsa.PublicKey)).getBytes(), 'binary')
      const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: hashInfo.subtle }, false, ['verify'])
      const sigOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, Buffer.from(cap.signature, 'binary'), attrsDer)

      const now = new Date()
      // The signature dictionary surrounds the hex value; /Reason may be on either side of it.
      const dict = Buffer.from(bytes.subarray(Math.max(0, a + b - 1200), Math.min(bytes.length, c + 800))).toString('latin1')
      const reason = /\/Reason\s*\(([^)]*)\)/.exec(dict)?.[1]
      reports.push({
        status: !sigOk ? 'invalid' : digestMatches ? 'valid' : 'modified',
        signer: cn(cert.subject),
        issuer: cn(cert.issuer),
        validFrom: cert.validity.notBefore.toISOString(),
        validTo: cert.validity.notAfter.toISOString(),
        certificateExpired: cert.validity.notAfter < now,
        selfSigned: cert.subject.hash === cert.issuer.hash,
        signedAt: signingTime,
        reason,
        coversWholeFile: whole,
        digestAlgorithm: hashInfo.subtle,
      })
    } catch (e) {
      reports.push(unreadable(`Could not read the signature: ${(e as Error).message}`, whole))
    }
  }
  return reports
}
