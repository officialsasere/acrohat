import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { writePptx } from '../present/src/formats/pptxWrite'
import { readPptx } from '../present/src/formats/pptxRead'
import { makeDeck, slideFromLayout } from '../present/src/themes'
import { newShape, newTable, newTextBox, sampleChart } from '../present/src/insert'
import { uid, type ChartEl, type Deck, type ShapeEl, type TableEl } from '../present/src/model'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function sampleDeck(): Deck {
  const d = makeDeck('milk', 'Test deck')
  const s1 = slideFromLayout(d, 'title')
  const title = s1.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'title')!
  title.text = { ...title.text, paras: [{ runs: [{ t: 'Hello ' }, { t: 'world', b: true, c: '#cc0000' }, { t: ' link', link: 'https://example.com/x?a=1&b=2', u: true }] }] }
  s1.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'subtitle')!.text = { paras: [{ runs: [{ t: 'Sub <title> & more' }] }] }
  s1.notes = 'Say hello.\nSecond line'
  s1.trans = { kind: 'fade', dur: 0.7 }
  const s2 = slideFromLayout(d, 'titleBody')
  s2.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'title')!.text = { paras: [{ runs: [{ t: 'Points' }] }] }
  const body = s2.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'body')!
  body.text = { paras: [{ runs: [{ t: 'First' }] }, { runs: [{ t: 'Second' }], level: 1 }, { runs: [{ t: 'Numbered' }], bullet: 'num' }, { runs: [{ t: 'Big', sz: 40 }, { t: '\n' }, { t: 'after break' }] }] }
  const box = newTextBox(500, 400, 300, 60); box.text = { paras: [{ runs: [{ t: 'A text box' }] }] }
  const rect = newShape('roundRect', 60, 400, 200, 100); rect.adj = [30000]; rect.text = { paras: [{ runs: [{ t: 'Round' }] }] }; rect.shadow = { c: '#000000', blur: 6, dx: 3, dy: 3, a: 0.4 }
  const star = newShape('star5', 300, 400, 100, 100); star.fill = { t: 'grad', angle: 45, stops: [{ p: 0, c: '#ff0000' }, { p: 1, c: '#0000ff' }] }; star.rot = 20
  const line = { id: uid(), type: 'line' as const, kind: 'elbow' as const, x: 100, y: 300, w: 200, h: 50, line: { c: '@accent2', w: 3, dash: 'dash' as const, tail: 'triangle' as const } }
  const img = { id: uid(), type: 'image' as const, media: 'pic1', x: 700, y: 300, w: 80, h: 80, crop: { l: 0.1, t: 0, r: 0.1, b: 0 }, alt: 'A pixel' }
  d.media.pic1 = { mime: 'image/png', data: PNG }
  const grp = { id: uid(), type: 'group' as const, x: 500, y: 300, w: 120, h: 60, children: [{ ...newShape('rect', 500, 300, 50, 50), id: uid() }, { ...newShape('ellipse', 570, 310, 50, 50), id: uid() }] }
  s2.els.push(box, rect, star, line, img, grp)
  s2.anims = [{ id: uid('a'), target: box.id, effect: 'fly', kind: 'in', trigger: 'click', dur: 0.6, delay: 0, dir: 'left' }, { id: uid('a'), target: rect.id, effect: 'fade', kind: 'in', trigger: 'with', dur: 0.5, delay: 0.2 }]
  s2.hidden = true
  const s3 = slideFromLayout(d, 'titleOnly')
  const tbl: TableEl = newTable(3, 3, d)
  tbl.rows[0].cells.forEach((c, i) => { c.text = { paras: [{ runs: [{ t: `H${i}` }] }] } })
  tbl.rows[1].cells[0].text = { paras: [{ runs: [{ t: 'merged' }] }] }
  tbl.rows[1].cells[0].span = { c: 2, r: 1 }
  tbl.rows[1].cells[1].covered = true
  const ch: ChartEl = { id: uid(), type: 'chart', kind: 'column', grouping: 'stacked', ...sampleChart('column'), x: 60, y: 300, w: 400, h: 200, legend: 'bottom', labels: true, grid: true, title: 'Sales' }
  const pie: ChartEl = { id: uid(), type: 'chart', kind: 'pie', grouping: 'clustered', ...sampleChart('pie'), x: 480, y: 300, w: 300, h: 200, legend: 'right', labels: true, grid: false }
  s3.els.push(tbl, ch, pie)
  d.slides.push(s1, s2, s3)
  d.footer = { num: true, text: 'Footer', date: false }
  return d
}

const textOf = (e: ShapeEl | undefined) => e?.text?.paras.map((p) => p.runs.map((r) => r.t).join('')).join('\n')

describe('Kwiiva Present .pptx', () => {
  it('writes a package with all the parts', () => {
    const files = unzipSync(writePptx(sampleDeck()))
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'ppt/notesSlides/notesSlide1.xml', 'ppt/charts/chart1.xml', 'ppt/charts/chart2.xml', 'ppt/embeddings/workbook1.xlsx', 'ppt/media/image1.png']) expect(Object.keys(files), p).toContain(p)
    const slide2 = new TextDecoder().decode(files['ppt/slides/slide2.xml'])
    expect(slide2).toContain('prst="roundRect"')
    expect(slide2).toContain('<a:gd name="adj" fmla="val 30000"/>')
    expect(slide2).toContain('<p:timing>')
    expect(slide2).toContain('show="0"')
    expect(new TextDecoder().decode(files['ppt/slides/slide1.xml'])).toContain('Sub &lt;title&gt; &amp; more')
  })

  it('reopens its own file exactly', () => {
    const d = sampleDeck()
    const r = readPptx(writePptx(d), 'x.pptx')
    expect(JSON.parse(JSON.stringify(r.deck))).toEqual(JSON.parse(JSON.stringify(d)))
  })

  it('reads the standard parts when the Kwiiva copy is missing or stale', () => {
    const d = sampleDeck()
    const files = unzipSync(writePptx(d))
    delete files['kwiiva/deck.json']
    const r = readPptx(zipSync(files), 'plain.pptx').deck
    expect(r.slides).toHaveLength(3)
    expect(r.w).toBe(960); expect(r.h).toBe(540)
    const [a, b, c] = r.slides
    const t1 = a.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'title')
    expect(textOf(t1)).toBe('Hello world link')
    const runs = t1!.text!.paras[0].runs
    expect(runs.find((x) => x.t === 'world')).toMatchObject({ c: '#cc0000' })
    expect(runs.find((x) => x.t === ' link')?.link).toBe('https://example.com/x?a=1&b=2')
    expect(textOf(a.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'subtitle'))).toBe('Sub <title> & more')
    expect(a.notes).toBe('Say hello.\nSecond line')
    expect(a.trans?.kind).toBe('fade')
    expect(b.hidden).toBe(true)
    const body = b.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'body')!
    expect(body.text!.paras.map((p) => p.level ?? 0)).toEqual([0, 1, 0, 0])
    expect(body.text!.paras[2].bullet).toBe('num')
    expect(body.text!.paras[3].runs.map((x) => x.t)).toEqual(['Big', '\n', 'after break'])
    expect(body.text!.paras[3].runs[0].sz).toBe(40)
    const round = b.els.find((e): e is ShapeEl => e.type === 'shape' && e.geom === 'roundRect')!
    expect(round.adj).toEqual([30000]); expect(round.shadow?.blur).toBeCloseTo(6, 0)
    expect(round.x).toBeCloseTo(60, 1); expect(round.w).toBeCloseTo(200, 1)
    const star = b.els.find((e): e is ShapeEl => e.type === 'shape' && e.geom === 'star5')!
    expect(star.rot).toBeCloseTo(20, 1); expect(star.fill?.t).toBe('grad')
    expect(b.els.some((e) => e.type === 'line' && e.kind === 'elbow' && e.line.tail === 'triangle' && e.line.dash === 'dash')).toBe(true)
    const img = b.els.find((e) => e.type === 'image')
    expect(img && img.type === 'image' && img.crop?.l).toBeCloseTo(0.1, 3)
    expect(img?.alt).toBe('A pixel')
    expect(b.els.some((e) => e.type === 'group' && e.children.length === 2)).toBe(true)
    expect(b.anims.map((x) => [x.effect, x.trigger, x.dir ?? ''])).toEqual([['fly', 'click', 'left'], ['fade', 'with', '']])
    expect(b.anims[0].target).toBe(b.els.find((e) => e.type === 'shape' && textOf(e) === 'A text box')!.id)
    expect(b.anims[1].delay).toBeCloseTo(0.2, 2)
    const tbl = c.els.find((e): e is TableEl => e.type === 'table')!
    expect(tbl.cols).toHaveLength(3)
    expect(tbl.rows[0].cells[2].text.paras[0].runs[0].t).toBe('H2')
    expect(tbl.rows[1].cells[0].span).toEqual({ c: 2, r: 1 })
    expect(tbl.rows[1].cells[1].covered).toBe(true)
    const charts = c.els.filter((e): e is ChartEl => e.type === 'chart')
    expect(charts.map((x) => x.kind)).toEqual(['column', 'pie'])
    expect(charts[0].grouping).toBe('stacked'); expect(charts[0].title).toBe('Sales')
    expect(charts[0].cats).toEqual(['Q1', 'Q2', 'Q3', 'Q4']); expect(charts[0].series[1].vals).toEqual([2.4, 4.4, 1.8, 2.8])
    expect(charts[1].series[0].vals).toEqual([48, 27, 17, 8])
    expect(r.footer.num).toBe(true); expect(r.footer.text).toBe('Footer')
    expect(Object.keys(r.media).length).toBeGreaterThan(0)
    expect(r.layouts.map((l) => l.id)).toContain('titleBody')
  })

  it('rejects a file that is not a presentation', () => {
    expect(() => readPptx(strToU8('hello'), 'x.pptx')).toThrow(/not a \.pptx/)
    expect(() => readPptx(zipSync({ 'a.txt': strToU8('hi') }), 'x.pptx')).toThrow(/no presentation/)
  })

  const PYLIB = '/tmp/pplib'
  it.skipIf(!existsSync(PYLIB) || process.platform === 'win32')('opens in an independent reader (python-pptx)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kwp-'))
    const file = join(dir, 'a.pptx')
    writeFileSync(file, writePptx(sampleDeck()))
    const py = `
import sys, json
from pptx import Presentation
from pptx.util import Emu
p = Presentation(sys.argv[1])
out = {'w': p.slide_width, 'h': p.slide_height, 'slides': []}
for s in p.slides:
    shapes = []
    for sh in s.shapes:
        d = {'type': str(sh.shape_type), 'name': sh.name}
        if sh.has_text_frame: d['text'] = sh.text_frame.text
        if getattr(sh, 'has_chart', False) and sh.has_chart:
            ch = sh.chart
            d['chart'] = [[list(pl.categories), [list(se.values) for se in pl.series]] for pl in ch.plots]
        if getattr(sh, 'has_table', False) and sh.has_table:
            d['table'] = [[c.text for c in r.cells] for r in sh.table.rows]
        shapes.append(d)
    out['slides'].append({'layout': s.slide_layout.name, 'shapes': shapes, 'notes': s.notes_slide.notes_text_frame.text if s.has_notes_slide else ''})
print(json.dumps(out))
`
    const res = JSON.parse(execFileSync('/usr/bin/python3', ['-c', py, file], { env: { ...process.env, PYTHONPATH: PYLIB } }).toString())
    expect(res.w).toBe(960 * 12700); expect(res.h).toBe(540 * 12700)
    expect(res.slides).toHaveLength(3)
    expect(res.slides[0].notes).toBe('Say hello.\nSecond line')
    expect(res.slides[0].shapes.some((s: { text?: string }) => s.text === 'Hello world link')).toBe(true)
    const s3 = res.slides[2].shapes
    expect(s3.find((s: { table?: string[][] }) => s.table)?.table[0]).toEqual(['H0', 'H1', 'H2'])
    const charts = s3.filter((s: { chart?: unknown }) => s.chart)
    expect(charts).toHaveLength(2)
    expect(charts[0].chart[0][0]).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
    expect(res.slides[1].shapes.some((s: { text?: string }) => s.text === 'A text box')).toBe(true)
  })
})

describe('a .pptx made by another program', () => {
  const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'pptx-sample.pptx')))
  const { deck, notes } = readPptx(bytes, 'pptx-sample.pptx')
  it('reads size, slides, layouts and the theme', () => {
    expect(deck.w).toBeCloseTo(960, 0); expect(deck.h).toBeCloseTo(540, 0)
    expect(deck.slides).toHaveLength(4)
    expect(deck.layouts.length).toBeGreaterThan(5)
    expect(deck.layouts.map((l) => l.id)).toContain('titleOnly')
    expect(deck.theme.colors.accent1).toMatch(/^#[0-9a-f]{6}$/i)
    expect(notes).toEqual([])
  })
  it('takes placeholder frames and sizes from the layout and master', () => {
    const t = deck.slides[0].els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'title')!
    expect(textOf(t)).toBe('Fixture title')
    expect(t.w).toBeGreaterThan(300); expect(t.h).toBeGreaterThan(40)
    expect(t.x).toBeGreaterThanOrEqual(0)
    expect(t.st?.sz).toBeGreaterThan(30)
    expect(deck.slides[0].notes).toBe('Speaker note one')
    expect(textOf(deck.slides[0].els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'subtitle'))).toBe('A subtitle')
  })
  it('reads bullets, levels and run formatting', () => {
    const body = deck.slides[1].els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === 'body')!
    expect(body.text!.paras.map((p) => p.level ?? 0)).toEqual([0, 1, 0])
    expect(body.text!.paras[0].runs[0]).toMatchObject({ t: 'First point', b: true, sz: 30, c: '#c0392b' })
    expect(body.st?.bullet).toBe('disc')
    expect(deck.slides[1].els.some((e) => e.type === 'shape' && e.geom === 'roundRect' && e.fill?.t === 'solid')).toBe(true)
    expect(deck.slides[1].els.some((e) => e.type === 'shape' && e.geom === 'rightArrow')).toBe(true)
    expect(deck.slides[1].els.some((e) => e.type === 'image')).toBe(true)
    expect(deck.slides[1].els.some((e) => e.type === 'shape' && textOf(e) === 'A text box' && e.text?.paras[0].align === 'center')).toBe(true)
  })
  it('reads tables, charts and groups', () => {
    const els = deck.slides[2].els
    const tbl = els.find((e): e is TableEl => e.type === 'table')!
    expect(tbl.rows.map((r) => r.cells.map((c) => c.text.paras[0]?.runs[0]?.t ?? ''))[2]).toEqual(['r2c0', 'r2c1', 'r2c2'])
    expect(tbl.rows[1].cells[0].span).toEqual({ c: 2, r: 1 })
    const charts = els.filter((e): e is ChartEl => e.type === 'chart')
    expect(charts.map((c) => c.kind)).toEqual(['column', 'pie'])
    expect(charts[0].series.map((s) => s.name)).toEqual(['S1', 'S2'])
    expect(charts[0].series[1].vals).toEqual([4, 5, 6])
    expect(charts[1].title).toBe('Pie title'); expect(charts[1].legend).toBe('right')
    expect(deck.slides[3].els.some((e) => e.type === 'group' && e.children.length === 2)).toBe(true)
  })
  it('writes it again and reads that back', () => {
    const again = readPptx(writePptx(deck), 'again.pptx').deck
    expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(deck)))
  })
})
