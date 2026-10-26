import createModule from '@neslinesli93/qpdf-wasm'
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url'

/**
 * qpdf (Apache-2.0) compiled to WebAssembly: encryption, decryption and file-size optimization,
 * which PDFium cannot do. Each call gets a fresh module because qpdf's main() is not re-entrant.
 */

interface QpdfModule {
  FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void }
  callMain(args: string[]): number
}

export class QpdfError extends Error {}

export interface Qpdf {
  run(bytes: Uint8Array, args: string[]): Promise<Uint8Array>
}

async function run(bytes: Uint8Array, args: string[], locate: string = wasmUrl): Promise<Uint8Array> {
  const logs: string[] = []
  const mod = (await (createModule as unknown as (o: object) => Promise<QpdfModule>)({
    locateFile: () => locate,
    noInitialRun: true,
    print: (s: string) => logs.push(s),
    printErr: (s: string) => logs.push(s),
  })) as QpdfModule
  mod.FS.writeFile('/in.pdf', bytes)
  let code: number
  try {
    code = mod.callMain(['/in.pdf', ...args, '/out.pdf'])
  } catch (e) {
    // Emscripten throws an ExitStatus when main() calls exit().
    code = (e as { status?: number }).status ?? 2
  }
  // qpdf exits 3 for "warnings, output still written".
  if (code !== 0 && code !== 3) throw new QpdfError(logs.filter(Boolean).join('\n') || `qpdf failed (exit ${code})`)
  return mod.FS.readFile('/out.pdf')
}

export interface Permissions {
  print: boolean
  modify: boolean
  copy: boolean
  annotate: boolean
}

/** AES-256 encryption. `owner` defaults to `user`. */
export function protect(bytes: Uint8Array, user: string, owner: string = user, perms: Permissions = { print: true, modify: true, copy: true, annotate: true }, locate?: string) {
  if (!user) throw new QpdfError('A password is required')
  const yn = (b: boolean) => (b ? 'y' : 'n')
  return run(bytes, ['--encrypt', user, owner, '256', `--print=${perms.print ? 'full' : 'none'}`, `--modify=${perms.modify ? 'all' : 'none'}`, `--extract=${yn(perms.copy)}`, `--annotate=${yn(perms.annotate)}`, '--'], locate)
}

export function unprotect(bytes: Uint8Array, password: string, locate?: string) {
  return run(bytes, [`--password=${password}`, '--decrypt'], locate)
}

/** Recompresses streams and packs objects; usually shrinks files without touching content. */
export function optimize(bytes: Uint8Array, locate?: string) {
  return run(bytes, ['--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', '--remove-unreferenced-resources=yes'], locate)
}
