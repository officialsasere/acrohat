import { useState } from 'react'
import { activeStyle, applyStyle, borders, currency, decimals, formatPainter, merge, percent, setBg, setColor, setFont, setFormat, setH, setSize, setV, setWrap, stepSize, toggle } from '../actions/format'
import { sortSelection, toggleFilter } from '../actions/data'
import { autoSum } from '../shortcuts'
import { BUILTIN_FORMATS, formatValue } from '../engine/numfmt'
import { FONTS } from '../../../shared/fonts'
import { useBook } from '../hooks'
import { useStore } from '../store'
import { freezeAtCursor, unfreeze, freeze } from '../actions/structure'
import { ColorGrid, Icon, Pop } from './ui'

export function Toolbar() {
  const book = useBook()
  useStore((s) => s.sel)
  const zoom = useStore((s) => s.zoom)
  const painter = useStore((s) => s.painter)
  const selectMode = useStore((s) => s.selectMode)
  const [sizeText, setSizeText] = useState<string | null>(null)
  useStore((s) => s.tick)
  const st = activeStyle()
  const sh = book.activeSheet
  const t = (title: string, icon: string, run: () => void, on = false, disabled = false) => (
    <button type="button" className={on ? 'on' : ''} title={title} aria-label={title} aria-pressed={on} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={run}><Icon name={icon} /></button>
  )
  const glyph = (title: string, content: React.ReactNode, run: () => void, on: boolean) => (
    <button type="button" className={on ? 'on' : ''} title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={run}><span className="glyph">{content}</span></button>
  )
  const fontName = st.font ?? 'Calibri'
  const size = st.size ?? 11
  const commitSize = () => { const v = parseFloat(sizeText ?? ''); if (sizeText !== null && v >= 4 && v <= 200) setSize(v); setSizeText(null) }
  const fmt = st.fmt ?? 'General'
  const fmtLabel = BUILTIN_FORMATS.find((f) => f.fmt === fmt)?.label ?? 'Custom'
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tgroup">
        {t('Undo (Ctrl+Z)', 'undo', () => { book.undo(); useStore.getState().bump() }, false, !book.canUndo)}
        {t('Redo (Ctrl+Y)', 'redo', () => { book.redo(); useStore.getState().bump() }, false, !book.canRedo)}
        {t('Print', 'print', () => void import('../lib/files').then((m) => m.printSheet()))}
        {t('Paint format', 'paint', () => (painter ? formatPainter(false) : formatPainter(true)), !!painter)}
        <select className="zoom-select" aria-label="Zoom" value={Math.round(zoom * 100)} onChange={(e) => useStore.setState({ zoom: Number(e.target.value) / 100 })}>
          {[50, 75, 90, 100, 125, 150, 200].map((z) => <option key={z} value={z}>{z}%</option>)}
          {![50, 75, 90, 100, 125, 150, 200].includes(Math.round(zoom * 100)) && <option value={Math.round(zoom * 100)}>{Math.round(zoom * 100)}%</option>}
        </select>
      </div>
      <div className="tgroup">
        {t('Format as currency', 'dollar', currency)}
        {t('Format as percent', 'percent', percent)}
        {t('Fewer decimal places', 'dec2', () => decimals(-1))}
        {t('More decimal places', 'dec1', () => decimals(1))}
        <Pop title="More formats" trigger={<span className="fmt-label">{fmtLabel}<Icon name="down" size={12} /></span>} panelClass="fmt-panel">
          {(close) => (
            <>
              {BUILTIN_FORMATS.map((f) => (
                <button key={f.fmt} type="button" className="menu-item" onClick={() => { setFormat(f.fmt); close() }}>
                  <span className="chk">{fmt === f.fmt ? '✓' : ''}</span>{f.label}<span className="key">{f.sample !== undefined ? formatValue(f.sample, f.fmt).text : ''}</span>
                </button>
              ))}
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { close(); useStore.setState({ dialog: 'format' }) }}>More formats…</button>
            </>
          )}
        </Pop>
      </div>
      <div className="tgroup">
        <select className="font-select" aria-label="Font" value={fontName} onChange={(e) => setFont(e.target.value)}>
          {FONTS.some((f) => f.name === fontName) ? null : <option>{fontName}</option>}
          {FONTS.map((f) => <option key={f.name}>{f.name}</option>)}
        </select>
        <div className="size-box">
          <button type="button" aria-label="Smaller text" onMouseDown={(e) => e.preventDefault()} onClick={() => stepSize(-1)}><Icon name="minus" size={14} /></button>
          <input aria-label="Font size" inputMode="decimal" value={sizeText ?? String(size)} onChange={(e) => setSizeText(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={commitSize} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitSize() } }} />
          <button type="button" aria-label="Larger text" onMouseDown={(e) => e.preventDefault()} onClick={() => stepSize(1)}><Icon name="plus" size={14} /></button>
        </div>
      </div>
      <div className="tgroup">
        {glyph('Bold (Ctrl+B)', 'B', () => toggle('bold'), !!st.bold)}
        {glyph('Italic (Ctrl+I)', <i>I</i>, () => toggle('italic'), !!st.italic)}
        {glyph('Underline (Ctrl+U)', <u>U</u>, () => toggle('underline'), !!st.underline)}
        {glyph('Strikethrough (Ctrl+5)', <s>S</s>, () => toggle('strike'), !!st.strike)}
        <Pop title="Text colour" trigger={<span className="with-bar"><Icon name="fontcolor" size={16} /><span style={{ background: st.color ?? '#000' }} /></span>}>
          {(close) => <ColorGrid value={st.color} none="Automatic" onPick={(c) => { setColor(c); close() }} />}
        </Pop>
        <Pop title="Fill colour" trigger={<span className="with-bar"><Icon name="fill" size={16} /><span style={{ background: st.bg ?? 'transparent', outline: st.bg ? undefined : '1px solid #bbb' }} /></span>}>
          {(close) => <ColorGrid value={st.bg} none="No fill" onPick={(c) => { setBg(c); close() }} />}
        </Pop>
      </div>
      <div className="tgroup">
        <Pop title="Borders" trigger={<Icon name="borders" />}>
          {(close) => (
            <>
              {([['all', 'All borders'], ['outer', 'Outer borders'], ['inner', 'Inner borders'], ['top', 'Top border'], ['bottom', 'Bottom border'], ['left', 'Left border'], ['right', 'Right border'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['none', 'Clear borders']] as const).map(([k, label]) => (
                <button key={k} type="button" className="menu-item" onClick={() => { borders(k); close() }}>{label}</button>
              ))}
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { borders('outer', 'medium'); close() }}>Thick outer border</button>
              <button type="button" className="menu-item" onClick={() => { borders('all', 'dotted', '#888888'); close() }}>Dotted grid</button>
            </>
          )}
        </Pop>
        <Pop title="Merge cells" trigger={<Icon name="merge" />}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { merge('all'); close() }}>Merge all</button>
              <button type="button" className="menu-item" onClick={() => { merge('horizontal'); close() }}>Merge horizontally</button>
              <button type="button" className="menu-item" onClick={() => { merge('vertical'); close() }}>Merge vertically</button>
              <button type="button" className="menu-item" onClick={() => { merge('unmerge'); close() }}>Unmerge</button>
            </>
          )}
        </Pop>
      </div>
      <div className="tgroup">
        <Pop title="Horizontal align" trigger={<Icon name={st.h === 'center' ? 'center' : st.h === 'right' ? 'right' : 'left'} />}>
          {(close) => (
            <>
              {([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as const).map(([k, l]) => <button key={k} type="button" className="menu-item" onClick={() => { setH(k); close() }}><Icon name={k} size={16} />{l}</button>)}
              <button type="button" className="menu-item" onClick={() => { setH(undefined); close() }}>Default (text left, numbers right)</button>
            </>
          )}
        </Pop>
        <Pop title="Vertical align" trigger={<Icon name={st.v === 'top' ? 'top' : st.v === 'middle' ? 'middle' : 'bottom'} />}>
          {(close) => (
            <>
              {([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] as const).map(([k, l]) => <button key={k} type="button" className="menu-item" onClick={() => { setV(k); close() }}><Icon name={k} size={16} />{l}</button>)}
            </>
          )}
        </Pop>
        <Pop title="Text wrapping" trigger={<Icon name="wrap" />}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { setWrap(false); close() }}><span className="chk">{!st.wrap ? '✓' : ''}</span>Overflow</button>
              <button type="button" className="menu-item" onClick={() => { setWrap(true); close() }}><span className="chk">{st.wrap === true ? '✓' : ''}</span>Wrap</button>
              <button type="button" className="menu-item" onClick={() => { setWrap('clip'); close() }}><span className="chk">{st.wrap === 'clip' ? '✓' : ''}</span>Clip</button>
              <div className="menu-sep" />
              {[['Rotate up (45°)', 45], ['Rotate down (−45°)', -45], ['Vertical (90°)', 90], ['No rotation', 0]].map(([l, d]) => <button key={l as string} type="button" className="menu-item" onClick={() => { applyStyle({ rotate: (d as number) || undefined }); close() }}>{l}</button>)}
            </>
          )}
        </Pop>
      </div>
      <div className="tgroup">
        {t('Insert link (Ctrl+K)', 'link', () => useStore.setState({ dialog: 'link' }))}
        {t('Insert note', 'note', () => useStore.setState({ dialog: 'note' }))}
        {t('Insert chart', 'chart', () => useStore.setState({ dialog: 'chart' }))}
        {t('Create a filter', 'filter', toggleFilter, !!sh.filter)}
        <Pop title="Functions" trigger={<span className="fmt-label"><Icon name="sum" />∑<Icon name="down" size={12} /></span>}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { autoSum(); close() }}>SUM<span className="key">Alt+=</span></button>
              {['AVERAGE', 'COUNT', 'MAX', 'MIN'].map((f) => <button key={f} type="button" className="menu-item" onClick={() => { insertFn(f); close() }}>{f}</button>)}
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={() => { close(); useStore.setState({ dialog: 'function' }) }}>All functions…</button>
            </>
          )}
        </Pop>
        <Pop title="Freeze panes" trigger={<Icon name="freeze" />}>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { freeze(1, sh.frozenCols); close() }}>1 row</button>
              <button type="button" className="menu-item" onClick={() => { freeze(sh.frozenRows, 1); close() }}>1 column</button>
              <button type="button" className="menu-item" onClick={() => { freeze(2, sh.frozenCols); close() }}>2 rows</button>
              <button type="button" className="menu-item" onClick={() => { freezeAtCursor(); close() }}>Up to the cursor</button>
              <button type="button" className="menu-item" onClick={() => { unfreeze(); close() }}>No frozen rows or columns</button>
            </>
          )}
        </Pop>
        {t('Sort A → Z', 'sort', () => sortSelection(true))}
        <button type="button" className={'only-mobile' + (selectMode ? ' on' : '')} title="Select several cells by dragging" aria-pressed={selectMode} onClick={() => useStore.setState((s) => ({ selectMode: !s.selectMode }))}><Icon name="pointer" /></button>
      </div>
    </div>
  )
}

function insertFn(name: string) {
  const s = useStore.getState()
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const col = (c: number) => { let t = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) t = String.fromCharCode(65 + ((n - 1) % 26)) + t; return t }
  const rangeTxt = g.r1 === g.r2 && g.c1 === g.c2 ? '' : `${col(g.c1)}${g.r1 + 1}:${col(g.c2)}${g.r2 + 1}`
  void import('../actions/edit').then((m) => m.startEdit({ text: `=${name}(${rangeTxt})`, mode: 'edit', caret: name.length + 2 + rangeTxt.length }))
}
