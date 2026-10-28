import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { Extension } from '@tiptap/core'
import { MarkerPlugin, ParaAttrs, TBold, TColor, TFont, THighlight, TItalic, TSize, docToText, setEditorRole, setEditorTheme, textToDoc } from '../richtext'
import type { PlaceholderRole, Text, TextStyle, Theme } from '../model'
import { fmtFromEditor, text as fmt } from '../format'
import { Fragment, Slice } from '@tiptap/pm/model'
import { useStore } from '../store'
import { insertImageFiles } from '../insert'

interface Props {
  text: Text
  st?: TextStyle
  role?: PlaceholderRole
  theme: Theme
  /** Where in the box the user clicked, so the caret lands there. */
  at?: { x: number; y: number } | null
  /** Select everything on open (typing replaces it). */
  all?: boolean
  onChange: (t: Text) => void
  onExit: () => void
  /** Table cells: Tab moves to the next cell. */
  onTab?: (dir: 1 | -1) => boolean
}

export function TextEditor({ text, st, role, theme, at, all, onChange, onExit, onTab }: Props) {
  const stRef = useRef(st); stRef.current = st
  const cbs = useRef({ onChange, onExit, onTab }); cbs.current = { onChange, onExit, onTab }
  const first = useRef(text)
  setEditorTheme(theme)
  setEditorRole(role)

  const extensions = useMemo(() => [
    StarterKit.configure({ bold: false, italic: false, heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false, codeBlock: false, code: false, horizontalRule: false, link: { openOnClick: false, autolink: true } }),
    Superscript, Subscript, TBold, TItalic, TColor, THighlight, TFont, TSize, ParaAttrs,
    MarkerPlugin(() => stRef.current),
    Extension.create({
      name: 'slideKeys',
      addKeyboardShortcuts() {
        const level = (d: 1 | -1) => () => {
          const ed = this.editor
          if (d === 1 && cbs.current.onTab?.(1)) return true
          if (d === -1 && cbs.current.onTab?.(-1)) return true
          const { state, view } = ed
          const tr = state.tr
          state.doc.nodesBetween(state.selection.from, state.selection.to, (n, pos) => { if (n.type.name === 'paragraph') tr.setNodeMarkup(pos, undefined, { ...n.attrs, level: Math.max(0, Math.min(8, (n.attrs.level == null ? 0 : Number(n.attrs.level)) + d)) }) })
          view.dispatch(tr)
          return true
        }
        return {
          Tab: level(1), 'Shift-Tab': level(-1), Escape: () => { cbs.current.onExit(); return true },
          'Mod-b': () => { fmt.bold(); return true }, 'Mod-i': () => { fmt.italic(); return true },
          'Mod-e': () => { fmt.align('center'); return true }, 'Mod-l': () => { fmt.align('left'); return true }, 'Mod-r': () => { fmt.align('right'); return true }, 'Mod-j': () => { fmt.align('justify'); return true },
          'Mod-Shift-.': () => { fmt.sizeStep(1); return true }, 'Mod-Shift-,': () => { fmt.sizeStep(-1); return true }, 'Mod-]': () => { fmt.sizeStep(1); return true }, 'Mod-[': () => { fmt.sizeStep(-1); return true },
        }
      },
    }),
  ], [])

  const editor = useEditor({
    extensions,
    content: textToDoc(first.current),
    autofocus: all ? 'all' : 'end',
    editorProps: {
      attributes: { class: 'pm', spellcheck: 'true', 'aria-label': 'Slide text' },
      handlePaste(_v, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (files.length) { void insertImageFiles(files); return true }
        const html = event.clipboardData?.getData('text/html') ?? ''
        if (/data-t(bold|italic|color|size|font|hl)/.test(html)) return false
        const t = event.clipboardData?.getData('text/plain')
        if (t == null) return false
        const { state } = _v, { schema } = state
        const paras = t.replace(/\r\n?/g, '\n').split('\n').map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : undefined))
        _v.dispatch(state.tr.replaceSelection(new Slice(Fragment.from(paras), 1, 1)).scrollIntoView())
        return true
      },
    },
    onUpdate: ({ editor: e }) => cbs.current.onChange(docToText(e.getJSON(), first.current)),
    onSelectionUpdate: ({ editor: e }) => useStore.setState({ fmt: fmtFromEditor(e) }),
    onTransaction: ({ editor: e }) => { if (e.isFocused) useStore.setState({ fmt: fmtFromEditor(e) }) },
  })

  useEffect(() => {
    if (!editor) return
    useStore.setState({ editor, fmt: fmtFromEditor(editor) })
    editor.commands.focus(all ? 'all' : 'end')
    if (at) { const pos = editor.view.posAtCoords({ left: at.x, top: at.y }); if (pos) editor.commands.setTextSelection(pos.pos) }
    return () => { useStore.setState((s) => (s.editor === editor ? { editor: null, fmt: null } : {})) }
  }, [editor, at])

  return <EditorContent editor={editor} />
}
