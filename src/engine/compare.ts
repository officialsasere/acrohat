/** Text comparison of two documents, paragraph by paragraph. */

export interface Change {
  kind: 'added' | 'removed'
  text: string
  /** Zero-based page in the document the text belongs to (the old one for removals, the new one for additions). */
  page: number
}

export interface Paragraph {
  text: string
  page: number
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function compareParagraphs(a: Paragraph[], b: Paragraph[]): { changes: Change[]; identical: number; tooDifferent: boolean } {
  const A = a.map((p) => norm(p.text)).filter(Boolean)
  const B = b.map((p) => norm(p.text)).filter(Boolean)
  const pa = a.filter((p) => norm(p.text))
  const pb = b.filter((p) => norm(p.text))
  let lo = 0
  while (lo < A.length && lo < B.length && A[lo] === B[lo]) lo++
  let ea = A.length
  let eb = B.length
  while (ea > lo && eb > lo && A[ea - 1] === B[eb - 1]) {
    ea--
    eb--
  }
  const n = ea - lo
  const m = eb - lo
  const changes: Change[] = []
  if (n * m > 16_000_000) return { changes, identical: lo + (A.length - ea), tooDifferent: true }
  // Longest common subsequence on the differing middle.
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i * w + j] = A[lo + i] === B[lo + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  let i = 0
  let j = 0
  let same = lo + (A.length - ea)
  while (i < n || j < m) {
    if (i < n && j < m && A[lo + i] === B[lo + j]) {
      same++
      i++
      j++
    } else if (j < m && (i === n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      changes.push({ kind: 'added', text: B[lo + j], page: pb[lo + j].page })
      j++
    } else {
      changes.push({ kind: 'removed', text: A[lo + i], page: pa[lo + i].page })
      i++
    }
  }
  return { changes, identical: same, tooDifferent: false }
}
