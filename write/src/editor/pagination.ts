import { Extension, type CommandProps } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNodeT } from '@tiptap/pm/model'
import type { HeaderFooter } from '../formats/types'

/**
 * Page layout. The whole document is one continuous editable column drawn as a sheet of paper. To show it as separate
 * pages we measure where each block (and each line of a long paragraph) lands, and wherever a page would end we insert a
 * "spacer": the rest of the page, the footer, a gap, and the next page's header. Spacers are decorations, so they are
 * not part of the document. Text that would cross the bottom margin moves to the next page, as it does when printed.
 */
export interface LayoutConfig {
  enabled: boolean
  /** All sizes in CSS pixels. */
  pageH: number
  top: number
  bottom: number
  left: number
  right: number
  gap: number
  header: HeaderFooter
  footer: HeaderFooter
}

interface Spacer { pos: number; height: number; fill: number; page: number }
interface LayoutState { spacers: Spacer[]; total: number; endFill: number; cfgKey: string; deco: DecorationSet }

export const layoutKey = new PluginKey<LayoutState>('kwiivaLayout')
export const PAGE_GAP = 28

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])
const BLOCK_UNITS = new Set(['table', 'horizontalRule', 'pageBreak', 'tableOfContents', 'image'])
const WRAPPERS = new Set(['listItem', 'taskItem', 'blockquote', 'bulletList', 'orderedList', 'taskList'])

const cfgKeyOf = (c: LayoutConfig) => JSON.stringify([c.enabled, c.pageH, c.top, c.bottom, c.left, c.right, c.header, c.footer])

function hfRow(h: HeaderFooter, page: number, total: number, cls: string, cfg: LayoutConfig, height: number): HTMLElement {
  const row = document.createElement('div')
  row.className = `hf ${cls}`
  row.style.left = cfg.left + 'px'
  row.style.right = cfg.right + 'px'
  row.style.height = height + 'px'
  for (const zone of ['left', 'center', 'right'] as const) {
    const s = document.createElement('span')
    s.className = zone
    s.textContent = h[zone].replace(/\{pages\}/g, String(total)).replace(/\{page\}/g, String(page))
    row.append(s)
  }
  return row
}

function spacerDom(sp: Spacer, total: number, cfg: LayoutConfig): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pg-spacer'
  el.contentEditable = 'false'
  el.style.height = sp.height + 'px'
  const fill = document.createElement('div')
  fill.style.height = sp.fill + 'px'
  const footer = document.createElement('div')
  footer.className = 'pg-footer'
  footer.style.height = cfg.bottom + 'px'
  footer.append(hfRow(cfg.footer, sp.page, total, 'footer', cfg, cfg.bottom))
  const gap = document.createElement('div')
  gap.className = 'pg-gap'
  gap.style.height = cfg.gap + 'px'
  const header = document.createElement('div')
  header.className = 'pg-header'
  header.style.height = cfg.top + 'px'
  header.append(hfRow(cfg.header, sp.page + 1, total, 'header', cfg, cfg.top))
  el.append(fill, footer, gap, header)
  return el
}

function decorations(doc: PMNodeT, st: Pick<LayoutState, 'spacers' | 'total' | 'endFill'>, cfg: LayoutConfig): DecorationSet {
  if (!cfg.enabled) return DecorationSet.empty
  const list: Decoration[] = []
  const first = document.createElement('div')
  first.className = 'pg-first'
  first.contentEditable = 'false'
  const hdr = hfRow(cfg.header, 1, st.total, 'header first', cfg, cfg.top)
  first.append(hdr)
  list.push(Decoration.widget(0, first, { side: -1, key: `first-${st.total}-${JSON.stringify(cfg.header)}-${cfg.top}`, ignoreSelection: true }))
  for (const sp of st.spacers)
    list.push(Decoration.widget(sp.pos, () => spacerDom(sp, st.total, cfg), { side: -1, key: `sp-${sp.pos}-${sp.height}-${sp.page}-${st.total}-${JSON.stringify(cfg.header)}-${JSON.stringify(cfg.footer)}`, ignoreSelection: true }))
  const end = document.createElement('div')
  end.className = 'pg-end'
  end.contentEditable = 'false'
  end.style.height = st.endFill + cfg.bottom + 'px'
  const fillEl = document.createElement('div')
  fillEl.style.height = st.endFill + 'px'
  const foot = document.createElement('div')
  foot.className = 'pg-footer'
  foot.style.height = cfg.bottom + 'px'
  foot.append(hfRow(cfg.footer, st.total, st.total, 'footer', cfg, cfg.bottom))
  end.append(fillEl, foot)
  list.push(Decoration.widget(doc.content.size, end, { side: 1, key: `end-${st.endFill}-${st.total}-${JSON.stringify(cfg.footer)}-${cfg.bottom}`, ignoreSelection: true }))
  return DecorationSet.create(doc, list)
}

interface Seg { natTop: number; natBottom: number; pos: () => number }
interface Unit { kind: 'text' | 'block'; node: PMNodeT; pos: number; natTop: number; natBottom: number; heading: boolean; segs: Seg[]; pageBreak: boolean }

/** Where a break before a block should go: before the outermost list item or quote the block starts. */
function blockBreakPos(doc: PMNodeT, pos: number): number {
  let $p = doc.resolve(pos)
  let p = pos
  for (let d = $p.depth; d > 0; d--) {
    const parent = $p.node(d)
    if (WRAPPERS.has(parent.type.name) && $p.index(d) === 0) { p = $p.before(d); $p = doc.resolve(p); d = $p.depth + 1 } else break
  }
  return p
}

function measure(view: EditorView, cfg: LayoutConfig): { spacers: Spacer[]; total: number; endFill: number } | null {
  const dom = view.dom as HTMLElement
  const pm = dom.getBoundingClientRect()
  if (!dom.offsetWidth) return null
  const scale = pm.width / dom.offsetWidth || 1
  const rel = (v: number) => (v - pm.top) / scale
  const existing = [...dom.querySelectorAll<HTMLElement>('.pg-spacer')].map((el) => { const r = el.getBoundingClientRect(); return { top: rel(r.top), h: r.height / scale } })
  const nat = (y: number) => { let s = 0; for (const e of existing) if (e.top + e.h <= y + 0.5) s += e.h; return y - s }

  // ---- units: every block that can't be split, and every paragraph (which can, between lines) ----
  const units: Unit[] = []
  view.state.doc.descendants((node, pos) => {
    const name = node.type.name
    const isText = TEXT_BLOCKS.has(name)
    if (!isText && !BLOCK_UNITS.has(name)) return true
    const el = view.nodeDOM(pos) as HTMLElement | null
    if (!el || el.nodeType !== 1) return false
    const r = el.getBoundingClientRect()
    const u: Unit = { kind: isText ? 'text' : 'block', node, pos, natTop: nat(rel(r.top)), natBottom: nat(rel(r.bottom)), heading: name === 'heading', segs: [], pageBreak: name === 'pageBreak' }
    const breakBefore = () => blockBreakPos(view.state.doc, pos)
    u.segs = [{ natTop: u.natTop, natBottom: u.natBottom, pos: breakBefore }]
    if (isText) {
      const lines = lineBoxes(view, el, nat, rel, scale, u.natBottom)
      if (lines.length > 1) {
        u.segs = lines.map((l, i) => ({ natTop: i === 0 ? u.natTop : l.top, natBottom: l.bottom, pos: i === 0 ? breakBefore : () => l.pos() }))
        // The last line also carries the paragraph's bottom padding.
        u.segs[u.segs.length - 1].natBottom = u.natBottom
      }
    }
    units.push(u)
    return false
  })

  // ---- walk the units, deciding where pages end ----
  const content = cfg.pageH - cfg.top - cfg.bottom
  const chrome = cfg.bottom + cfg.gap + cfg.top
  const out: Spacer[] = []
  let cum = 0
  let pageTop = cfg.top // real y where the current page's content starts
  let limit = pageTop + content // real y where it must stop
  let page = 1
  let force = false
  let prev: Unit | null = null

  const breakAt = (natTop: number, pos: number) => {
    const realT = natTop + cum
    const fill = Math.max(0, limit - realT)
    const height = fill + chrome
    out.push({ pos, height, fill, page })
    cum += height
    page++
    pageTop = realT + height
    limit = pageTop + content
  }

  for (const u of units) {
    for (let si = 0; si < u.segs.length; si++) {
      const s = u.segs[si]
      for (let guard = 0; guard < 4; guard++) {
        const realT = s.natTop + cum, realB = s.natBottom + cum
        if (force) {
          force = false
          breakAt(s.natTop, s.pos())
          continue
        }
        if (realB <= limit + 0.5) break
        if (realT <= pageTop + 0.5) {
          // Taller than a page and nowhere to break: let it run over, and count the extra pages it covers.
          while (realB > limit + 0.5) { page++; pageTop = limit + chrome; limit = pageTop + content }
          break
        }
        // Keep a heading with the paragraph that follows it.
        if (si === 0 && prev?.heading && prev.natTop + cum > pageTop + 0.5) {
          const hs = prev.segs[0]
          breakAt(hs.natTop, hs.pos())
          continue
        }
        // Never leave one line of a paragraph alone at the bottom or the top of a page.
        const n = u.segs.length
        if (si === 1 && u.segs[0].natTop + cum > pageTop + 0.5) breakAt(u.segs[0].natTop, u.segs[0].pos())
        else if (si === n - 1 && n >= 4 && si - 1 >= 2) breakAt(u.segs[si - 1].natTop, u.segs[si - 1].pos())
        else breakAt(s.natTop, s.pos())
      }
    }
    if (u.pageBreak) force = true
    prev = u
  }
  const lastBottom = units.length ? units[units.length - 1].natBottom + cum : pageTop
  const endFill = Math.max(0, limit - lastBottom)
  return { spacers: out, total: page, endFill }
}

/** Lines of a paragraph in natural coordinates (as if there were no spacers), with the document position each starts at. */
function lineBoxes(view: EditorView, el: HTMLElement, nat: (y: number) => number, rel: (v: number) => number, scale: number, natBottom: number) {
  const cs = getComputedStyle(el)
  const lhRaw = parseFloat(cs.lineHeight)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement?.closest('.pg-spacer')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) })
  const lines: { top: number; bottom: number; rectTop: number; node: Text; pos: () => number }[] = []
  const range = document.createRange()
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.data.length) continue
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) {
      if (r.height < 1) continue
      const top = rel(r.top)
      const last = lines[lines.length - 1]
      if (last && Math.abs(r.top - last.rectTop) < r.height / 2) continue
      if (last && r.top < last.rectTop) continue
      const lh = isNaN(lhRaw) ? (r.height / scale) * 1.2 : lhRaw
      const t = top - (lh - r.height / scale) / 2
      const node = n
      const rectTop = r.top
      lines.push({
        top: nat(t), bottom: nat(t) + lh, rectTop, node,
        pos: () => {
          // First character of this text node that sits on this line (lines only grow downwards).
          let lo = 0, hi = node.data.length
          while (lo < hi) {
            const mid = (lo + hi) >> 1
            range.setStart(node, mid); range.setEnd(node, Math.min(mid + 1, node.data.length))
            const rr = range.getClientRects()[0]
            if (rr && rr.top >= rectTop - 1) hi = mid; else lo = mid + 1
          }
          return view.posAtDOM(node, lo)
        },
      })
    }
  }
  void natBottom
  return lines
}

export interface PaginationOptions { getConfig: () => LayoutConfig }

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',
  addOptions() {
    return { getConfig: () => ({ enabled: false, pageH: 1056, top: 96, bottom: 96, left: 96, right: 96, gap: PAGE_GAP, header: { left: '', center: '', right: '' }, footer: { left: '', center: '', right: '' } }) }
  },
  addCommands() {
    return { refreshLayout: () => ({ tr, dispatch }: CommandProps) => { if (dispatch) dispatch(tr.setMeta(layoutKey, { refresh: true })); return true } }
  },
  addProseMirrorPlugins() {
    const getConfig = this.options.getConfig
    return [
      new Plugin<LayoutState>({
        key: layoutKey,
        state: {
          init: () => ({ spacers: [], total: 1, endFill: 0, cfgKey: '', deco: DecorationSet.empty }),
          apply(tr, value, _old, state) {
            const cfg = getConfig()
            const meta = tr.getMeta(layoutKey) as { set?: { spacers: Spacer[]; total: number; endFill: number }; refresh?: boolean } | undefined
            if (meta?.set) {
              const next = { ...meta.set, cfgKey: cfgKeyOf(cfg) }
              return { ...next, deco: decorations(state.doc, next, cfg) }
            }
            if (!cfg.enabled) return value.cfgKey === cfgKeyOf(cfg) ? value : { spacers: [], total: 1, endFill: 0, cfgKey: cfgKeyOf(cfg), deco: DecorationSet.empty }
            if (tr.docChanged) {
              const spacers = value.spacers.map((s) => ({ ...s, pos: tr.mapping.map(s.pos, -1) }))
              const next = { ...value, spacers }
              return { ...next, deco: decorations(state.doc, next, cfg) }
            }
            if (value.cfgKey !== cfgKeyOf(cfg) || meta?.refresh) return { ...value, cfgKey: cfgKeyOf(cfg), deco: decorations(state.doc, value, cfg) }
            return value
          },
        },
        props: { decorations: (state) => layoutKey.getState(state)?.deco ?? DecorationSet.empty },
        view(view) {
          let raf = 0, timer = 0
          const run = () => {
            raf = 0
            const cfg = getConfig()
            const st = layoutKey.getState(view.state)
            if (!cfg.enabled || view.composing || !st) return
            const m = measure(view, cfg)
            if (!m) return
            const same = m.total === st.total && Math.abs(m.endFill - st.endFill) < 1 && m.spacers.length === st.spacers.length && m.spacers.every((s, i) => s.pos === st.spacers[i].pos && Math.abs(s.height - st.spacers[i].height) < 1 && s.page === st.spacers[i].page)
            if (!same && st.cfgKey === cfgKeyOf(cfg)) view.dispatch(view.state.tr.setMeta(layoutKey, { set: m }).setMeta('addToHistory', false))
            else if (st.cfgKey !== cfgKeyOf(cfg)) view.dispatch(view.state.tr.setMeta(layoutKey, { refresh: true }).setMeta('addToHistory', false))
          }
          const schedule = () => {
            if (raf) return
            clearTimeout(timer)
            timer = window.setTimeout(() => { raf = requestAnimationFrame(run) }, 60)
          }
          const onLoad = () => schedule()
          view.dom.addEventListener('load', onLoad, true)
          const ro = new ResizeObserver(schedule)
          ro.observe(view.dom)
          document.fonts?.ready.then(schedule)
          schedule()
          return {
            update: schedule,
            destroy() {
              cancelAnimationFrame(raf); clearTimeout(timer); ro.disconnect()
              view.dom.removeEventListener('load', onLoad, true)
            },
          }
        },
      }),
    ]
  },
})

/** Number of pages and the page the cursor is on, for the status bar. */
export function pageInfo(view: EditorView): { page: number; total: number } {
  const st = layoutKey.getState(view.state)
  const total = st?.total ?? 1
  const sel = view.state.selection.head
  let page = 1
  for (const s of st?.spacers ?? []) if (s.pos <= sel) page = s.page + 1
  return { page: Math.min(page, total), total }
}
