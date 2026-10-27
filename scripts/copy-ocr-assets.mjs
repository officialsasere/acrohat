// Copies the OCR engine and English model out of node_modules into public/ocr so the app can load
// them from its own origin (no CDN, works offline). Runs before dev/build.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
mkdirSync(out, { recursive: true })

const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ['node_modules/tesseract.js-core/LICENSE', 'LICENSE-tesseract-core.txt'],
]
for (const [from, to] of files) {
  const src = join(root, from)
  if (!existsSync(src)) {
    console.error(`copy-ocr-assets: missing ${from} (run yarn install)`)
    process.exit(1)
  }
  copyFileSync(src, join(out, to))
}
console.log(`copy-ocr-assets: ${files.length} files -> public/ocr`)
