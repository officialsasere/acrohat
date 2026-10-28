import { strToU8, zipSync } from 'fflate'
import { colName, cellName } from '../engine/address'
import { parseFormula, printNode, mapNodes } from '../engine/ast'
import type { Book } from '../engine/book'
import type { Border, CellStyle, CfRule, Sheet, Validation } from '../engine/model'
import { Arr, MAX_COLS, XlErr, isErr, type Scalar } from '../engine/types'
import { escapeXml as esc } from './xml'
import { FMT_ID, XLFN, pxToColWidth, pxToPt } from './xlsxShared'

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const rgb = (c: string | undefined) => (c ? 'FF' + c.replace('#', '').toUpperCase().padStart(6, '0').slice(-6) : undefined)

/** Writes the workbook as a .xlsx file. Charts, pictures and notes also go into a private part that this app reads back. */
export function writeXlsx(book: Book): Uint8Array {
  const wb = book.wb
  const files: Record<string, Uint8Array> = {}
  const put = (name: string, xml: string) => { files[name] = strToU8(xml) }
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

  // ---------- shared strings
  const strings: string[] = []
  const strIndex = new Map<string, number>()
  const sst = (s: string) => { let i = strIndex.get(s); if (i === undefined) { i = strings.length; strings.push(s); strIndex.set(s, i) } return i }

  // ---------- styles
  const fonts: string[] = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>']
  const fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
  const borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
  const numFmts: [number, string][] = []
  const dxfs: string[] = []
  const index = <T,>(list: T[], item: T) => { const k = JSON.stringify(item); const i = list.findIndex((x) => JSON.stringify(x) === k); if (i >= 0) return i; list.push(item); return list.length - 1 }
  const fontKeys: string[] = [fonts[0]], fillKeys: string[] = [...fills], borderKeys: string[] = [...borders]
  const idx = (list: string[], xml: string) => { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1 } return i }
  const fontXml = (s: CellStyle) => `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}${s.strike ? '<strike/>' : ''}${s.underline ? '<u/>' : ''}<sz val="${s.size ?? 11}"/>${s.color ? `<color rgb="${rgb(s.color)}"/>` : '<color theme="1"/>'}<name val="${esc(s.font ?? 'Calibri')}"/><family val="2"/></font>`
  const side = (n: string, b?: Border) => (b ? `<${n} style="${b.style === 'dashed' ? 'dashed' : b.style}"><color rgb="${rgb(b.color) ?? 'FF000000'}"/></${n}>` : `<${n}/>`)
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  const xfOf = new Map<number, number>([[0, 0]])
  void index
  const styleId = (i: number): number => {
    if (xfOf.has(i)) return xfOf.get(i)!
    const s = book.styles.get(i)
    const fmt = s.fmt ?? 'General'
    let nf = FMT_ID.get(fmt)
    if (nf === undefined) { const k = numFmts.findIndex((x) => x[1] === fmt); if (k >= 0) nf = numFmts[k][0]; else { nf = 164 + numFmts.length; numFmts.push([nf, fmt]) } }
    const fo = idx(fontKeys, fontXml(s))
    const fi = s.bg ? idx(fillKeys, `<fill><patternFill patternType="solid"><fgColor rgb="${rgb(s.bg)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
    const bo = s.bt || s.br || s.bb || s.bl ? idx(borderKeys, `<border>${side('left', s.bl)}${side('right', s.br)}${side('top', s.bt)}${side('bottom', s.bb)}<diagonal/></border>`) : 0
    const align = s.h || s.v || s.wrap || s.indent || s.rotate
      ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v === 'middle' ? 'center' : s.v}"` : ''}${s.wrap === true ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}${s.rotate ? ` textRotation="${s.rotate < 0 ? 90 - s.rotate : s.rotate}"` : ''}/>`
      : ''
    const prot = s.locked === false ? '<protection locked="0"/>' : ''
    const xml = `<xf numFmtId="${nf}" fontId="${fo}" fillId="${fi}" borderId="${bo}" xfId="0"${nf ? ' applyNumberFormat="1"' : ''}${fo ? ' applyFont="1"' : ''}${fi ? ' applyFill="1"' : ''}${bo ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1"' : ''}${prot ? ' applyProtection="1"' : ''}${align || prot ? `>${align}${prot}</xf>` : '/>'}`
    xfs.push(xml)
    xfOf.set(i, xfs.length - 1)
    return xfs.length - 1
  }
  const dxf = (s?: CellStyle) => {
    if (!s) return -1
    const x = `<dxf>${s.bold || s.italic || s.strike || s.underline || s.color ? `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}${s.strike ? '<strike/>' : ''}${s.underline ? '<u/>' : ''}${s.color ? `<color rgb="${rgb(s.color)}"/>` : ''}</font>` : ''}${s.bg ? `<fill><patternFill><bgColor rgb="${rgb(s.bg)}"/></patternFill></fill>` : ''}</dxf>`
    let i = dxfs.indexOf(x); if (i < 0) { dxfs.push(x); i = dxfs.length - 1 }
    return i
  }

  // ---------- formulas
  const fx = (formula: string): string => {
    try {
      const ast = parseFormula(formula)
      const out = mapNodes(ast, (n) => (n.t === 'call' && XLFN.has(n.name) ? { ...n, name: '_xlfn.' + n.name } : undefined))
      return printNode(out)
    } catch { return formula.replace(/^=/, '') }
  }
  const rangeRef = (r: { r1: number; c1: number; r2: number; c2: number }) => (r.r1 === r.r2 && r.c1 === r.c2 ? cellName(r.r1, r.c1) : `${cellName(r.r1, r.c1)}:${cellName(r.r2, r.c2)}`)

  // ---------- sheets
  const sheetXmls: string[] = []
  const sheetRels: (string | null)[] = []
  wb.sheets.forEach((sh) => {
    const rels: { id: string; target: string }[] = []
    const rows = new Map<number, { c: number; xml: string }[]>()
    const add = (r: number, c: number, xml: string) => { let a = rows.get(r); if (!a) rows.set(r, (a = [])); a.push({ c, xml }) }
    const keys = [...sh.cells.keys()].sort((a, b) => a - b)
    const spilled = new Set<number>()
    for (const k of keys) {
      const cell = sh.cells.get(k)!
      const r = Math.floor(k / MAX_COLS), c = k % MAX_COLS
      const s = styleId(cell.s)
      const sAttr = s ? ` s="${s}"` : ''
      const ref = cellName(r, c)
      if (cell.f) {
        const v = book.value(sh.id, r, c)
        const spill = book.arrayAt(sh.id, r, c)
        let t = '', val = ''
        const cache = (x: Scalar) => (typeof x === 'number' ? ['', String(x)] : typeof x === 'boolean' ? ['b', x ? '1' : '0'] : isErr(x) ? ['e', x.code] : x === null ? ['', ''] : ['str', esc(String(x))])
        ;[t, val] = cache(v)
        if (spill) {
          add(r, c, `<c r="${ref}"${sAttr}${t ? ` t="${t}"` : ''}><f t="array" ref="${rangeRef({ r1: r, c1: c, r2: r + spill.rows - 1, c2: c + spill.cols - 1 })}">${esc(fx(cell.f))}</f><v>${val}</v></c>`)
          for (let i = 0; i < spill.rows; i++) for (let j = 0; j < spill.cols; j++) if (i || j) {
            const sv = book.value(sh.id, r + i, c + j)
            const [st, sval] = cache(sv)
            add(r + i, c + j, `<c r="${cellName(r + i, c + j)}"${st ? ` t="${st}"` : ''}><v>${sval}</v></c>`)
            spilled.add((r + i) * MAX_COLS + c + j)
          }
        } else add(r, c, `<c r="${ref}"${sAttr}${t ? ` t="${t}"` : ''}><f>${esc(fx(cell.f))}</f><v>${val}</v></c>`)
        continue
      }
      if (spilled.has(k)) continue
      const v = cell.v
      if (v === null) { if (s) add(r, c, `<c r="${ref}"${sAttr}/>`); continue }
      if (typeof v === 'number') add(r, c, `<c r="${ref}"${sAttr}><v>${v}</v></c>`)
      else if (typeof v === 'boolean') add(r, c, `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`)
      else if (v instanceof XlErr) add(r, c, `<c r="${ref}"${sAttr} t="e"><v>${v.code}</v></c>`)
      else add(r, c, `<c r="${ref}"${sAttr} t="s"><v>${sst(String(v))}</v></c>`)
    }
    const rowNums = [...new Set([...rows.keys(), ...sh.rowH.keys(), ...sh.hiddenRows])].sort((a, b) => a - b)
    const sheetData = rowNums.map((r) => {
      const cells = (rows.get(r) ?? []).sort((a, b) => a.c - b.c).map((x) => x.xml).join('')
      const h = sh.rowH.get(r)
      return `<row r="${r + 1}"${h ? ` ht="${pxToPt(h)}" customHeight="1"` : ''}${sh.hiddenRows.has(r) ? ' hidden="1"' : ''}>${cells}</row>`
    }).join('')
    const colXml = [...new Set([...sh.colW.keys(), ...sh.hiddenCols])].sort((a, b) => a - b).map((c) => `<col min="${c + 1}" max="${c + 1}" width="${pxToColWidth(sh.colW.get(c) ?? sh.defaultColW)}" customWidth="1"${sh.hiddenCols.has(c) ? ' hidden="1"' : ''}/>`).join('')
    const pane = sh.frozenRows || sh.frozenCols
      ? `<pane${sh.frozenCols ? ` xSplit="${sh.frozenCols}"` : ''}${sh.frozenRows ? ` ySplit="${sh.frozenRows}"` : ''} topLeftCell="${cellName(sh.frozenRows, sh.frozenCols)}" activePane="${sh.frozenRows && sh.frozenCols ? 'bottomRight' : sh.frozenRows ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
      : ''
    const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${rangeRef(m)}"/>`).join('')}</mergeCells>` : ''
    // conditional formats
    let prio = 1
    const cfXml = sh.cf.map((r) => cfRuleXml(r, prio++, dxf)).filter(Boolean).join('')
    const dv = sh.validations.length ? `<dataValidations count="${sh.validations.length}">${sh.validations.map(validationXml).join('')}</dataValidations>` : ''
    const links: string[] = []
    for (const k of keys) { const cell = sh.cells.get(k)!; if (cell.link) { const id = `rId${rels.length + 1}`; rels.push({ id, target: cell.link }); links.push(`<hyperlink ref="${cellName(Math.floor(k / MAX_COLS), k % MAX_COLS)}" r:id="${id}"/>`) } }
    const auto = sh.filter ? `<autoFilter ref="${rangeRef(sh.filter.range)}"/>` : ''
    const prot = sh.protected ? '<sheetProtection sheet="1" objects="1" scenarios="1"/>' : ''
    sheetXmls.push(
      `${head}<worksheet ${NS}><sheetPr>${sh.tabColor ? `<tabColor rgb="${rgb(sh.tabColor)}"/>` : ''}</sheetPr><sheetViews><sheetView workbookViewId="0"${sh.gridlines ? '' : ' showGridLines="0"'}${sh.id === wb.active ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="${pxToPt(sh.defaultRowH)}"/>${colXml ? `<cols>${colXml}</cols>` : ''}<sheetData>${sheetData}</sheetData>${prot}${auto}${merges}${cfXml}${dv}${links.length ? `<hyperlinks>${links.join('')}</hyperlinks>` : ''}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
    )
    sheetRels.push(rels.length ? `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(r.target)}" TargetMode="External"/>`).join('')}</Relationships>` : null)
  })

  // ---------- parts
  wb.sheets.forEach((_, i) => { put(`xl/worksheets/sheet${i + 1}.xml`, sheetXmls[i]); const r = sheetRels[i]; if (r) put(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, r) })
  put('xl/sharedStrings.xml', `${head}<sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`)
  put('xl/styles.xml', `${head}<styleSheet ${NS}>${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map(([id, f]) => `<numFmt numFmtId="${id}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fontKeys.length}">${fontKeys.join('')}</fonts><fills count="${fillKeys.length}">${fillKeys.join('')}</fills><borders count="${borderKeys.length}">${borderKeys.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs></styleSheet>`)
  const names = wb.names.map((n) => `<definedName name="${esc(n.name)}"${n.scope !== undefined ? ` localSheetId="${wb.sheets.findIndex((s) => s.id === n.scope)}"` : ''}>${esc(fx(n.ref.startsWith('=') ? n.ref : '=' + n.ref))}</definedName>`).join('')
  const activeIdx = Math.max(0, wb.sheets.findIndex((s) => s.id === wb.active))
  put('xl/workbook.xml', `${head}<workbook ${NS}><bookViews><workbookView activeTab="${activeIdx}"/></bookViews><sheets>${wb.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`)
  const n = wb.sheets.length
  put('xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${n + 3}" Type="https://kwiiva.netlify.app/rel/extras" Target="kwiiva-extras.json"/></Relationships>`)
  // Everything this format has no place for, kept so opening the file here brings it back.
  const extras = {
    version: 1,
    title: wb.title,
    sheets: wb.sheets.map((s) => ({
      name: s.name, charts: s.charts, pictures: s.pictures, cf: s.cf, validations: s.validations, filter: s.filter,
      notes: [...s.cells.entries()].filter(([, c]) => c.note).map(([k, c]) => ({ r: Math.floor(k / MAX_COLS), c: k % MAX_COLS, text: c.note })),
      wrapStyles: undefined,
    })),
  }
  put('xl/kwiiva-extras.json', JSON.stringify(extras))
  put('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`)
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  put('docProps/core.xml', `${head}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(wb.title)}</dc:title><dc:creator>Kwiiva Grid</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  put('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`)
  const ordered: Record<string, Uint8Array> = { '[Content_Types].xml': files['[Content_Types].xml'] }
  for (const k of Object.keys(files)) if (k !== '[Content_Types].xml') ordered[k] = files[k]
  return zipSync(ordered, { level: 6 })
}

function cfRuleXml(r: CfRule, priority: number, dxf: (s?: CellStyle) => number): string {
  const sq = r.ranges.map((g) => (g.r1 === g.r2 && g.c1 === g.c2 ? cellName(g.r1, g.c1) : `${cellName(g.r1, g.c1)}:${cellName(g.r2, g.c2)}`)).join(' ')
  const first = r.ranges[0] ? cellName(r.ranges[0].r1, r.ranges[0].c1) : 'A1'
  const d = dxf(r.style)
  const attrs = `priority="${priority}"${d >= 0 ? ` dxfId="${d}"` : ''}`
  const wrap = (x: string) => `<conditionalFormatting sqref="${sq}">${x}</conditionalFormatting>`
  const OPS: Record<string, string> = { '>': 'greaterThan', '<': 'lessThan', '>=': 'greaterThanOrEqual', '<=': 'lessThanOrEqual', '=': 'equal', '<>': 'notEqual', between: 'between', notBetween: 'notBetween' }
  switch (r.type) {
    case 'cell': return wrap(`<cfRule type="cellIs" ${attrs} operator="${OPS[r.op ?? '>']}"><formula>${esc(r.v1 ?? '0')}</formula>${r.v2 !== undefined ? `<formula>${esc(r.v2)}</formula>` : ''}</cfRule>`)
    case 'text': {
      const q = esc((r.v1 ?? '').replace(/"/g, '""'))
      const t = r.op === 'begins' ? ['beginsWith', `LEFT(${first},${(r.v1 ?? '').length})="${q}"`] : r.op === 'ends' ? ['endsWith', `RIGHT(${first},${(r.v1 ?? '').length})="${q}"`] : r.op === 'notContains' ? ['notContainsText', `ISERROR(SEARCH("${q}",${first}))`] : ['containsText', `NOT(ISERROR(SEARCH("${q}",${first})))`]
      return wrap(`<cfRule type="${t[0]}" ${attrs} operator="${t[0] === 'notContainsText' ? 'notContains' : t[0] === 'containsText' ? 'containsText' : t[0]}" text="${q}"><formula>${t[1]}</formula></cfRule>`)
    }
    case 'blanks': return wrap(`<cfRule type="containsBlanks" ${attrs}><formula>LEN(TRIM(${first}))=0</formula></cfRule>`)
    case 'noblanks': return wrap(`<cfRule type="notContainsBlanks" ${attrs}><formula>LEN(TRIM(${first}))&gt;0</formula></cfRule>`)
    case 'errors': return wrap(`<cfRule type="containsErrors" ${attrs}><formula>ISERROR(${first})</formula></cfRule>`)
    case 'noerrors': return wrap(`<cfRule type="notContainsErrors" ${attrs}><formula>NOT(ISERROR(${first}))</formula></cfRule>`)
    case 'duplicates': return wrap(`<cfRule type="duplicateValues" ${attrs}/>`)
    case 'unique': return wrap(`<cfRule type="uniqueValues" ${attrs}/>`)
    case 'top': return wrap(`<cfRule type="top10" ${attrs} rank="${r.n ?? 10}"${r.percent ? ' percent="1"' : ''}${r.op === 'bottom' ? ' bottom="1"' : ''}/>`)
    case 'above': return wrap(`<cfRule type="aboveAverage" ${attrs}${r.op === 'below' ? ' aboveAverage="0"' : ''}/>`)
    case 'formula': return wrap(`<cfRule type="expression" ${attrs}><formula>${esc((r.formula ?? '').replace(/^=/, ''))}</formula></cfRule>`)
    case 'scale': {
      if (!r.scale) return ''
      const t = (c: { type: string; value?: number }) => `<cfvo type="${c.type === 'min' ? 'min' : c.type === 'max' ? 'max' : c.type}"${c.value !== undefined && c.type !== 'min' && c.type !== 'max' ? ` val="${c.value}"` : ''}/>`
      const col = (c: { color: string }) => `<color rgb="${rgb(c.color)}"/>`
      const mid = r.scale.mid
      return wrap(`<cfRule type="colorScale" priority="${priority}"><colorScale>${t(r.scale.min)}${mid ? t(mid) : ''}${t(r.scale.max)}${col(r.scale.min)}${mid ? col(mid) : ''}${col(r.scale.max)}</colorScale></cfRule>`)
    }
    case 'bar': return r.bar ? wrap(`<cfRule type="dataBar" priority="${priority}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${rgb(r.bar.color)}"/></dataBar></cfRule>`) : ''
    default: return ''
  }
}

function validationXml(v: Validation): string {
  const sq = v.ranges.map((g) => (g.r1 === g.r2 && g.c1 === g.c2 ? cellName(g.r1, g.c1) : `${cellName(g.r1, g.c1)}:${cellName(g.r2, g.c2)}`)).join(' ')
  const type = v.type === 'list' || v.type === 'listRange' ? 'list' : v.type === 'number' ? 'decimal' : v.type === 'integer' ? 'whole' : v.type === 'date' ? 'date' : v.type === 'textLength' ? 'textLength' : v.type === 'custom' ? 'custom' : null
  if (!type) return ''
  const OPS: Record<string, string> = { '>': 'greaterThan', '<': 'lessThan', '>=': 'greaterThanOrEqual', '<=': 'lessThanOrEqual', '=': 'equal', '<>': 'notEqual', between: 'between', notBetween: 'notBetween' }
  const f1 = v.type === 'list' ? `"${(v.list ?? []).join(',').replace(/"/g, '""')}"` : (v.v1 ?? '').replace(/^=/, '')
  return `<dataValidation type="${type}"${type !== 'list' && type !== 'custom' ? ` operator="${OPS[v.op ?? 'between']}"` : ''} allowBlank="${v.allowBlank === false ? 0 : 1}" showInputMessage="1" showErrorMessage="1"${v.onInvalid === 'warning' ? ' errorStyle="warning"' : ''}${v.dropdown === false ? ' showDropDown="1"' : ''}${v.help ? ` error="${esc(v.help)}"` : ''} sqref="${sq}"><formula1>${esc(f1)}</formula1>${v.v2 !== undefined && v.v2 !== '' ? `<formula2>${esc(v.v2)}</formula2>` : ''}</dataValidation>`
}
export { colName, Arr }
export type { Sheet }
