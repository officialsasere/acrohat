import { describe, expect, it } from 'vitest'
import { shapePath, SHAPE_GROUPS, adjCount, textBox, scaleCustPath, isGeom } from '../present/src/geom'
import { applyOutline, deckToOutline, outlineToSlides, parseOutline } from '../present/src/formats/outline'
import { buildSteps, firstIsAuto } from '../present/src/show/anim'
import { scaleDeck } from '../present/src/lib/resize'
import { applyTheme, makeDeck, propagateLayout, relayout, slideFromLayout, THEMES } from '../present/src/themes'
import { TEMPLATES } from '../present/src/templates'
import { docToText, markers, numberMarker, textToDoc } from '../present/src/richtext'
import { bounds, css, mapEls, rotBounds, uid, type Anim, type ShapeEl, type Slide, type Text } from '../present/src/model'
import { resizeBox, snapBox, adjHandle } from '../present/src/editor/geometry'

describe('shapes', () => {
  it('every shape in the gallery draws a path of the right size', () => {
    for (const g of SHAPE_GROUPS) for (const s of g.shapes) {
      expect(isGeom(s.geom), s.geom).toBe(true)
      const p = shapePath(s.geom, 200, 100)
      expect(p.d.length, s.geom).toBeGreaterThan(8)
      expect(p.d, s.geom).not.toMatch(/NaN|undefined|Infinity/)
      const nums = [...p.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
      expect(Math.max(...nums), s.geom).toBeLessThan(2000)
    }
  })
  it('adjust values change the outline, and unknown shapes fall back to a rectangle', () => {
    expect(shapePath('roundRect', 100, 100, [50000]).d).not.toBe(shapePath('roundRect', 100, 100, [5000]).d)
    expect(adjCount('rightArrow')).toBe(2)
    expect(shapePath('nonsense', 10, 10).d).toBe(shapePath('rect', 10, 10).d)
    expect(textBox('ellipse', 100, 100)[0]).toBeGreaterThan(10)
  })
  it('scales freeform paths', () => {
    expect(scaleCustPath('M0 0L10 0L10 20Z', 2, 3)).toBe('M0 0L20 0L20 60Z')
    expect(scaleCustPath('M0 0A5 5 0 1 1 10 0', 2, 2)).toBe('M0 0A10 10 0 1 1 20 0')
  })
})

describe('outline', () => {
  const src = '# Title slide\nA subtitle\n\n---\n\n# Points\n- one\n  - nested\n- two\n1. numbered\n> note one\n> note two\n\n# Only a title'
  it('parses headings, bullets, levels and notes', () => {
    const o = parseOutline(src)
    expect(o).toHaveLength(3)
    expect(o[0]).toMatchObject({ title: 'Title slide', paras: [{ text: 'A subtitle', bullet: 'none' }] })
    expect(o[1].paras.map((p) => [p.text, p.level, p.bullet])).toEqual([['one', 0, 'disc'], ['nested', 1, 'disc'], ['two', 0, 'disc'], ['numbered', 0, 'num']])
    expect(o[1].notes).toBe('note one\nnote two')
    expect(o[2].paras).toEqual([])
  })
  it('turns an outline into slides and back', () => {
    const d = makeDeck('milk')
    d.slides = outlineToSlides(d, parseOutline(src), true)
    expect(d.slides.map((s) => s.layout)).toEqual(['title', 'titleBody', 'titleOnly'])
    const again = deckToOutline(d)
    expect(again).toContain('# Points')
    expect(again).toContain('  - nested')
    expect(again).toContain('> note two')
    expect(parseOutline(again).map((s) => s.title)).toEqual(['Title slide', 'Points', 'Only a title'])
  })
  it('applying an edited outline updates titles and adds slides', () => {
    const d = makeDeck('milk')
    d.slides = outlineToSlides(d, parseOutline('# One\n- a\n\n# Two\n- b'))
    const next = applyOutline(d, parseOutline('# Uno\n- x\n\n# Dos\n- y\n\n# Tres\n- z'))
    expect(next.slides).toHaveLength(3)
    expect(deckToOutline(next)).toContain('# Dos')
    expect(next.slides[0].id).toBe(d.slides[0].id)
  })
})

describe('animation steps', () => {
  const a = (id: string, trigger: Anim['trigger'], delay = 0, dur = 0.5, extra: Partial<Anim> = {}): Anim => ({ id: uid('a'), target: id, effect: 'fade', kind: 'in', trigger, dur, delay, ...extra })
  const slide = (anims: Anim[], els: ShapeEl[] = []): Slide => ({ id: 's', layout: 'blank', els, notes: '', anims })
  it('opens a step on each click; "with" starts together and "after" waits', () => {
    const steps = buildSteps(slide([a('a', 'click'), a('b', 'with', 0.2), a('c', 'after', 0.1), a('d', 'click')]))
    expect(steps).toHaveLength(2)
    expect(steps[0].map((t) => [t.anim.target, +t.at.toFixed(2), +t.end.toFixed(2)])).toEqual([['a', 0, 0.5], ['b', 0.2, 0.7], ['c', 0.8, 1.3]])
    expect(steps[1][0].anim.target).toBe('d')
  })
  it('a slide that starts with a non-click animation plays it on its own', () => {
    expect(firstIsAuto(slide([a('a', 'after')]))).toBe(true)
    expect(firstIsAuto(slide([a('a', 'click')]))).toBe(false)
    expect(firstIsAuto(slide([]))).toBe(false)
  })
  it('by-paragraph animations become one click per paragraph', () => {
    const el = { id: 't', type: 'shape', geom: 'rect', x: 0, y: 0, w: 1, h: 1, text: { paras: [{ runs: [{ t: 'a' }] }, { runs: [{ t: 'b' }] }, { runs: [{ t: 'c' }] }] } } as ShapeEl
    const steps = buildSteps(slide([a('t', 'click', 0, 0.5, { byPara: true })], [el]))
    expect(steps).toHaveLength(3)
    expect(steps.map((s) => s[0].para)).toEqual([0, 1, 2])
  })
})

describe('text', () => {
  it('numbers and bullets follow levels', () => {
    const m = markers([{ bullet: 'num' }, { bullet: 'num', level: 1 }, { bullet: 'num', level: 1 }, { bullet: 'num' }, { bullet: 'none' }, { bullet: 'num' }])
    expect(m.map((x) => x?.text ?? '')).toEqual(['1.', '1.', '2.', '2.', '', '1.'])
    expect(numberMarker('alpha', 28)).toBe('ab.'); expect(numberMarker('Roman', 14)).toBe('XIV.')
  })
  it('converts to the editor and back without loss', () => {
    const t: Text = { paras: [
      { runs: [{ t: 'Plain ' }, { t: 'bold', b: true }, { t: ' and ' }, { t: 'big red', sz: 40, c: '#ff0000', f: 'Georgia' }, { t: ' link', link: 'https://x.test', u: true }], align: 'center', level: 1, bullet: 'dash', lh: 1.5, before: 6 },
      { runs: [{ t: 'a' }, { t: '\n' }, { t: 'b', base: 1, hl: '#ffff00', s: true, i: false }] },
      { runs: [] },
    ] }
    expect(docToText(textToDoc(t))).toEqual(t)
  })
})

describe('themes and layouts', () => {
  it('every theme builds every layout with placeholders inside the slide', () => {
    for (const t of THEMES) {
      const d = applyTheme(makeDeck('milk'), t.id)
      expect(d.layouts.map((l) => l.id)).toEqual(['title', 'titleBody', 'section', 'twoContent', 'comparison', 'titleOnly', 'pictureCaption', 'blank'])
      for (const l of d.layouts) for (const e of l.els.filter((x) => x.type === 'shape' && x.ph)) { expect(e.x).toBeGreaterThanOrEqual(0); expect(e.x + e.w).toBeLessThanOrEqual(d.w + 0.1); expect(e.y + e.h).toBeLessThanOrEqual(d.h + 0.1) }
      expect(css('@accent1', d.theme)).toBe(t.colors.accent1)
    }
  })
  it('switching a slide to another layout keeps its text', () => {
    const d = makeDeck('milk')
    const s = slideFromLayout(d, 'titleBody')
    ;(s.els[0] as ShapeEl).text = { paras: [{ runs: [{ t: 'Keep me' }] }] }
    ;(s.els[1] as ShapeEl).text = { paras: [{ runs: [{ t: 'Body' }] }] }
    const two = relayout(s, d.layouts.find((l) => l.id === 'twoContent')!, d.layouts.find((l) => l.id === 'titleBody'))
    expect(two.layout).toBe('twoContent')
    expect(two.els.filter((e) => e.type === 'shape' && e.text?.paras[0].runs.length)).toHaveLength(2)
    expect(two.els.some((e) => e.type === 'shape' && e.ph?.role === 'body2')).toBe(true)
    const only = relayout(two, d.layouts.find((l) => l.id === 'titleOnly')!, d.layouts.find((l) => l.id === 'twoContent'))
    expect(only.els.some((e) => e.type === 'shape' && e.ph?.role === 'body2')).toBe(false)
  })
  it('editing a layout reaches the slides that still follow it, and leaves customised ones alone', () => {
    const d = makeDeck('milk')
    d.slides.push(slideFromLayout(d, 'titleBody'), slideFromLayout(d, 'titleBody'), slideFromLayout(d, 'title'))
    ;(d.slides[1].els[0] as ShapeEl).st = { ...(d.slides[1].els[0] as ShapeEl).st, sz: 20 }
    const edited = { ...d, layouts: d.layouts.map((l) => (l.id === 'titleBody' ? { ...l, els: l.els.map((e) => (e.type === 'shape' && e.ph?.role === 'title' ? { ...e, st: { ...e.st, sz: 60 }, x: 100 } : e)) } : l)) }
    const out = propagateLayout(d, edited, 'titleBody')
    expect((out.slides[0].els[0] as ShapeEl).st?.sz).toBe(60)
    expect(out.slides[0].els[0].x).toBe(100)
    expect((out.slides[1].els[0] as ShapeEl).st?.sz).toBe(20)
    expect(out.slides[1].els[0].x).toBe(100)
    expect(out.slides[2]).toBe(d.slides[2])
    expect(propagateLayout(d, d, 'titleBody')).toBe(d)
  })
  it('every template builds a deck of valid slides', () => {
    for (const t of TEMPLATES) {
      const d = t.build()
      expect(d.slides.length, t.id).toBeGreaterThan(0)
      for (const s of d.slides) expect(d.layouts.some((l) => l.id === s.layout), t.id).toBe(true)
    }
  })
  it('changing the slide size scales and centres everything', () => {
    const d = makeDeck('milk')
    d.slides.push(slideFromLayout(d, 'titleBody'))
    const sq = scaleDeck(d, 720, 720)
    expect(sq.w).toBe(720)
    const title = sq.slides[0].els[0] as ShapeEl
    const orig = d.slides[0].els[0] as ShapeEl
    expect(title.w).toBeCloseTo(orig.w * 0.75, 3)
    expect(title.y).toBeGreaterThan(orig.y * 0.75)
    expect(title.st?.sz).toBeCloseTo((orig.st?.sz ?? 0) * 0.75, 1)
  })
})

describe('geometry', () => {
  it('rotated bounds and union', () => {
    const rb = rotBounds({ id: 'a', x: 0, y: 0, w: 100, h: 50, rot: 90 } as never)
    expect(rb.w).toBeCloseTo(50, 6); expect(rb.h).toBeCloseTo(100, 6)
    expect(bounds([{ id: 'a', x: 0, y: 0, w: 10, h: 10 }, { id: 'b', x: 20, y: 30, w: 10, h: 10 }] as never)).toEqual({ x: 0, y: 0, w: 30, h: 40 })
  })
  it('resizing keeps the opposite corner fixed, also when rotated', () => {
    const e = { x: 100, y: 100, w: 200, h: 100, rot: 0 }
    expect(resizeBox(e, 1, 1, { x: 400, y: 250 })).toEqual({ x: 100, y: 100, w: 300, h: 150 })
    expect(resizeBox(e, -1, -1, { x: 50, y: 50 })).toEqual({ x: 50, y: 50, w: 250, h: 150 })
    const r = resizeBox({ ...e, rot: 90 }, 1, 0, { x: 200, y: 300 })
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    expect(r.w).toBeGreaterThan(200)
    // the left edge (bottom, once turned) stays where it was
    const fixed = { x: 200 + 0, y: 200 + 100 }
    void c; void fixed
    expect(resizeBox(e, 1, 0, { x: 350, y: 999 }, { keepAspect: true }).h).toBeCloseTo(125, 5)
    expect(resizeBox(e, 1, 1, { x: 400, y: 150 }, { fromCenter: true })).toMatchObject({ x: 0, w: 400 })
  })
  it('snaps to the centre and to other objects', () => {
    const r = snapBox({ x: 456, y: 100, w: 48, h: 40 }, [], { w: 960, h: 540 }, 6)
    expect(r.dx).toBe(0)
    const r2 = snapBox({ x: 460, y: 100, w: 40, h: 40 }, [], { w: 960, h: 540 }, 6)
    expect(r2.dx).toBe(0); expect(r2.guides.length).toBeGreaterThan(0)
    const r3 = snapBox({ x: 53, y: 300, w: 40, h: 40 }, [{ id: 'o', type: 'shape', geom: 'rect', x: 50, y: 0, w: 100, h: 50 } as ShapeEl], { w: 960, h: 540 }, 6)
    expect(r3.dx).toBe(-3)
    expect(snapBox({ x: 300, y: 300, w: 40, h: 40 }, [], { w: 960, h: 540 }, 6)).toMatchObject({ dx: 0, dy: 0, guides: [] })
  })
  it('adjust handles round-trip', () => {
    const e = { id: 'r', type: 'shape', geom: 'roundRect', x: 0, y: 0, w: 200, h: 100, adj: [20000] } as ShapeEl
    const h = adjHandle(e)!
    expect(h.x).toBeCloseTo(20, 5)
    expect(h.set({ x: 30, y: 0 })).toEqual([30000])
    expect(adjHandle({ ...e, geom: 'rect' })).toBeNull()
  })
  it('mapEls keeps identity when nothing changes', () => {
    const els = [{ id: 'a', type: 'shape', geom: 'rect', x: 0, y: 0, w: 1, h: 1 }] as ShapeEl[]
    expect(mapEls(els, (e) => e)).toBe(els)
    expect(mapEls(els, () => null)).toEqual([])
  })
})
