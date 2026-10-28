import { uid, type ChartEl, type ChartKind, type ImageEl, type MediaEl, type ShapeEl, type TableCell, type TableEl, type LineEl, type El, type Deck } from './model'
import { addEl, toast } from './actions'
import { setTargetEls, useStore, curSlide } from './store'

const S = () => useStore.getState()

export const TEXT_STYLE = { sz: 24, f: '+body', c: '@text', align: 'left' as const }

export function newTextBox(x: number, y: number, w = 320, h = 60): ShapeEl {
  return { id: uid(), type: 'shape', geom: 'rect', x, y, w, h, st: { ...TEXT_STYLE }, text: { paras: [{ runs: [] }], v: 'top', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'none' } }
}
export function newShape(geom: string, x: number, y: number, w: number, h: number): ShapeEl {
  const open = /Bracket|Brace|^arc$/.test(geom)
  return {
    id: uid(), type: 'shape', geom, x, y, w, h,
    fill: open ? undefined : { t: 'solid', c: '@accent1' },
    line: { c: open ? '@accent1' : '@accent1', w: open ? 2.25 : 0 },
    st: { sz: 20, f: '+body', c: '#ffffff', align: 'center' },
    text: { paras: [{ runs: [] }], v: 'middle', inset: [7.2, 3.6, 7.2, 3.6], wrap: true, fit: 'none' },
  }
}
export function newLine(kind: LineEl['kind'], x1: number, y1: number, x2: number, y2: number, arrow = false): LineEl {
  const x = Math.min(x1, x2), y = Math.min(y1, y2)
  return { id: uid(), type: 'line', kind, x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), flipH: x2 < x1 || undefined, flipV: y2 < y1 || undefined, line: { c: '@accent1', w: 2.25, tail: arrow ? 'triangle' : 'none' } }
}

const mid = (n: number, size: number) => Math.round((n - size) / 2)

export function insertTextBox() {
  const d = S().deck
  addEl(newTextBox(mid(d.w, 320), mid(d.h, 60)))
  useStore.setState((s) => ({ editing: { id: s.sel[0] } }))
}
export function insertShape(geom: string) {
  const d = S().deck
  const wide = /Arrow|chevron|homePlate|Callout|wave|flowChart|rect|Rect|frame|plaque|snip|round/.test(geom) && !/^up|^down/.test(geom)
  const w = wide ? 220 : 160, h = wide ? 120 : 160
  addEl(newShape(geom, mid(d.w, w), mid(d.h, h), w, h))
}
export function insertLine(kind: LineEl['kind'], arrow = false) {
  const d = S().deck
  addEl(newLine(kind, mid(d.w, 260), mid(d.h, 0), mid(d.w, 260) + 260, mid(d.h, 0) + (kind === 'straight' ? 0 : 80), arrow))
}

// ---------------------------------------------------------------- media

export function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f) })
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a picture this browser can read.')); i.src = src })
}
/** Pictures larger than this are scaled down so decks stay a reasonable size. */
const MAX_SIDE = 2400
export async function prepareImage(f: Blob, name?: string): Promise<{ data: string; mime: string; w: number; h: number; name?: string }> {
  let data = await readAsDataUrl(f)
  const mime = f.type || /^data:([^;]+)/.exec(data)?.[1] || 'image/png'
  const img = await loadImage(data)
  let w = img.naturalWidth || 400, h = img.naturalHeight || 300
  if (/svg/.test(mime)) { if (!img.naturalWidth) { w = 400; h = 300 } return { data, mime, w, h, name } }
  if (Math.max(w, h) > MAX_SIDE && !/gif/.test(mime)) {
    const k = MAX_SIDE / Math.max(w, h)
    const c = document.createElement('canvas')
    c.width = Math.round(w * k); c.height = Math.round(h * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const out = /png/.test(mime) ? 'image/png' : 'image/jpeg'
    data = c.toDataURL(out, 0.9)
    return { data, mime: out, w: c.width, h: c.height, name }
  }
  return { data, mime, w, h, name }
}

/** Put a picture on the current slide; an empty picture placeholder is filled first. */
export function placeImage(img: { data: string; mime: string; w: number; h: number; name?: string }) {
  const s = S()
  const media = uid('m')
  const slide = curSlide(s)
  const d = s.deck
  const slot = slide.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'picture' && !e.text?.paras.some((p) => p.runs.length))
  let el: ImageEl
  if (slot && s.target.kind === 'slide') {
    const k = Math.max(slot.w / img.w, slot.h / img.h)
    const vw = slot.w / (img.w * k), vh = slot.h / (img.h * k)
    el = { id: uid(), type: 'image', media, x: slot.x, y: slot.y, w: slot.w, h: slot.h, crop: { l: (1 - vw) / 2, r: (1 - vw) / 2, t: (1 - vh) / 2, b: (1 - vh) / 2 }, alt: img.name }
    s.commit('Insert picture', (dk) => ({ ...dk, media: { ...dk.media, [media]: { mime: img.mime, data: img.data, name: img.name } }, slides: dk.slides.map((x) => (x.id === slide.id ? { ...x, els: x.els.map((e) => (e.id === slot.id ? el : e)) } : x)) }), { sel: [el.id] })
    return el
  }
  const k = Math.min(1, (d.w * 0.7) / img.w, (d.h * 0.7) / img.h)
  const w = img.w * k, h = img.h * k
  el = { id: uid(), type: 'image', media, x: mid(d.w, w), y: mid(d.h, h), w, h, alt: img.name }
  s.commit('Insert picture', (dk) => setTargetEls({ ...dk, media: { ...dk.media, [media]: { mime: img.mime, data: img.data, name: img.name } } }, s.target, s.cur, (list) => [...list, el]), { sel: [el.id] })
  useStore.setState({ tool: { kind: 'select' } })
  return el
}
export async function insertImageFiles(files: Iterable<File>) {
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name)) { toast('error', `${f.name} is not a picture.`); continue }
    try { placeImage(await prepareImage(f, f.name.replace(/\.[^.]+$/, ''))) } catch (e) { toast('error', (e as Error).message) }
  }
}
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement('input')
    i.type = 'file'; i.accept = accept; i.multiple = multiple
    i.onchange = () => res([...(i.files ?? [])])
    i.oncancel = () => res([])
    i.click()
  })
}
export async function insertPictureFromDisk() { await insertImageFiles(await pickFiles('image/*', true)) }

export async function insertMediaFile(kind: 'video' | 'audio') {
  const [f] = await pickFiles(kind === 'video' ? 'video/*' : 'audio/*')
  if (!f) return
  if (f.size > 80 * 1024 * 1024) { toast('error', `${f.name} is ${(f.size / 1048576).toFixed(0)} MB. Files over 80 MB make a deck too heavy to keep in the browser; link a shorter clip.`); return }
  const data = await readAsDataUrl(f)
  const media = uid('m')
  const d = S().deck
  const w = kind === 'video' ? 480 : 120, h = kind === 'video' ? 270 : 80
  const el: MediaEl = { id: uid(), type: kind, media, x: mid(d.w, w), y: mid(d.h, h), w, h, alt: f.name }
  const s = S()
  s.commit('Insert ' + kind, (dk) => setTargetEls({ ...dk, media: { ...dk.media, [media]: { mime: f.type, data, name: f.name } } }, s.target, s.cur, (l) => [...l, el]), { sel: [el.id] })
}

// ---------------------------------------------------------------- tables and charts

export const emptyCell = (): TableCell => ({ text: { paras: [{ runs: [] }] } })
export function newTable(rows: number, cols: number, d: Deck): TableEl {
  const w = Math.min(d.w - 96, cols * 150), h = Math.min(d.h - 200, rows * 44)
  return {
    id: uid(), type: 'table', x: mid(d.w, w), y: Math.max(130, mid(d.h, h)), w, h,
    cols: Array.from({ length: cols }, () => w / cols),
    rows: Array.from({ length: rows }, () => ({ h: h / rows, cells: Array.from({ length: cols }, emptyCell) })),
    style: { header: true, banded: true, firstCol: false, color: '@accent1', borders: true },
  }
}
export function insertTable(rows: number, cols: number) { addEl(newTable(rows, cols, S().deck)); useStore.setState((s) => ({ editing: { id: s.sel[0], cell: { r: 0, c: 0 } } })) }

export function sampleChart(kind: ChartKind): Pick<ChartEl, 'cats' | 'series'> {
  if (kind === 'pie' || kind === 'doughnut') return { cats: ['Product', 'Services', 'Support', 'Other'], series: [{ name: 'Share', vals: [48, 27, 17, 8] }] }
  if (kind === 'scatter') return { cats: [], series: [{ name: 'Series 1', xs: [1, 2, 3, 4, 5, 6], vals: [2.1, 3.9, 6.2, 7.8, 10.1, 12.2] }, { name: 'Series 2', xs: [1, 2, 3, 4, 5, 6], vals: [1.5, 2.2, 3.1, 3.6, 4.4, 5] }] }
  if (kind === 'radar') return { cats: ['Speed', 'Quality', 'Cost', 'Support', 'Reach'], series: [{ name: 'Us', vals: [8, 7, 6, 9, 7] }, { name: 'Them', vals: [6, 8, 7, 5, 6] }] }
  return { cats: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'North', vals: [4.3, 2.5, 3.5, 4.5] }, { name: 'South', vals: [2.4, 4.4, 1.8, 2.8] }, { name: 'West', vals: [2, 2, 3, 5] }] }
}
export function insertChart(kind: ChartKind, grouping: ChartEl['grouping'] = 'clustered') {
  const d = S().deck
  const el: ChartEl = { id: uid(), type: 'chart', kind, grouping, ...sampleChart(kind), x: 120, y: 130, w: d.w - 240, h: d.h - 190, legend: 'bottom', labels: false, grid: true, title: undefined } as ChartEl
  addEl(el)
}

export function symbolToEditor(ch: string) {
  const ed = S().editor
  if (ed) ed.chain().focus().insertContent(ch).run()
  else toast('info', 'Click into a text box first, then insert the symbol.')
}

export type { El }
