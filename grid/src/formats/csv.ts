import { Book } from '../engine/book'
import { newWorkbook } from '../engine/model'
import { parseTsv } from '../actions/clipboard'
import { MAX_COLS, MAX_ROWS } from '../engine/types'

/** Guesses the separator: comma, semicolon, tab or pipe, whichever splits the first lines most evenly. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n')
  let best = ',', bestScore = -1
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.split('\n').filter(Boolean).map((l) => parseTsv(l, d)[0]?.length ?? 1)
    const first = counts[0] ?? 1
    const score = first > 1 ? counts.filter((n) => n === first).length * 10 + first : 0
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

export function readCsv(text: string, name = 'Spreadsheet', delim?: string): Book {
  const t = text.replace(/^﻿/, '')
  const rows = parseTsv(t, delim ?? detectDelimiter(t))
  const book = new Book(newWorkbook(name.replace(/\.[^.]+$/, '')))
  const sh = book.wb.sheets[0]
  book.load(() => {
    rows.forEach((row, r) => {
      if (r >= MAX_ROWS) return
      row.forEach((cell, c) => { if (c < MAX_COLS && cell !== '') book.setInput(sh.id, r, c, cell) })
    })
    sh.rows = Math.max(sh.rows, rows.length + 100)
    sh.cols = Math.max(sh.cols, Math.max(0, ...rows.map((r) => r.length)) + 5)
  })
  return book
}

const q = (s: string, d: string) => (/["\n\r]/.test(s) || s.includes(d) ? `"${s.replace(/"/g, '""')}"` : s)

/** The sheet as delimited text, using what is shown in the cells. */
export function writeCsv(book: Book, delim = ','): string {
  const sh = book.activeSheet
  const u = book.usedRange(sh.id)
  const lines: string[] = []
  for (let r = 0; r < u.rows; r++) {
    const row: string[] = []
    for (let c = 0; c < u.cols; c++) row.push(q(book.display(sh.id, r, c).text, delim))
    lines.push(row.join(delim))
  }
  return lines.join('\r\n') + '\r\n'
}

export function writeHtml(book: Book): string {
  const sh = book.activeSheet, u = book.usedRange(sh.id)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const rows = Array.from({ length: u.rows }, (_, r) => `<tr>${Array.from({ length: u.cols }, (_, c) => { const st = book.styleOf(sh.id, r, c); const f = book.display(sh.id, r, c); return `<td style="${[st.bold && 'font-weight:bold', st.italic && 'font-style:italic', st.bg && `background:${st.bg}`, st.color && `color:${st.color}`, typeof book.value(sh.id, r, c) === 'number' && 'text-align:right'].filter(Boolean).join(';')}">${esc(f.text)}</td>` }).join('')}</tr>`).join('\n')
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(book.wb.title)}</title><style>body{font:14px Calibri,Carlito,sans-serif}table{border-collapse:collapse}td{border:1px solid #bbb;padding:3px 8px}</style></head><body>\n<table>\n${rows}\n</table>\n</body></html>\n`
}

/** The sheet as a list of records, using the first row as the keys. */
export function writeJson(book: Book): string {
  const sh = book.activeSheet, u = book.usedRange(sh.id)
  const keys = Array.from({ length: u.cols }, (_, c) => String(book.value(sh.id, 0, c) ?? `column${c + 1}`))
  const out = Array.from({ length: Math.max(0, u.rows - 1) }, (_, i) => Object.fromEntries(keys.map((k, c) => { const v = book.value(sh.id, i + 1, c); return [k, v !== null && typeof v === 'object' ? (v as { code: string }).code : v] })))
  return JSON.stringify(out, null, 2)
}
