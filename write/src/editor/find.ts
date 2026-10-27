import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNodeT } from '@tiptap/pm/model'

export interface FindOptions { query: string; matchCase: boolean; wholeWord: boolean }
export interface FindMatch { from: number; to: number }
export interface FindState { opts: FindOptions; matches: FindMatch[]; current: number; deco: DecorationSet }

export const findKey = new PluginKey<FindState>('kwiivaFind')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    find: {
      setFind: (o: Partial<FindOptions>) => ReturnType
      findNext: (dir?: 1 | -1) => ReturnType
      replaceCurrent: (text: string) => ReturnType
      replaceAll: (text: string) => ReturnType
      clearFind: () => ReturnType
    }
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findMatches(doc: PMNodeT, o: FindOptions): FindMatch[] {
  if (!o.query) return []
  const re = new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc(o.query)}(?![\\p{L}\\p{N}_])` : esc(o.query), o.matchCase ? 'gu' : 'giu')
  const out: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Search each text block as one string so a match can span differently formatted pieces.
    let text = ''
    const map: number[] = []
    node.descendants((c, p) => {
      if (c.isText) { for (let i = 0; i < c.text!.length; i++) map.push(pos + 1 + p + i); text += c.text }
      else if (c.type.name === 'hardBreak') { map.push(pos + 1 + p); text += '\n' }
      return true
    })
    for (const m of text.matchAll(re)) if (m[0].length) out.push({ from: map[m.index!], to: map[m.index! + m[0].length - 1] + 1 })
    return false
  })
  return out
}

function build(doc: PMNodeT, opts: FindOptions, current: number): FindState {
  const matches = findMatches(doc, opts)
  const cur = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1
  const deco = DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === cur ? 'find-hit current' : 'find-hit' })))
  return { opts, matches, current: cur, deco }
}

export const Find = Extension.create({
  name: 'find',
  addCommands() {
    return {
      setFind: (o) => ({ tr, dispatch, state }) => {
        const prev = findKey.getState(state)?.opts ?? { query: '', matchCase: false, wholeWord: false }
        if (dispatch) dispatch(tr.setMeta(findKey, { opts: { ...prev, ...o }, reset: true }))
        return true
      },
      findNext: (dir = 1) => ({ tr, dispatch, state }) => {
        const st = findKey.getState(state)
        if (!st || !st.matches.length) return false
        const i = (st.current + dir + st.matches.length) % st.matches.length
        if (dispatch) dispatch(tr.setMeta(findKey, { current: i }).scrollIntoView())
        return true
      },
      replaceCurrent: (text) => ({ tr, dispatch, state }) => {
        const st = findKey.getState(state)
        const m = st?.matches[st.current]
        if (!st || !m) return false
        if (dispatch) { tr.insertText(text, m.from, m.to); dispatch(tr.setMeta(findKey, { current: st.current })) }
        return true
      },
      replaceAll: (text) => ({ tr, dispatch, state }) => {
        const st = findKey.getState(state)
        if (!st || !st.matches.length) return false
        if (dispatch) { for (const m of [...st.matches].reverse()) tr.insertText(text, m.from, m.to); dispatch(tr) }
        return true
      },
      clearFind: () => ({ tr, dispatch }) => { if (dispatch) dispatch(tr.setMeta(findKey, { opts: { query: '', matchCase: false, wholeWord: false }, reset: true })); return true },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: (_c, { doc }) => build(doc, { query: '', matchCase: false, wholeWord: false }, 0),
          apply(tr, value, _o, state) {
            const meta = tr.getMeta(findKey) as { opts?: FindOptions; current?: number; reset?: boolean } | undefined
            if (meta?.opts) return build(state.doc, meta.opts, 0)
            if (meta?.current !== undefined) return build(state.doc, value.opts, meta.current)
            if (tr.docChanged && value.opts.query) return build(state.doc, value.opts, value.current)
            return value
          },
        },
        props: { decorations: (state) => findKey.getState(state)?.deco ?? DecorationSet.empty },
      }),
    ]
  },
})
