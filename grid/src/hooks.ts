import { useCallback, useSyncExternalStore } from 'react'
import { useStore } from './store'

/** The open workbook, re-rendering the component whenever it changes. */
export function useBook() {
  const book = useStore((s) => s.book)
  const sub = useCallback((cb: () => void) => book.subscribe(cb), [book])
  useSyncExternalStore(sub, () => book.version)
  return book
}
