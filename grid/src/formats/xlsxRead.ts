import { strFromU8, unzipSync } from 'fflate'
import { parseRange } from '../engine/address'
import { Book } from '../engine/book'
import type { Border, CellStyle, CfRule, Sheet, Validation } from '../engine/model'
import { newSheet, newWorkbook } from '../engine/model'
import { shiftFormula } from '../engine/refactor'
import { XlErr, key, type ErrCode, type Rect } from '../engine/types'
import { attr, kid, kids, parseXml, type XEl } from './xml'
import { BUILTIN_FMT, INDEXED, THEME, colWidthToPx, ptToPx, tint } from './xlsxShared'

/** Newer functions are stored with a prefix; the app uses the plain names. */
const clean = (f: string) => f.replace(/_xl(?:fn|ws|pm)\./g, '')
const num = (s: string | undefined) => (s === undefined || s === '' ? undefined : Number(s))
const colIdx = (s: string) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }

/** Reads a .xlsx file into a workbook. */
export function readXlsx(bytes: Uint8Array, fileName = 'Spreadsheet'): Book {
  const zip = unzipSync(bytes)
  const text = (n: string) => (zip[n] ? strFromU8(zip[n]) : null)
  const xml = (n: string) => { const t = text(n); return t ? parseXml(t) : undefined }
  if (!zip['xl/workbook.xml']) throw new Error('This file is not a valid .xlsx spreadsheet.')
  const wbx = xml('xl/workbook.xml')!
  const relsOf = (part: string) => {
    const dir = part.slice(0, part.lastIndexOf('/') + 1), file = part.slice(part.lastIndexOf('/') + 1)
    const m = new Map<string, { target: string; type: string; external: boolean }>()
    for (const e of kids(xml(`${dir}_rels/${file}.rels`), 'Relationship')) m.set(e.attrs.Id, { target: e.attrs.TargetMode === 'External' ? e.attrs.Target : (e.attrs.Target.startsWith('/') ? e.attrs.Target.slice(1) : dir + e.attrs.Target), type: e.attrs.Type, external: e.attrs.TargetMode === 'External' })
    return m
  }
  const wbRels = relsOf('xl/workbook.xml')

  // ---- shared strings
  const sst: string[] = []
  const sstx = xml(wbRels.get([...wbRels.keys()].find((k) => wbRels.get(k)!.type.endsWith('/sharedStrings')) ?? '')?.target ?? 'xl/sharedStrings.xml')
  const si = (e: XEl): string => (kid(e, 't') ? kid(e, 't')!.text : kids(e, 'r').map((r) => kid(r, 't')?.text ?? '').join(''))
  for (const e of kids(sstx, 'si')) sst.push(si(e))

  // ---- theme colours
  const theme = xml('xl/theme/theme1.xml')
  const themeColors = [...THEME]
  const scheme = kid(kid(kid(theme, 'a:themeElements'), 'a:clrScheme'), 'a:lt1')
  if (scheme) {
    const order = ['a:lt1', 'a:dk1', 'a:lt2', 'a:dk2', 'a:accent1', 'a:accent2', 'a:accent3', 'a:accent4', 'a:accent5', 'a:accent6', 'a:hlink', 'a:folHlink']
    const cs = kid(kid(theme, 'a:themeElements'), 'a:clrScheme')
    order.forEach((n, i) => { const c = kid(cs, n)?.children[0]; const v = c?.attrs.val === 'windowText' ? '000000' : c?.attrs.val === 'window' ? 'FFFFFF' : c?.attrs.srgbClr ?? c?.attrs.lastClr ?? c?.attrs.val; if (v && /^[0-9A-Fa-f]{6}$/.test(v)) themeColors[i] = v.toUpperCase() })
    for (const [i, n] of order.entries()) { const c = kid(cs, n)?.children[0]; const v = c?.attrs.lastClr ?? c?.attrs.val; if (c && v && /^[0-9A-Fa-f]{6}$/.test(v)) themeColors[i] = v.toUpperCase() }
  }
  const color = (e: XEl | undefined): string | undefined => {
    if (!e) return undefined
    const rgb = attr(e, 'rgb'), th = attr(e, 'theme'), ix = attr(e, 'indexed'), t = Number(attr(e, 'tint') ?? 0)
    let hex: string | undefined
    if (rgb) hex = rgb.slice(-6)
    else if (th !== undefined) hex = themeColors[Number(th)] ?? '000000'
    else if (ix !== undefined) hex = INDEXED[Number(ix)] ?? '000000'
    if (!hex) return undefined
    return '#' + (t ? tint(hex, t) : hex).toLowerCase()
  }

  // ---- styles
  const stx = xml('xl/styles.xml')
  const fmts = new Map<number, string>()
  for (const e of kids(kid(stx, 'numFmts'), 'numFmt')) fmts.set(Number(e.attrs.numFmtId), e.attrs.formatCode)
  const fonts = kids(kid(stx, 'fonts'), 'font').map((f) => {
    const s: CellStyle = {}
    if (kid(f, 'b') && attr(kid(f, 'b'), 'val') !== '0') s.bold = true
    if (kid(f, 'i') && attr(kid(f, 'i'), 'val') !== '0') s.italic = true
    if (kid(f, 'strike') && attr(kid(f, 'strike'), 'val') !== '0') s.strike = true
    if (kid(f, 'u') && attr(kid(f, 'u'), 'val') !== 'none') s.underline = true
    const sz = num(attr(kid(f, 'sz'), 'val')); if (sz && sz !== 11) s.size = sz
    const col = color(kid(f, 'color')); if (col && col !== '#000000') s.color = col
    const nm = attr(kid(f, 'name'), 'val'); if (nm && nm !== 'Calibri') s.font = nm
    return s
  })
  const fills = kids(kid(stx, 'fills'), 'fill').map((f) => { const p = kid(f, 'patternFill'); return p && attr(p, 'patternType') === 'solid' ? color(kid(p, 'fgColor')) : undefined })
  const bside = (e: XEl | undefined): Border | undefined => {
    const st = attr(e, 'style'); if (!st) return undefined
    const map: Record<string, Border['style']> = { thin: 'thin', hair: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', mediumDashed: 'dashed', dotted: 'dotted', double: 'double', dashDot: 'dashed', dashDotDot: 'dashed' }
    return { style: map[st] ?? 'thin', color: color(kid(e, 'color')) ?? '#000000' }
  }
  const borders = kids(kid(stx, 'borders'), 'border').map((b) => ({ bl: bside(kid(b, 'left') ?? kid(b, 'start')), br: bside(kid(b, 'right') ?? kid(b, 'end')), bt: bside(kid(b, 'top')), bb: bside(kid(b, 'bottom')) }))
  const wbook = new Book(newWorkbook(fileName.replace(/\.[^.]+$/, '')))
  const xfs: number[] = kids(kid(stx, 'cellXfs'), 'xf').map((x) => {
    const s: CellStyle = { ...(fonts[Number(x.attrs.fontId ?? 0)] ?? {}) }
    const fid = Number(x.attrs.numFmtId ?? 0)
    const f = fmts.get(fid) ?? BUILTIN_FMT[fid]
    if (f && f !== 'General') s.fmt = f
    const bg = fills[Number(x.attrs.fillId ?? 0)]; if (bg) s.bg = bg
    const b = borders[Number(x.attrs.borderId ?? 0)]; if (b) Object.assign(s, Object.fromEntries(Object.entries(b).filter(([, v]) => v)))
    const al = kid(x, 'alignment')
    if (al) {
      const h = attr(al, 'horizontal'); if (h === 'left' || h === 'center' || h === 'right' || h === 'justify') s.h = h
      const v = attr(al, 'vertical'); if (v === 'top') s.v = 'top'; else if (v === 'center') s.v = 'middle'; else if (v === 'bottom') s.v = 'bottom'
      if (attr(al, 'wrapText') === '1') s.wrap = true
      const ind = num(attr(al, 'indent')); if (ind) s.indent = ind
      const rot = num(attr(al, 'textRotation')); if (rot) s.rotate = rot > 90 ? 90 - rot : rot
    }
    if (attr(kid(x, 'protection'), 'locked') === '0') s.locked = false
    return wbook.styles.intern(s)
  })
  const dxfs = kids(kid(stx, 'dxfs'), 'dxf').map((d) => {
    const s: CellStyle = {}
    const f = kid(d, 'font')
    if (f) { if (kid(f, 'b')) s.bold = true; if (kid(f, 'i')) s.italic = true; if (kid(f, 'strike')) s.strike = true; if (kid(f, 'u')) s.underline = true; const c = color(kid(f, 'color')); if (c) s.color = c }
    const bg = color(kid(kid(d, 'fill'), 'patternFill') ? kid(kid(kid(d, 'fill'), 'patternFill'), 'bgColor') : undefined) ?? color(kid(kid(kid(d, 'fill'), 'patternFill'), 'fgColor'))
    if (bg) s.bg = bg
    return s
  })

  // ---- workbook structure
  const sheetEls = kids(kid(wbx, 'sheets'), 'sheet')
  const props = kid(wbx, 'workbookPr')
  const date1904 = attr(props, 'date1904') === '1'
  let extras: { title?: string; sheets?: { name: string; charts?: Sheet['charts']; pictures?: Sheet['pictures']; cf?: CfRule[]; validations?: Validation[]; filter?: Sheet['filter']; notes?: { r: number; c: number; text: string }[] }[] } | null = null
  try { const t = text('xl/kwiiva-extras.json'); if (t) extras = JSON.parse(t) } catch { /* ignore a damaged extras part */ }
  const book = wbook
  book.wb.sheets = []
  book.wb.nextSheetId = 1
  const idByName = new Map<string, number>()
  for (const el of sheetEls) {
    const sh = newSheet(book.wb.nextSheetId++, attr(el, 'name') ?? `Sheet${book.wb.nextSheetId}`)
    if (attr(el, 'state') === 'hidden') sh.hidden = true
    book.wb.sheets.push(sh)
    idByName.set(sh.name, sh.id)
  }
  book.wb.active = book.wb.sheets[0]?.id ?? 1
  book.rebuild()

  book.load(() => {
    sheetEls.forEach((el, si_) => {
      const sh = book.wb.sheets[si_]
      const rel = wbRels.get(attr(el, 'id') ?? '')
      const root = rel ? xml(rel.target) : undefined
      if (!root) return
      const srels = relsOf(rel!.target)
      const fmt = kid(root, 'sheetFormatPr')
      const dh = num(attr(fmt, 'defaultRowHeight')); if (dh) sh.defaultRowH = Math.max(18, ptToPx(dh))
      const view = kid(kid(root, 'sheetViews'), 'sheetView')
      if (attr(view, 'showGridLines') === '0') sh.gridlines = false
      if (attr(view, 'tabSelected') === '1') book.wb.active = sh.id
      const pane = kid(view, 'pane')
      if (pane && attr(pane, 'state')?.startsWith('frozen')) { sh.frozenCols = num(attr(pane, 'xSplit')) ?? 0; sh.frozenRows = num(attr(pane, 'ySplit')) ?? 0 }
      const tc = color(kid(kid(root, 'sheetPr'), 'tabColor')); if (tc) sh.tabColor = tc
      for (const c of kids(kid(root, 'cols'), 'col')) {
        const min = Number(c.attrs.min) - 1, max = Math.min(Number(c.attrs.max) - 1, 300)
        const w = num(c.attrs.width)
        for (let i = min; i <= max; i++) { if (w !== undefined && c.attrs.customWidth !== '0') sh.colW.set(i, colWidthToPx(w)); if (c.attrs.hidden === '1') sh.hiddenCols.add(i) }
      }
      const shared = new Map<string, { f: string; r: number; c: number }>()
      // Array formulas store their results in every cell they cover; here the formula's own result fills them again.
      const arrays: Rect[] = []
      let maxR = 0, maxC = 0
      for (const row of kids(kid(root, 'sheetData'), 'row')) {
        const r = Number(row.attrs.r) - 1
        if (row.attrs.ht && row.attrs.customHeight === '1') sh.rowH.set(r, ptToPx(Number(row.attrs.ht)))
        if (row.attrs.hidden === '1') sh.hiddenRows.add(r)
        for (const c of kids(row, 'c')) {
          const m = /^([A-Z]+)(\d+)$/.exec(c.attrs.r)
          if (!m) continue
          const col = colIdx(m[1]), rr = Number(m[2]) - 1
          maxR = Math.max(maxR, rr); maxC = Math.max(maxC, col)
          const s = xfs[Number(c.attrs.s ?? 0)] ?? 0
          const t = c.attrs.t
          const fEl = kid(c, 'f'), vEl = kid(c, 'v')
          let f: string | undefined
          if (fEl) {
            const ft = attr(fEl, 'si'), kind = attr(fEl, 't')
            if (kind === 'shared' && ft !== undefined) {
              if (fEl.text) { shared.set(ft, { f: '=' + clean(fEl.text), r: rr, c: col }); f = '=' + clean(fEl.text) }
              else { const base = shared.get(ft); if (base) f = shiftFormula(base.f, rr - base.r, col - base.c) }
            } else if (fEl.text) f = '=' + clean(fEl.text)
            if (kind === 'array' && attr(fEl, 'ref')) { const p = parseRange(attr(fEl, 'ref')!); if (p && (p.r1 !== p.r2 || p.c1 !== p.c2)) arrays.push({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }) }
          }
          if (!f && arrays.some((a) => rr >= a.r1 && rr <= a.r2 && col >= a.c1 && col <= a.c2 && (rr !== a.r1 || col !== a.c1))) { if (s) book.setCellRaw(sh.id, rr, col, { v: null, s }); continue }
          let v: string | number | boolean | XlErr | null = null
          if (t === 's') v = sst[Number(vEl?.text)] ?? ''
          else if (t === 'str') v = vEl?.text ?? ''
          else if (t === 'inlineStr') v = si(kid(c, 'is') ?? c)
          else if (t === 'b') v = vEl?.text === '1'
          else if (t === 'e') v = new XlErr((vEl?.text as ErrCode) ?? '#VALUE!')
          else if (vEl && vEl.text !== '') { v = Number(vEl.text); if (date1904 && s) v += 1462 }
          if (f) { book.setCellRaw(sh.id, rr, col, { v: null, f, s }) }
          else if (v !== null || s) book.setCellRaw(sh.id, rr, col, { v, s })
        }
      }
      sh.rows = Math.max(sh.rows, maxR + 50); sh.cols = Math.max(sh.cols, maxC + 5)
      // merged cells
      for (const m of kids(kid(root, 'mergeCells'), 'mergeCell')) { const p = parseRange(m.attrs.ref); if (p) sh.merges.push({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }) }
      // hyperlinks
      for (const h of kids(kid(root, 'hyperlinks'), 'hyperlink')) {
        const p = parseRange(h.attrs.ref); if (!p) continue
        const target = srels.get(attr(h, 'id') ?? '')?.target ?? (attr(h, 'location') ? '#' + attr(h, 'location') : undefined)
        const cell = sh.cells.get(key(p.r1, p.c1))
        if (target && cell) cell.link = target
      }
      const af = kid(root, 'autoFilter')
      if (af && attr(af, 'ref')) { const p = parseRange(attr(af, 'ref')!); if (p) sh.filter = { range: { r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }, cols: {} } }
      if (kid(root, 'sheetProtection') && attr(kid(root, 'sheetProtection'), 'sheet') !== '0') sh.protected = true
      // conditional formats and validation
      for (const cf of kids(root, 'conditionalFormatting')) {
        const ranges = (cf.attrs.sqref ?? '').split(/\s+/).map((x) => parseRange(x)).filter((x): x is NonNullable<typeof x> => !!x).map((p) => ({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }))
        for (const rule of kids(cf, 'cfRule')) { const r = readCf(rule, ranges, dxfs, color); if (r) sh.cf.push(r) }
      }
      for (const dv of kids(kid(root, 'dataValidations'), 'dataValidation')) { const v = readValidation(dv); if (v) sh.validations.push(v) }
      // what only this app writes
      const ex = extras?.sheets?.find((x) => x.name === sh.name)
      if (ex) {
        if (ex.charts) sh.charts = ex.charts
        if (ex.pictures) sh.pictures = ex.pictures
        if (ex.cf) sh.cf = ex.cf
        if (ex.validations) sh.validations = ex.validations
        if (ex.filter) sh.filter = ex.filter
        for (const n of ex.notes ?? []) { const c = sh.cells.get(key(n.r, n.c)); if (c) c.note = n.text; else sh.cells.set(key(n.r, n.c), { v: null, s: 0, note: n.text }) }
      }
    })
    // defined names
    for (const n of kids(kid(wbx, 'definedNames'), 'definedName')) {
      const name = n.attrs.name
      if (!name || name.startsWith('_xlnm.') || !n.text) continue
      const local = n.attrs.localSheetId !== undefined ? book.wb.sheets[Number(n.attrs.localSheetId)]?.id : undefined
      book.wb.names.push({ name, ref: clean(n.text), scope: local })
    }
    if (extras?.title) book.wb.title = extras.title
  })
  book.wb.active = book.wb.sheets.some((s) => s.id === book.wb.active) ? book.wb.active : book.wb.sheets[0].id
  return book
}

function readCf(rule: XEl, ranges: Rect[], dxfs: CellStyle[], color: (e: XEl | undefined) => string | undefined): CfRule | null {
  const id = Math.random().toString(36).slice(2, 9)
  const type = rule.attrs.type
  const style = rule.attrs.dxfId !== undefined ? dxfs[Number(rule.attrs.dxfId)] : undefined
  const f = kids(rule, 'formula').map((x) => clean(x.text))
  const OPS: Record<string, string> = { greaterThan: '>', lessThan: '<', greaterThanOrEqual: '>=', lessThanOrEqual: '<=', equal: '=', notEqual: '<>', between: 'between', notBetween: 'notBetween' }
  const base = { id, ranges, style }
  switch (type) {
    case 'cellIs': return { ...base, type: 'cell', op: OPS[rule.attrs.operator] ?? '>', v1: f[0], v2: f[1] }
    case 'containsText': return { ...base, type: 'text', op: 'contains', v1: rule.attrs.text }
    case 'notContainsText': return { ...base, type: 'text', op: 'notContains', v1: rule.attrs.text }
    case 'beginsWith': return { ...base, type: 'text', op: 'begins', v1: rule.attrs.text }
    case 'endsWith': return { ...base, type: 'text', op: 'ends', v1: rule.attrs.text }
    case 'containsBlanks': return { ...base, type: 'blanks' }
    case 'notContainsBlanks': return { ...base, type: 'noblanks' }
    case 'containsErrors': return { ...base, type: 'errors' }
    case 'notContainsErrors': return { ...base, type: 'noerrors' }
    case 'duplicateValues': return { ...base, type: 'duplicates' }
    case 'uniqueValues': return { ...base, type: 'unique' }
    case 'top10': return { ...base, type: 'top', op: rule.attrs.bottom === '1' ? 'bottom' : 'top', n: Number(rule.attrs.rank ?? 10), percent: rule.attrs.percent === '1' }
    case 'aboveAverage': return { ...base, type: 'above', op: rule.attrs.aboveAverage === '0' ? 'below' : 'above' }
    case 'expression': return { ...base, type: 'formula', formula: '=' + (f[0] ?? 'FALSE') }
    case 'colorScale': {
      const cs = kid(rule, 'colorScale'); if (!cs) return null
      const vo = kids(cs, 'cfvo'), cols = kids(cs, 'color').map((c) => color(c) ?? '#ffffff')
      const spec = (i: number) => ({ type: (['min', 'max', 'num', 'percent', 'percentile'].includes(vo[i].attrs.type) ? vo[i].attrs.type : 'num') as 'min', value: vo[i].attrs.val !== undefined ? Number(vo[i].attrs.val) : undefined, color: cols[i] })
      return vo.length === 3 ? { id, ranges, type: 'scale', scale: { min: spec(0), mid: spec(1), max: spec(2) } } : { id, ranges, type: 'scale', scale: { min: spec(0), max: spec(1) } }
    }
    case 'dataBar': { const db = kid(rule, 'dataBar'); return { id, ranges, type: 'bar', bar: { color: color(kid(db, 'color')) ?? '#638ec6' } } }
  }
  return null
}

function readValidation(dv: XEl): Validation | null {
  const sq = (dv.attrs.sqref ?? '').split(/\s+/).map((x) => parseRange(x)).filter((x): x is NonNullable<typeof x> => !!x).map((p) => ({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }))
  const f1 = kid(dv, 'formula1')?.text, f2 = kid(dv, 'formula2')?.text
  const OPS: Record<string, Validation['op']> = { greaterThan: '>', lessThan: '<', greaterThanOrEqual: '>=', lessThanOrEqual: '<=', equal: '=', notEqual: '<>', between: 'between', notBetween: 'notBetween' }
  const base = { id: Math.random().toString(36).slice(2, 9), ranges: sq, allowBlank: dv.attrs.allowBlank !== '0', dropdown: dv.attrs.showDropDown !== '1', onInvalid: dv.attrs.errorStyle === 'warning' ? 'warning' as const : 'stop' as const, help: dv.attrs.error }
  const op = OPS[dv.attrs.operator ?? 'between']
  switch (dv.attrs.type) {
    case 'list': return f1 && /^".*"$/.test(f1) ? { ...base, type: 'list', list: f1.slice(1, -1).split(',') } : { ...base, type: 'listRange', v1: f1 }
    case 'whole': return { ...base, type: 'integer', op, v1: f1, v2: f2 }
    case 'decimal': return { ...base, type: 'number', op, v1: f1, v2: f2 }
    case 'date': return { ...base, type: 'date', op, v1: f1, v2: f2 }
    case 'textLength': return { ...base, type: 'textLength', op, v1: f1, v2: f2 }
    case 'custom': return { ...base, type: 'custom', v1: f1 }
  }
  return null
}
