import { createWorker, type Worker } from 'tesseract.js'
import type { OcrWord } from '../engine/ocr'

/** Flattens tesseract's block → paragraph → line → word tree into words in pixel coordinates. */
export function wordsOf(data: { blocks?: { paragraphs: { lines: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null }): OcrWord[] {
  const out: OcrWord[] = []
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const w of l.words) {
          if (!w.text.trim() || w.confidence < 30) continue
          out.push({ text: w.text.trim(), x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 })
        }
  return out
}

let worker: Promise<Worker> | null = null

/** Starts (once) the OCR engine from files served by this app; nothing is downloaded from the internet. */
export function ocrWorker(onProgress?: (p: number) => void): Promise<Worker> {
  const base = `${new URL(import.meta.env.BASE_URL, location.href).href}ocr`
  worker ??= createWorker('eng', 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    logger: (m: { status: string; progress: number }) => m.status === 'recognizing text' && onProgress?.(m.progress),
  })
  return worker
}

export async function stopOcr() {
  const w = await worker
  worker = null
  await w?.terminate()
}
