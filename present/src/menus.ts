import { addSlide, align, copySel, cutSel, deleteSel, deleteSlides, distribute, duplicateSel, duplicateSlides, flip, group, lockSel, moveSlides, order, pasteEls, resetSlide, rotateBy, selectAll, selected, toggleHidden, ungroup, updateCur } from './actions'
import { copyFormat, pasteFormat } from './format'
import { insertChart, insertMediaFile, insertPictureFromDisk, insertShape, insertLine, insertTextBox } from './insert'
import { exportAs, newDeck, openFile, printDeck, save } from './lib/files'
import { startShow } from './show/start'
import { autosaveOn, setAutosave } from '../../shared/autosave'
import { curIndex, useStore, type Dialog, type FileKind, type MenuItem } from './store'

export type { MenuItem }
export type Item = MenuItem | { heading: string } | { label: string; sub: Item[] }
const mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
export const K = (s: string) => (mac ? s.replace('Ctrl+', '⌘').replace('Shift+', '⇧').replace('Alt+', '⌥') : s)
const S = () => useStore.getState()
export const dlg = (d: NonNullable<Dialog>, arg?: unknown) => () => useStore.setState({ dialog: d, dialogArg: arg })
const side = (v: 'format' | 'anim' | 'slide') => () => { const p = S().panels; useStore.setState({ panels: { ...p, side: p.side === v ? null : v } }) }
const panel = (k: 'slides' | 'notes' | 'grid' | 'guides' | 'snap' | 'rulers' | 'sorter') => () => { const p = S().panels; useStore.setState({ panels: { ...p, [k]: !p[k] } }) }
export const undo = () => S().undo()
export const redo = () => S().redo()

const FILES: { k: FileKind; label: string }[] = [
  { k: 'pptx', label: 'Presentation (.pptx)' }, { k: 'pdf', label: 'PDF (.pdf)' }, { k: 'png', label: 'This slide as a picture (.png)' }, { k: 'html', label: 'Web page you can present from (.html)' }, { k: 'md', label: 'Outline (.md)' }, { k: 'txt', label: 'Plain text (.txt)' },
]

export function menus(): { name: string; items: Item[] }[] {
  const s = S()
  const hasSel = s.sel.length > 0
  const sels = hasSel ? selected() : []
  return [
    { name: 'File', items: [
      { label: 'New presentation', run: () => { if (!s.file.dirty || window.confirm('This presentation has changes kept in Recent. Start a new one?')) newDeck() } },
      { label: 'Open…', key: K('Ctrl+O'), run: () => void openFile() },
      { label: 'Home (templates and recent)', run: () => useStore.setState({ screen: 'home' }) },
      { label: 'Import outline…', run: dlg('importOutline') },
      'sep',
{ label: 'Save automatically', checked: autosaveOn(), run: () => { setAutosave(!autosaveOn()); S().set({ tick: S().tick + 1 }) } },
      
            { label: 'Save', key: K('Ctrl+S'), run: () => void save() },
      { label: 'Save as…', key: K('Ctrl+Shift+S'), run: () => void save({ saveAs: true }) },
      { label: 'Download a copy as', sub: FILES.map((f): Item => ({ label: f.label, run: () => void exportAs(f.k) })) },
      { label: 'Export every slide as pictures…', run: dlg('exportImages') },
      { label: 'Print…', key: K('Ctrl+P'), run: printDeck },
      'sep',
      { label: 'Slide size…', run: dlg('size') },
      { label: 'Presentation settings…', run: dlg('footer') },
    ] },
    { name: 'Edit', items: [
      { label: 'Undo', key: K('Ctrl+Z'), disabled: !s.past.length, run: undo },
      { label: 'Redo', key: K('Ctrl+Y'), disabled: !s.future.length, run: redo },
      'sep',
      { label: 'Cut', key: K('Ctrl+X'), disabled: !hasSel, run: cutSel },
      { label: 'Copy', key: K('Ctrl+C'), disabled: !hasSel, run: copySel },
      { label: 'Paste', key: K('Ctrl+V'), run: () => { if (!pasteEls()) s.toast('info', 'Use Ctrl+V (or ⌘V) to paste text or pictures from other programs.') } },
      { label: 'Duplicate', key: K('Ctrl+D'), disabled: !hasSel, run: duplicateSel },
      { label: 'Delete', key: 'Del', disabled: !hasSel, run: deleteSel },
      'sep',
      { label: 'Copy formatting', disabled: !hasSel, run: copyFormat },
      { label: 'Paste formatting', run: pasteFormat },
      'sep',
      { label: 'Select all', key: K('Ctrl+A'), run: selectAll },
      { label: 'Find and replace…', key: K('Ctrl+F'), run: dlg('find') },
    ] },
    { name: 'View', items: [
      { label: 'Slide show from the start', key: 'F5', run: () => startShow(0) },
      { label: 'Slide show from this slide', key: K('Shift+F5'), run: () => startShow(curIndex()) },
      { label: 'Presenter view', run: () => startShow(curIndex(), true) },
      'sep',
      { label: 'Slide sorter', checked: s.panels.sorter, run: panel('sorter') },
      { label: 'Slide list', checked: s.panels.slides, run: panel('slides') },
      { label: 'Speaker notes', checked: s.panels.notes, run: panel('notes') },
      { label: 'Format pane', checked: s.panels.side === 'format', run: side('format') },
      { label: 'Animation pane', checked: s.panels.side === 'anim', run: side('anim') },
      'sep',
      { label: 'Grid', checked: s.panels.grid, run: panel('grid') },
      { label: 'Centre guides', checked: s.panels.guides, run: panel('guides') },
      { label: 'Snap to other shapes', checked: s.panels.snap, run: panel('snap') },
      'sep',
      { label: 'Fit to window', run: () => useStore.setState({ zoom: 'fit' }) },
      { label: 'Zoom in', run: () => useStore.setState({ zoom: Math.min(4, (typeof s.zoom === 'number' ? s.zoom : 1) * 1.2) }) },
      { label: 'Zoom out', run: () => useStore.setState({ zoom: Math.max(0.1, (typeof s.zoom === 'number' ? s.zoom : 1) / 1.2) }) },
      'sep',
      { label: 'Slide master', run: () => useStore.setState({ target: { kind: 'master' }, sel: [] }) },
      { label: 'Edit this slide’s layout', run: () => useStore.setState({ target: { kind: 'layout', id: s.deck.slides.find((x) => x.id === s.cur)?.layout ?? 'titleBody' }, sel: [] }) },
      'sep',
      { label: `Theme: ${s.theme}`, run: () => { const n = s.theme === 'system' ? 'light' : s.theme === 'light' ? 'dark' : 'system'; try { localStorage.setItem('kwiiva-present.theme', n) } catch { /* private mode */ } useStore.setState({ theme: n }) } },
    ] },
    { name: 'Insert', items: [
      { label: 'New slide', key: K('Ctrl+M'), run: () => addSlide() },
      { label: 'Duplicate slide', run: () => duplicateSlides() },
      'sep',
      { label: 'Text box', run: insertTextBox },
      { label: 'Shape…', run: dlg('shapes') },
      { label: 'Line', run: () => insertLine('straight') },
      { label: 'Arrow', run: () => insertLine('straight', true) },
      { label: 'Picture…', run: () => void insertPictureFromDisk() },
      { label: 'Table…', run: dlg('table') },
      { label: 'Chart…', run: dlg('chart') },
      { label: 'Video…', run: () => void insertMediaFile('video') },
      { label: 'Audio…', run: () => void insertMediaFile('audio') },
      'sep',
      { label: 'Link…', key: K('Ctrl+K'), run: dlg('link') },
      { label: 'Symbol…', run: dlg('shapes', 'symbols') },
      { label: 'Slide numbers, date and footer…', run: dlg('footer') },
    ] },
    { name: 'Format', items: [
      { label: 'Format pane', run: side('format') },
      'sep',
      { label: 'Bold', key: K('Ctrl+B'), run: () => void import('./format').then((m) => m.text.bold()) },
      { label: 'Italic', key: K('Ctrl+I'), run: () => void import('./format').then((m) => m.text.italic()) },
      { label: 'Underline', key: K('Ctrl+U'), run: () => void import('./format').then((m) => m.text.underline()) },
      'sep',
      { label: 'Order', sub: [
        { label: 'Bring to front', run: () => order('front') }, { label: 'Bring forward', run: () => order('forward') },
        { label: 'Send backward', run: () => order('backward') }, { label: 'Send to back', run: () => order('back') },
      ] },
      { label: 'Align', sub: [
        { label: 'Left', run: () => align('left') }, { label: 'Centre', run: () => align('center') }, { label: 'Right', run: () => align('right') },
        { label: 'Top', run: () => align('top') }, { label: 'Middle', run: () => align('middle') }, { label: 'Bottom', run: () => align('bottom') },
        { label: 'Distribute horizontally', run: () => distribute('h') }, { label: 'Distribute vertically', run: () => distribute('v') },
      ] },
      { label: 'Rotate', sub: [
        { label: 'Rotate right 90°', run: () => rotateBy(90) }, { label: 'Rotate left 90°', run: () => rotateBy(-90) },
        { label: 'Flip horizontally', run: () => flip('h') }, { label: 'Flip vertically', run: () => flip('v') },
      ] },
      { label: 'Group', key: K('Ctrl+G'), disabled: sels.length < 2, run: group },
      { label: 'Ungroup', key: K('Ctrl+Shift+G'), disabled: !sels.some((e) => e.type === 'group'), run: ungroup },
      { label: sels.length && sels.every((e) => e.locked) ? 'Unlock' : 'Lock', disabled: !hasSel, run: () => lockSel(!(sels.length && sels.every((e) => e.locked))) },
      { label: 'Size and position…', disabled: !hasSel, run: dlg('sizePos') },
      { label: 'Alt text…', disabled: !hasSel, run: dlg('altText') },
    ] },
    { name: 'Slide', items: [
      { label: 'New slide', run: () => addSlide() },
      { label: 'Layout…', run: side('slide') },
      { label: 'Reset slide', run: resetSlide },
      { label: 'Theme…', run: dlg('theme') },
      { label: 'Background…', run: dlg('background') },
      { label: 'Transition…', run: dlg('transition') },
      { label: 'Animations', run: side('anim') },
      'sep',
      { label: 'Hide or show slide', run: () => toggleHidden() },
      { label: 'Start a section here', run: () => updateCur((sl) => ({ section: sl.section === undefined ? 'New section' : undefined }), 'Section') },
      { label: 'Delete slide', run: () => deleteSlides() },
    ] },
    { name: 'Tools', items: [
      { label: 'Word count', run: dlg('wordCount') },
      { label: 'Outline…', run: dlg('outline') },
      'sep',
      { label: 'Keyboard shortcuts', run: dlg('shortcuts') },
      { label: 'Privacy', run: dlg('privacy') },
      { label: 'About Kwiiva Present', run: dlg('about') },
    ] },
  ]
}

/** Right-click menus. */
export function openContextMenu(x: number, y: number, kind: 'element' | 'slide' | 'slides') {
  const s = S()
  let items: MenuItem[]
  if (kind === 'element') {
    const sels = selected()
    items = [
      { label: 'Cut', key: K('Ctrl+X'), run: cutSel }, { label: 'Copy', key: K('Ctrl+C'), run: copySel }, { label: 'Paste', key: K('Ctrl+V'), run: () => void pasteEls() }, { label: 'Duplicate', key: K('Ctrl+D'), run: duplicateSel }, { label: 'Delete', key: 'Del', run: deleteSel, danger: true },
      'sep',
      { label: 'Bring to front', run: () => order('front') }, { label: 'Send to back', run: () => order('back') },
      { label: 'Group', run: group, disabled: sels.length < 2 }, { label: 'Ungroup', run: ungroup, disabled: !sels.some((e) => e.type === 'group') },
      'sep',
      { label: 'Link…', run: dlg('link') }, { label: 'Alt text…', run: dlg('altText') }, { label: 'Size and position…', run: dlg('sizePos') },
      { label: 'Format pane', run: side('format') },
    ]
    if (sels.length === 1 && sels[0].type === 'chart') items.splice(5, 0, { label: 'Edit chart data…', run: dlg('chartData') })
    if (sels.length === 1 && sels[0].type === 'image') items.splice(5, 0, { label: 'Crop…', run: dlg('crop') })
  } else if (kind === 'slide') {
    items = [
      { label: 'Paste', key: K('Ctrl+V'), run: () => void pasteEls() }, { label: 'New slide', run: () => addSlide() }, 'sep',
      { label: 'Background…', run: dlg('background') }, { label: 'Layout…', run: side('slide') }, { label: 'Reset slide', run: resetSlide },
      'sep', { label: 'Grid', checked: s.panels.grid, run: panel('grid') }, { label: 'Centre guides', checked: s.panels.guides, run: panel('guides') },
    ]
  } else {
    const ids = s.slideSel.length ? s.slideSel : [s.cur]
    const i = s.deck.slides.findIndex((sl) => sl.id === ids[0])
    items = [
      { label: 'New slide', run: () => addSlide(undefined, i + 1) }, { label: 'Duplicate slide', run: () => duplicateSlides(ids) }, { label: 'Delete slide', run: () => deleteSlides(ids), danger: true }, 'sep',
      { label: 'Move up', disabled: i <= 0, run: () => moveSlides(ids, i - 1) }, { label: 'Move down', disabled: i >= s.deck.slides.length - 1, run: () => moveSlides(ids, i + 2) },
      { label: 'Move to start', run: () => moveSlides(ids, 0) }, { label: 'Move to end', run: () => moveSlides(ids, s.deck.slides.length) }, 'sep',
      { label: 'Hide or show slide', run: () => toggleHidden(ids) }, { label: 'Transition…', run: dlg('transition') }, { label: 'Slide show from here', run: () => startShow(Math.max(0, i)) },
    ]
  }
  useStore.setState({ menu: { x, y, items } })
}
export { insertShape, insertChart }
