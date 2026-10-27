import { useState } from 'react'
import { applyStyle, clearFormatting, COLORS, currentStyle, fontSizeOf, STYLES, stepFontSize, type StyleId } from '../editor/commands'
import { FONTS, fontNameOf, fontStack } from '../editor/fonts'
import { dialog, ed, pickImage, printDoc } from '../editor/actions'
import { useStore } from '../store'
import { Icon, Pop } from './ui'

function ColorPop({ kind }: { kind: 'text' | 'highlight' }) {
  const editor = useStore((s) => s.editor)!
  useStore((s) => s.tick)
  const [custom, setCustom] = useState('#8a5a36')
  const current = kind === 'text' ? (editor.getAttributes('textStyle').color as string | undefined) : (editor.getAttributes('highlight').color as string | undefined)
  const apply = (c: string | null, close: () => void) => {
    const ch = editor.chain().focus()
    if (kind === 'text') (c ? ch.setColor(c) : ch.unsetColor()).run()
    else (c ? ch.setHighlight({ color: c }) : ch.unsetHighlight()).run()
    close()
  }
  return (
    <Pop title={kind === 'text' ? 'Text colour' : 'Highlight colour'} trigger={<span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><Icon name={kind === 'text' ? 'fontcolor' : 'highlight'} size={16} /><span className="swatch-bar" style={{ background: current ?? (kind === 'text' ? '#000' : 'transparent'), outline: !current && kind === 'highlight' ? '1px solid #bbb' : undefined }} /></span>} panelClass="color-panel">
      {(close) => (
        <>
          <div className="color-grid">
            {COLORS.map((c) => <button key={c} type="button" aria-label={c} title={c} style={{ background: c }} onClick={() => apply(c, close)} />)}
          </div>
          <div className="row">
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom colour" style={{ width: 40, padding: 0, height: 28 }} />
            <button type="button" className="ghost" onClick={() => apply(custom, close)}>Use this</button>
            <button type="button" onClick={() => apply(null, close)}>{kind === 'text' ? 'Automatic' : 'None'}</button>
          </div>
        </>
      )}
    </Pop>
  )
}

export function Toolbar() {
  const editor = useStore((s) => s.editor)
  const settings = useStore((s) => s.settings)
  useStore((s) => s.tick)
  const [sizeText, setSizeText] = useState<string | null>(null)
  if (!editor) return null
  const c = () => editor.chain().focus()
  const t = (name: string, label: string, icon: string, run: () => void, active = editor.isActive(name), disabled = false) => (
    <button type="button" className={active ? 'on' : ''} title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}><Icon name={icon} /></button>
  )
  const glyph = (name: string, label: string, content: React.ReactNode, run: () => void) => {
    const active = editor.isActive(name)
    return <button type="button" className={active ? 'on' : ''} title={label} aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}><span className="glyph">{content}</span></button>
  }
  const fontName = fontNameOf(editor.getAttributes('textStyle').fontFamily as string | undefined) ?? settings.bodyFont
  const size = fontSizeOf(editor) === 11 && !editor.getAttributes('textStyle').fontSize ? settings.bodySize : fontSizeOf(editor)
  const align = (a: string) => editor.isActive({ textAlign: a })
  const lh = (editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').lineHeight as number | null) ?? 1.15
  const known = FONTS.some((f) => f.name === fontName)

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tgroup">
        {t('undo', 'Undo (Ctrl+Z)', 'undo', () => c().undo().run(), false, !editor.can().undo())}
        {t('redo', 'Redo (Ctrl+Y)', 'redo', () => c().redo().run(), false, !editor.can().redo())}
        {t('print', 'Print or save as PDF (Ctrl+P)', 'print', printDoc, false)}
      </div>
      <div className="tgroup">
        <select className="style-select" aria-label="Paragraph style" value={currentStyle(editor)} onChange={(e) => applyStyle(editor, e.target.value as StyleId)}>
          {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="font-select" aria-label="Font" value={fontName} onChange={(e) => c().setFontFamily(fontStack(e.target.value)).run()}>
          {!known && <option value={fontName}>{fontName}</option>}
          {FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: f.stack }}>{f.name}</option>)}
        </select>
        <div className="size-box">
          <button type="button" aria-label="Smaller text" title="Smaller (Ctrl+Shift+<)" onMouseDown={(e) => e.preventDefault()} onClick={() => stepFontSize(editor, settings.bodySize, -1)}><Icon name="minus" size={14} /></button>
          <input
            aria-label="Font size"
            inputMode="decimal"
            value={sizeText ?? String(size)}
            onChange={(e) => setSizeText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => { const v = parseFloat(sizeText ?? ''); if (sizeText !== null && v >= 1 && v <= 400) c().setFontSize(`${v}pt`).run(); setSizeText(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = parseFloat(sizeText ?? ''); if (v >= 1 && v <= 400) c().setFontSize(`${v}pt`).run(); setSizeText(null) } }}
          />
          <button type="button" aria-label="Larger text" title="Larger (Ctrl+Shift+>)" onMouseDown={(e) => e.preventDefault()} onClick={() => stepFontSize(editor, settings.bodySize, 1)}><Icon name="plus" size={14} /></button>
        </div>
      </div>
      <div className="tgroup">
        {glyph('bold', 'Bold (Ctrl+B)', 'B', () => c().toggleBold().run())}
        {glyph('italic', 'Italic (Ctrl+I)', <i>I</i>, () => c().toggleItalic().run())}
        {glyph('underline', 'Underline (Ctrl+U)', <u>U</u>, () => c().toggleUnderline().run())}
        {glyph('strike', 'Strikethrough', <s>S</s>, () => c().toggleStrike().run())}
        <ColorPop kind="text" />
        <ColorPop kind="highlight" />
      </div>
      <div className="tgroup">
        {t('link', 'Insert link (Ctrl+K)', 'link', () => dialog('link'))}
        {t('image', 'Insert picture', 'image', pickImage, false)}
        {t('table', 'Insert table', 'table', () => dialog('table'), false)}
      </div>
      <div className="tgroup">
        {t('', 'Align left (Ctrl+L)', 'left', () => c().setTextAlign('left').run(), align('left') || (!align('center') && !align('right') && !align('justify')))}
        {t('', 'Centre (Ctrl+E)', 'center', () => c().setTextAlign('center').run(), align('center'))}
        {t('', 'Align right (Ctrl+R)', 'right', () => c().setTextAlign('right').run(), align('right'))}
        {t('', 'Justify (Ctrl+J)', 'justify', () => c().setTextAlign('justify').run(), align('justify'))}
        <Pop title="Line and paragraph spacing" trigger={<Icon name="spacing" />}>
          {(close) => (
            <>
              {[1, 1.15, 1.5, 2, 2.5, 3].map((v) => <button key={v} type="button" className="menu-item" onClick={() => { c().setLineHeight(v === 1.15 ? null : v).run(); close() }}><span className="chk">{Math.abs(lh - v) < 0.01 ? '✓' : ''}</span>{v === 1.15 ? '1.15 (default)' : v.toFixed(1)}</button>)}
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { c().setSpacing({ before: 12 }).run(); close() }}>Add space before paragraph</button>
              <button type="button" className="menu-item" onClick={() => { c().setSpacing({ after: 0 }).run(); close() }}>Remove space after paragraph</button>
              <button type="button" className="menu-item" onClick={() => { close(); dialog('spacing') }}>Custom spacing…</button>
            </>
          )}
        </Pop>
      </div>
      <div className="tgroup">
        {t('bulletList', 'Bulleted list (Ctrl+Shift+8)', 'bullets', () => c().toggleBulletList().run())}
        {t('orderedList', 'Numbered list (Ctrl+Shift+7)', 'numbers', () => c().toggleOrderedList().run())}
        {t('taskList', 'Checklist (Ctrl+Shift+9)', 'check', () => c().toggleTaskList().run())}
        {t('', 'Decrease indent (Ctrl+[)', 'outdent', () => c().outdent().run(), false)}
        {t('', 'Increase indent (Ctrl+])', 'indent', () => c().indent().run(), false)}
        {t('', 'Clear formatting (Ctrl+\\)', 'clear', () => clearFormatting(ed()), false)}
      </div>
    </div>
  )
}
