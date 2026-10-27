import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontFamily, FontSize, Color } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { Plugin } from '@tiptap/pm/state'
import { Pagination, type LayoutConfig } from './pagination'
import { Find } from './find'
import { INDENT_STEP } from './defaults'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setLineHeight: (v: number | null) => ReturnType
      setSpacing: (o: { before?: number | null; after?: number | null }) => ReturnType
      indent: () => ReturnType
      outdent: () => ReturnType
      setFirstLine: (pt: number | null) => ReturnType
      setParagraphStyle: (s: 'normal' | 'title' | 'subtitle') => ReturnType
    }
    pageBreak: { insertPageBreak: () => ReturnType }
    toc: { insertToc: () => ReturnType }
    layout: { refreshLayout: () => ReturnType }
    tableExtras: { setCellBackground: (c: string | null) => ReturnType }
  }
}

const TYPES = ['paragraph', 'heading']

/** Line spacing, space before/after, indentation and the Title/Subtitle styles for paragraphs and headings. */
const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    const num = (name: string, css: (v: number) => string) => ({
      default: null as number | null,
      parseHTML: (el: HTMLElement) => { const v = el.getAttribute(`data-${name}`); return v === null ? null : Number(v) },
      renderHTML: (a: Record<string, unknown>) => (a[name] == null ? {} : { [`data-${name}`]: String(a[name]), style: css(Number(a[name])) }),
    })
    return [
      {
        types: TYPES,
        attributes: {
          lineHeight: num('lineHeight', (v) => `line-height:${v}`),
          spaceBefore: num('spaceBefore', (v) => `padding-top:${v}pt`),
          spaceAfter: num('spaceAfter', (v) => `padding-bottom:${v}pt`),
          indent: num('indent', (v) => `padding-left:${v}pt`),
          firstLine: num('firstLine', (v) => `text-indent:${v}pt`),
          pStyle: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-pstyle'),
            renderHTML: (a: Record<string, unknown>) => (a.pStyle ? { 'data-pstyle': String(a.pStyle) } : {}),
          },
        },
      },
    ]
  },
  addCommands() {
    const set = (attrs: Record<string, unknown>) => ({ commands }: { commands: { updateAttributes: (t: string, a: Record<string, unknown>) => boolean } }) =>
      TYPES.map((t) => commands.updateAttributes(t, attrs)).some(Boolean)
    return {
      setLineHeight: (v) => set({ lineHeight: v }),
      setSpacing: (o) => set({ ...('before' in o ? { spaceBefore: o.before } : {}), ...('after' in o ? { spaceAfter: o.after } : {}) }),
      setFirstLine: (pt) => set({ firstLine: pt }),
      setParagraphStyle: (s) => set({ pStyle: s === 'normal' ? null : s }),
      indent: () => ({ editor, commands, chain }) => {
        if (editor.isActive('listItem') || editor.isActive('taskItem')) return chain().sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run()
        const cur = Number(editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').indent) || 0
        return commands.command(() => set({ indent: cur + INDENT_STEP })({ commands }))
      },
      outdent: () => ({ editor, commands, chain }) => {
        if (editor.isActive('listItem') || editor.isActive('taskItem')) return chain().liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run()
        const cur = Number(editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').indent) || 0
        return commands.command(() => set({ indent: cur - INDENT_STEP > 0 ? cur - INDENT_STEP : null })({ commands }))
      },
    }
  },
})

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break' })],
  addCommands: () => ({ insertPageBreak: () => ({ chain }) => chain().insertContent({ type: 'pageBreak' }).run() }),
  addKeyboardShortcuts: () => ({ 'Mod-Enter': ({ editor }) => editor.commands.insertPageBreak() }),
})

/** A table of contents that follows the headings as you edit. */
const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: 'div[data-toc]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'toc' })],
  addCommands: () => ({ insertToc: () => ({ chain }) => chain().insertContent({ type: 'tableOfContents' }).run() }),
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div')
      dom.className = 'toc'
      dom.contentEditable = 'false'
      const render = () => {
        dom.textContent = ''
        const title = document.createElement('div')
        title.className = 'toc-title'
        title.textContent = 'Contents'
        dom.append(title)
        let n = 0
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading') return
          n++
          const row = document.createElement('button')
          row.type = 'button'
          row.className = 'toc-row'
          row.style.paddingLeft = (Number(node.attrs.level) - 1) * 18 + 'px'
          row.textContent = node.textContent || '(empty heading)'
          row.addEventListener('mousedown', (e) => e.preventDefault())
          row.addEventListener('click', () => { editor.chain().setTextSelection(pos + 1).scrollIntoView().run(); editor.view.focus() })
          dom.append(row)
        })
        if (!n) { const e = document.createElement('div'); e.className = 'toc-empty'; e.textContent = 'Add headings and they will be listed here.'; dom.append(e) }
      }
      render()
      editor.on('update', render)
      return { dom, destroy: () => editor.off('update', render) }
    }
  },
})

const Cell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
        renderHTML: (a: Record<string, unknown>) => (a.backgroundColor ? { 'data-bg': String(a.backgroundColor), style: `background-color:${a.backgroundColor}` } : {}),
      },
    }
  },
})
const HeaderCell = TableHeader.extend({ addAttributes: Cell.config.addAttributes })

/** Tab: indent inside a list, move between table cells, otherwise insert a real tab character. */
const TabKey = Extension.create({
  name: 'tabKey',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive('listItem')) return editor.commands.sinkListItem('listItem')
        if (editor.isActive('taskItem')) return editor.commands.sinkListItem('taskItem')
        if (editor.isActive('table')) return editor.commands.goToNextCell() || editor.commands.addRowAfter()
        return editor.commands.insertContent('\t')
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('listItem')) return editor.commands.liftListItem('listItem')
        if (editor.isActive('taskItem')) return editor.commands.liftListItem('taskItem')
        if (editor.isActive('table')) return editor.commands.goToPreviousCell()
        return true
      },
    }
  },
})

/** Pictures can be pasted or dropped into the page. Each is shrunk to a sensible size first. */
export async function fileToImage(file: File, maxW = 1600): Promise<{ src: string; width: number; height: number } | null> {
  if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(file.type)) return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const w0 = img.naturalWidth || 400, h0 = img.naturalHeight || 300
    const k = Math.min(1, maxW / w0)
    const c = document.createElement('canvas')
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    // Photos become JPEG, everything else PNG, so every saved format can hold them.
    const photo = file.type === 'image/jpeg'
    return { src: c.toDataURL(photo ? 'image/jpeg' : 'image/png', 0.9), width: Math.round(Math.min(c.width, 600)), height: Math.round((Math.min(c.width, 600) * c.height) / c.width) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const ImageDrop = Extension.create({
  name: 'imageDrop',
  addProseMirrorPlugins() {
    const editor = this.editor
    const insert = async (files: File[]) => {
      for (const f of files) { const i = await fileToImage(f); if (i) editor.chain().focus().setImage(i).run() }
    }
    return [
      new Plugin({
        props: {
          handlePaste: (_v, e) => { const fs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/')); if (!fs.length) return false; void insert(fs); return true },
          handleDrop: (_v, e) => { const fs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/')); if (!fs.length) return false; e.preventDefault(); void insert(fs); return true },
        },
      }),
    ]
  },
})

export function buildExtensions(getLayout: () => LayoutConfig, placeholder = ''): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
    }),
    TextStyle, FontFamily, FontSize, Color,
    Highlight.configure({ multicolor: true }),
    Subscript, Superscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList, TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, lastColumnResizable: false }), TableRow, HeaderCell, Cell,
    Image.configure({ inline: true, allowBase64: true, resize: { enabled: true, minWidth: 24, minHeight: 24, alwaysPreserveAspectRatio: true } }),
    Typography,
    CharacterCount,
    Placeholder.configure({ placeholder }),
    ParagraphFormat, PageBreak, TableOfContents, TabKey, ImageDrop,
    Find,
    Pagination.configure({ getConfig: getLayout }),
  ]
}
