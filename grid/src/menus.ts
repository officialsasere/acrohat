import { clearSelection } from './actions/edit'
import { copy } from './actions/clipboard'
import { clearFormats } from './actions/format'
import { fillDown, fillRight, sortSelection, toggleFilter, trimSpaces } from './actions/data'
import { deleteCols, deleteRows, hideCols, hideRows, insertCols, insertRows, unhideAround, autofitCols, autofitRows } from './actions/structure'
import { useStore, type MenuItem } from './store'

const dlg = (d: Parameters<typeof useStore.setState>[0] extends infer T ? T : never) => d
void dlg
const open = (d: NonNullable<ReturnType<typeof useStore.getState>['dialog']>, arg?: unknown) => useStore.setState({ dialog: d, dialogArg: arg })

/** The right-click menu for cells, row headings and column headings. */
export function openContextMenu(x: number, y: number, kind: 'cells' | 'rows' | 'cols') {
  const s = useStore.getState()
  const g = s.sel.ranges[s.sel.ranges.length - 1]
  const cut = () => void copy(true), cp = () => void copy(false)
  const pasteAction = async () => {
    try { const text = await navigator.clipboard.readText(); const dt = new DataTransfer(); dt.setData('text/plain', text); const m = await import('./actions/clipboard'); m.paste({ clipboardData: dt }) }
    catch { s.toast('info', 'Use Ctrl+V (or ⌘V) to paste: the browser does not let the menu read your clipboard.') }
  }
  const common: MenuItem[] = [
    { label: 'Cut', key: 'Ctrl+X', run: cut },
    { label: 'Copy', key: 'Ctrl+C', run: cp },
    { label: 'Paste', key: 'Ctrl+V', run: () => void pasteAction() },
    { label: 'Paste special…', run: () => open('pasteSpecial') },
    'sep',
  ]
  let items: MenuItem[]
  if (kind === 'rows') {
    const n = g.r2 - g.r1 + 1
    items = [...common,
      { label: `Insert ${n} row${n > 1 ? 's' : ''} above`, run: () => insertRows('above') },
      { label: `Insert ${n} row${n > 1 ? 's' : ''} below`, run: () => insertRows('below') },
      { label: `Delete row${n > 1 ? 's' : ''}`, run: deleteRows },
      { label: 'Clear contents', run: () => clearSelection('contents') },
      'sep',
      { label: 'Hide rows', run: () => hideRows(true) },
      { label: 'Show hidden rows', run: unhideAround },
      { label: 'Row height…', run: () => open('rowCol', 'row') },
      { label: 'Fit to data', run: () => autofitRows(g.r1, g.r2) },
    ]
  } else if (kind === 'cols') {
    const n = g.c2 - g.c1 + 1
    items = [...common,
      { label: `Insert ${n} column${n > 1 ? 's' : ''} left`, run: () => insertCols('left') },
      { label: `Insert ${n} column${n > 1 ? 's' : ''} right`, run: () => insertCols('right') },
      { label: `Delete column${n > 1 ? 's' : ''}`, run: deleteCols },
      { label: 'Clear contents', run: () => clearSelection('contents') },
      'sep',
      { label: 'Hide columns', run: () => hideCols(true) },
      { label: 'Show hidden columns', run: unhideAround },
      { label: 'Column width…', run: () => open('rowCol', 'col') },
      { label: 'Fit to data', run: () => autofitCols(g.c1, g.c2) },
      'sep',
      { label: 'Sort A → Z', run: () => sortSelection(true) },
      { label: 'Sort Z → A', run: () => sortSelection(false) },
    ]
  } else {
    items = [...common,
      { label: 'Insert cells…', run: () => open('insertCells', 'insert') },
      { label: 'Delete cells…', run: () => open('insertCells', 'delete') },
      { label: 'Clear contents', key: 'Del', run: () => clearSelection('contents') },
      { label: 'Clear formatting', run: clearFormats },
      'sep',
      { label: 'Format cells…', key: 'Ctrl+1', run: () => open('format') },
      { label: 'Insert link…', key: 'Ctrl+K', run: () => open('link') },
      { label: 'Insert note…', run: () => open('note') },
      { label: 'Data validation…', run: () => open('validation') },
      { label: 'Conditional formatting…', run: () => open('cf') },
      'sep',
      { label: 'Sort A → Z', run: () => sortSelection(true) },
      { label: 'Sort Z → A', run: () => sortSelection(false) },
      { label: 'Create a filter', run: toggleFilter },
      { label: 'Fill down', key: 'Ctrl+D', run: fillDown },
      { label: 'Fill right', key: 'Ctrl+R', run: fillRight },
      { label: 'Trim extra spaces', run: trimSpaces },
      { label: 'Insert chart…', run: () => open('chart') },
    ]
  }
  // keep it on screen
  const w = 240, h = Math.min(window.innerHeight - 16, items.length * 30 + 16)
  useStore.setState({ menu: { x: Math.min(x, window.innerWidth - w - 8), y: Math.min(y, window.innerHeight - h - 8), items } })
}
