import { useEffect, useRef } from 'react'
import { call } from '../engine/client'
import { useStore } from '../store'
import { Icon } from './Icons'

export function SearchBar() {
  const search = useStore((s) => s.search)
  const doc = useStore((s) => s.active())
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (search.open) ref.current?.select()
  }, [search.open])
  if (!search.open || !doc) return null

  const set = (p: Partial<typeof search>) => useStore.setState((s) => ({ search: { ...s.search, ...p } }))
  const run = async (query: string, matchCase = search.matchCase) => {
    if (!query) return set({ hits: [], index: -1, query })
    const hits = await useStore.getState().run(() => call('search', { id: doc.id, query, matchCase }))
    set({ query, hits: hits ?? [], index: hits?.length ? 0 : -1 })
  }
  const step = (d: number) => {
    if (!search.hits.length) return
    set({ index: (search.index + d + search.hits.length) % search.hits.length })
  }

  return (
    <div className="searchbar" role="search">
      <input
        ref={ref}
        autoFocus
        placeholder="Find in document"
        defaultValue={search.query}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.currentTarget.value !== search.query) run(e.currentTarget.value)
            else step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') set({ open: false, hits: [], index: -1 })
        }}
      />
      <span className="count">{search.hits.length ? `${search.index + 1} of ${search.hits.length}` : search.query ? 'No results' : ''}</span>
      <label>
        <input type="checkbox" checked={search.matchCase} onChange={(e) => { set({ matchCase: e.target.checked }); run(search.query, e.target.checked) }} /> Aa
      </label>
      <button title="Previous (Shift+Enter)" onClick={() => step(-1)}>
        <Icon name="up" />
      </button>
      <button title="Next (Enter)" onClick={() => step(1)}>
        <Icon name="down" />
      </button>
      <button title="Close" onClick={() => set({ open: false, hits: [], index: -1 })}>
        <Icon name="close" />
      </button>
    </div>
  )
}
