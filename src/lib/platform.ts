/** True when running inside the Tauri desktop shell rather than a plain browser. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
