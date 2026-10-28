/**
 * File access in the desktop apps goes through two small commands in each app's Rust shell (`read_doc` / `read_pdf`
 * and `write_doc`) instead of the general file plugin, so saving works for any place the person picks in the
 * system dialog. The shell only reads and writes the document types listed in its lib.rs.
 */
export async function nativeWrite(path: string, bytes: Uint8Array): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('write_doc', bytes, { headers: { path: encodeURIComponent(path) } })
}
export async function nativeRead(path: string, command = 'read_doc'): Promise<Uint8Array> {
  const { invoke } = await import('@tauri-apps/api/core')
  const key = command === 'read_pdf' ? 'path' : 'path'
  return new Uint8Array(await invoke<ArrayBuffer>(command, { [key]: path }))
}
/** Errors from the shell arrive as plain strings. */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
