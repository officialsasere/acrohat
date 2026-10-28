// Desktop installers ship one app each. After `KWIIVA_APP=<app> vite build`, drop the files only the other apps use.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const PRODUCTS = ['paper', 'write', 'grid', 'present']
const app = process.argv[2]
if (!PRODUCTS.includes(app)) throw new Error(`prune-dist: unknown app "${app}"`)
const dist = join(import.meta.dirname, '..', `dist-${app}`)
const drop = PRODUCTS.filter((p) => p !== app).flatMap((p) => [`${p}.svg`, `${p}-lockup.svg`, `${p}-180.png`, `${p}-192.png`, `${p}-512.png`, `${p}-maskable-512.png`, `${p}.webmanifest`])
// Only Kwiiva Paper has a PDF engine and OCR.
if (app !== 'paper') drop.unshift('ocr')
for (const f of drop) rmSync(join(dist, f), { recursive: true, force: true })
console.log(`prune-dist: removed ${drop.length} entries from dist-${app}`)
