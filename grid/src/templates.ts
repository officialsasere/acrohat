import { Book } from './engine/book'
import { newWorkbook } from './engine/model'

export interface Template { id: string; name: string; blurb: string; build: () => Book }

type Row = (string | number)[]
function make(title: string, rows: Row[], style?: (b: Book, id: number) => void, widths?: number[]): Book {
  const b = new Book(newWorkbook(title))
  const sh = b.wb.sheets[0]
  b.load(() => {
    rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') b.setInput(sh.id, r, c, String(v)) }))
    widths?.forEach((w, c) => sh.colW.set(c, w))
  })
  style?.(b, sh.id)
  return b
}
const head = (b: Book, id: number, c2: number, row = 0) => b.setStyle(id, [{ r1: row, c1: 0, r2: row, c2 }], { bold: true, bg: '#e4cfae', color: '#3a2416' })

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank spreadsheet', blurb: 'Start from nothing', build: () => new Book(newWorkbook('Untitled spreadsheet')) },
  {
    id: 'budget', name: 'Monthly budget', blurb: 'Income, spending and what is left',
    build: () => make('Monthly budget', [
      ['Category', 'Planned', 'Actual', 'Difference'],
      ['Income', 3200, 3200, '=C2-B2'], ['Rent', 1100, 1100, '=B3-C3'], ['Groceries', 400, 438, '=B4-C4'], ['Transport', 120, 95, '=B5-C5'], ['Utilities', 160, 171, '=B6-C6'], ['Savings', 300, 300, '=B7-C7'], ['Fun', 150, 212, '=B8-C8'],
      ['Total spending', '=SUM(B3:B8)', '=SUM(C3:C8)', '=B9-C9'], ['Left over', '=B2-B9', '=C2-C9', ''],
    ], (b, id) => { head(b, id, 3); b.setStyle(id, [{ r1: 1, c1: 1, r2: 9, c2: 3 }], { fmt: '$#,##0.00' }); b.setStyle(id, [{ r1: 8, c1: 0, r2: 9, c2: 3 }], { bold: true }); b.wb.sheets[0].cf.push({ id: 'cf1', ranges: [{ r1: 2, c1: 3, r2: 7, c2: 3 }], type: 'cell', op: '<', v1: '0', style: { color: '#b3261e', bold: true } }) }, [160, 110, 110, 110]),
  },
  {
    id: 'invoice', name: 'Invoice', blurb: 'Line items with totals and tax',
    build: () => make('Invoice', [
      ['INVOICE', '', '', ''], ['Bill to:', '', 'Invoice #', 1001], ['', '', 'Date', '=TODAY()'], ['', '', '', ''],
      ['Description', 'Qty', 'Unit price', 'Amount'],
      ['Design work', 10, 85, '=B6*C6'], ['Hosting (annual)', 1, 240, '=B7*C7'], ['', '', '', ''], ['', '', '', ''],
      ['', '', 'Subtotal', '=SUM(D6:D9)'], ['', '', 'Tax rate', 0.08], ['', '', 'Tax', '=D10*D11'], ['', '', 'Total due', '=D10+D12'],
    ], (b, id) => { b.setStyle(id, [{ r1: 0, c1: 0, r2: 0, c2: 0 }], { bold: true, size: 20, color: '#8a5a36' }); head(b, id, 3, 4); b.setStyle(id, [{ r1: 5, c1: 2, r2: 12, c2: 3 }], { fmt: '$#,##0.00' }); b.setStyle(id, [{ r1: 10, c1: 3, r2: 10, c2: 3 }], { fmt: '0%' }); b.setStyle(id, [{ r1: 12, c1: 2, r2: 12, c2: 3 }], { bold: true }); b.setStyle(id, [{ r1: 2, c1: 3, r2: 2, c2: 3 }], { fmt: 'mmm d, yyyy' }) }, [220, 70, 110, 120]),
  },
  {
    id: 'todo', name: 'To-do list', blurb: 'Tasks with check boxes and due dates',
    build: () => {
      const b = make('To-do list', [['Done', 'Task', 'Owner', 'Due', 'Status'], ['FALSE', 'Write the plan', 'Sam', '', '=IF(A2,"Done","Open")'], ['FALSE', 'Share it', 'Ana', '', '=IF(A3,"Done","Open")'], ['TRUE', 'Collect feedback', 'Sam', '', '=IF(A4,"Done","Open")'], ['FALSE', '', '', '', '']], (bk, id) => head(bk, id, 4), [60, 240, 110, 110, 90])
      const sh = b.wb.sheets[0]
      b.prop(sh, 'validations', [{ id: 'v1', ranges: [{ r1: 1, c1: 0, r2: 200, c2: 0 }], type: 'checkbox', checked: 'TRUE', unchecked: 'FALSE' }])
      b.prop(sh, 'cf', [{ id: 'c1', ranges: [{ r1: 1, c1: 1, r2: 200, c2: 4 }], type: 'formula', formula: '=$A2=TRUE', style: { color: '#9c9c9c', strike: true } }])
      for (let r = 4; r <= 40; r++) { b.setInput(sh.id, r, 4, `=IF(B${r + 1}="","",IF(A${r + 1},"Done","Open"))`) }
      return b
    },
  },
  {
    id: 'tracker', name: 'Project tracker', blurb: 'Tasks, status and progress',
    build: () => {
      const b = make('Project tracker', [['Task', 'Owner', 'Start', 'End', 'Status', 'Progress'], ['Kick-off', 'Ana', '2026-03-02', '2026-03-03', 'Done', 1], ['Research', 'Sam', '2026-03-04', '2026-03-13', 'In progress', 0.6], ['Build', 'Lee', '2026-03-16', '2026-04-10', 'In progress', 0.25], ['Launch', 'Ana', '2026-04-13', '2026-04-14', 'Not started', 0]], (bk, id) => { head(bk, id, 5); bk.setStyle(id, [{ r1: 1, c1: 5, r2: 40, c2: 5 }], { fmt: '0%' }) }, [180, 100, 110, 110, 120, 110])
      const sh = b.wb.sheets[0]
      b.prop(sh, 'validations', [{ id: 'v1', ranges: [{ r1: 1, c1: 4, r2: 100, c2: 4 }], type: 'list', list: ['Not started', 'In progress', 'Blocked', 'Done'] }])
      b.prop(sh, 'cf', [{ id: 'c1', ranges: [{ r1: 1, c1: 5, r2: 100, c2: 5 }], type: 'bar', bar: { color: '#c9925b' } }, { id: 'c2', ranges: [{ r1: 1, c1: 4, r2: 100, c2: 4 }], type: 'cell', op: '=', v1: 'Done', style: { bg: '#d9ead3' } }, { id: 'c3', ranges: [{ r1: 1, c1: 4, r2: 100, c2: 4 }], type: 'cell', op: '=', v1: 'Blocked', style: { bg: '#f4cccc' } }])
      b.prop(sh, 'frozenRows', 1)
      return b
    },
  },
  {
    id: 'grades', name: 'Gradebook', blurb: 'Scores, averages and letter grades',
    build: () => make('Gradebook', [['Student', 'Quiz 1', 'Quiz 2', 'Exam', 'Average', 'Grade'], ['Ada', 88, 92, 95, '=ROUND(AVERAGE(B2:D2),1)', '=IFS(E2>=90,"A",E2>=80,"B",E2>=70,"C",TRUE,"D")'], ['Ben', 72, 65, 80, '=ROUND(AVERAGE(B3:D3),1)', '=IFS(E3>=90,"A",E3>=80,"B",E3>=70,"C",TRUE,"D")'], ['Cy', 95, 98, 91, '=ROUND(AVERAGE(B4:D4),1)', '=IFS(E4>=90,"A",E4>=80,"B",E4>=70,"C",TRUE,"D")'], ['Class average', '=AVERAGE(B2:B4)', '=AVERAGE(C2:C4)', '=AVERAGE(D2:D4)', '=AVERAGE(E2:E4)', '']], (b, id) => { head(b, id, 5); b.setStyle(id, [{ r1: 4, c1: 0, r2: 4, c2: 5 }], { bold: true }); b.setStyle(id, [{ r1: 1, c1: 1, r2: 4, c2: 4 }], { fmt: '0.0' }) }, [150, 90, 90, 90, 100, 90]),
  },
]
