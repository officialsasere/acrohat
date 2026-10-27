// Desktop installers ship one app each. After `KWIIVA_APP=<app> vite build`, drop the files only the other apps use.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const app = process.argv[2]
const dist = join(import.meta.dirname, '..', `dist-${app}`)
const drop = {
  // Kwiiva Write has no PDF engine or OCR.
  write: ['ocr', 'paper.svg', 'paper-lockup.svg', 'paper-180.png', 'paper-192.png', 'paper-512.png', 'paper-maskable-512.png', 'paper.webmanifest'],
  paper: ['write.svg', 'write-lockup.svg', 'write-180.png', 'write-192.png', 'write-512.png', 'write-maskable-512.png', 'write.webmanifest'],
}[app]
if (!drop) throw new Error(`prune-dist: unknown app "${app}"`)
for (const f of drop) rmSync(join(dist, f), { recursive: true, force: true })
console.log(`prune-dist: removed ${drop.length} entries from dist-${app}`)
