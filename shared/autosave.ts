/**
 * Automatic saving to the file a document came from (or was last saved to). A document that has no file yet is only
 * kept in this browser; the first Save asks where to put it, and from then on changes are written there by themselves.
 */
const KEY = 'kwiiva.autosave'

export const autosaveOn = () => { try { return localStorage.getItem(KEY) !== 'off' } catch { return true } }
export const setAutosave = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode */ } }

/** A browser file handle can be written without asking only if permission was already given in this session. */
export async function handleWritable(h: FileSystemFileHandle): Promise<boolean> {
  const q = (h as unknown as { queryPermission?: (o: { mode: string }) => Promise<string> }).queryPermission
  if (!q) return true
  try { return (await q.call(h, { mode: 'readwrite' })) === 'granted' } catch { return false }
}

/** Runs `save` a moment after the last change; never two at once, and changes made while saving are saved next. */
export function makeAutosaver(save: () => Promise<void>, delay = 2500) {
  let timer = 0
  let running = false
  let again = false
  const run = async () => {
    if (running) { again = true; return }
    running = true
    try { await save() } catch { /* the next change tries again */ }
    running = false
    if (again) { again = false; timer = window.setTimeout(run, delay) }
  }
  return {
    poke() { if (!autosaveOn()) return; clearTimeout(timer); timer = window.setTimeout(run, delay) },
    now: run,
  }
}
