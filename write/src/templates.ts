import { emptyDoc, type PMDoc, type PMNode } from './formats/types'

export interface Template { id: string; name: string; blurb: string; doc: () => PMDoc }

const t = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, marks })
const p = (text = '', attrs?: Record<string, unknown>): PMNode => ({ type: 'paragraph', attrs, content: text ? [t(text)] : undefined })
const h = (level: number, text: string, attrs?: Record<string, unknown>): PMNode => ({ type: 'heading', attrs: { level, ...attrs }, content: [t(text)] })
const li = (text: string): PMNode => ({ type: 'listItem', content: [p(text)] })
const cell = (text: string, header = false, attrs: Record<string, unknown> = {}): PMNode => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, ...attrs }, content: [p(text)] })
const row = (cells: PMNode[]): PMNode => ({ type: 'tableRow', content: cells })

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank document', blurb: 'Start from nothing', doc: emptyDoc },
  {
    id: 'letter', name: 'Letter', blurb: 'Formal letter layout',
    doc: () => ({ type: 'doc', content: [p('Your name', { spaceAfter: 0 }), p('Street address', { spaceAfter: 0 }), p('City, postcode', { spaceAfter: 0 }), p('Email · Phone'), p('Date'), p('Recipient name', { spaceAfter: 0 }), p('Their address'), p('Dear Recipient,'), p('Write the opening of your letter here. Say why you are writing in the first sentence.'), p('Add the details in the next paragraph. Keep each paragraph to one idea.'), p('Close with what you would like to happen next, and thank them.'), p('Sincerely,', { spaceAfter: 36 }), p('Your name')] }),
  },
  {
    id: 'resume', name: 'Resume', blurb: 'One page, clean sections',
    doc: () => ({ type: 'doc', content: [p('Your Name', { pStyle: 'title', textAlign: 'center' }), p('City · you@example.com · 555 0100', { textAlign: 'center' }), h(2, 'Summary'), p('Two or three lines about what you do best and what you are looking for.'), h(2, 'Experience'), p('Job title, Company', { spaceAfter: 0 }), p('2022 – Present', { spaceAfter: 4 }), { type: 'bulletList', content: [li('Something you achieved, with a number if you can.'), li('Something you led, built or improved.')] }, h(2, 'Education'), p('Degree, School, Year'), h(2, 'Skills'), p('Skill one · Skill two · Skill three')] }),
  },
  {
    id: 'notes', name: 'Meeting notes', blurb: 'Agenda, notes, actions',
    doc: () => ({ type: 'doc', content: [p('Meeting notes', { pStyle: 'title' }), p('Date · Attendees', { pStyle: 'subtitle' }), h(2, 'Agenda'), { type: 'orderedList', content: [li('Topic one'), li('Topic two')] }, h(2, 'Notes'), p(''), h(2, 'Action items'), { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('Who: what, by when')] }] }] }),
  },
  {
    id: 'report', name: 'Report', blurb: 'Title, contents, sections',
    doc: () => ({ type: 'doc', content: [p('Report title', { pStyle: 'title' }), p('Author · Date', { pStyle: 'subtitle' }), { type: 'tableOfContents' }, h(1, 'Introduction'), p('Explain the purpose and scope of the report.'), h(1, 'Findings'), h(2, 'First finding'), p('Describe it and show the evidence.'), h(1, 'Conclusion'), p('Summarise and recommend.')] }),
  },
  {
    id: 'plan', name: 'Project plan', blurb: 'Goals and a task table',
    doc: () => ({ type: 'doc', content: [p('Project plan', { pStyle: 'title' }), h(2, 'Goal'), p('What are we trying to achieve, and how will we know it worked?'), h(2, 'Tasks'), { type: 'table', content: [row([cell('Task', true), cell('Owner', true), cell('Due', true), cell('Status', true)]), row([cell(''), cell(''), cell(''), cell('')]), row([cell(''), cell(''), cell(''), cell('')])] }, p('')] }),
  },
]
