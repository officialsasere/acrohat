import { applyTheme, makeDeck, slideFromLayout } from './themes'
import { plainText, uid, type ChartEl, type Deck, type El, type Para, type ShapeEl, type Slide, type Text } from './model'
import { newShape, newTextBox, sampleChart } from './insert'

export interface Template { id: string; name: string; blurb: string; theme: string; build: () => Deck }

const bullets = (...lines: string[]): Text => ({ paras: lines.map((t): Para => ({ runs: [{ t }] })) })
function put(slide: Slide, role: string, text: Text | string, idx?: number) {
  const el = slide.els.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.role === role && (idx === undefined || (e.ph.idx ?? 0) === idx))
  if (el) el.text = { ...el.text, ...(typeof text === 'string' ? plainText(text) : text) }
}
function slide(d: Deck, layout: string, fill: (s: Slide) => void, notes = ''): Slide {
  const s = slideFromLayout(d, layout)
  fill(s)
  s.notes = notes
  d.slides.push(s)
  return s
}
const chart = (kind: ChartEl['kind'], over: Partial<ChartEl> = {}): ChartEl => ({ id: uid(), type: 'chart', kind, grouping: 'clustered', ...sampleChart(kind), x: 60, y: 132, w: 840, h: 360, legend: 'bottom', labels: false, grid: true, ...over }) as ChartEl
const card = (d: Deck, x: number, y: number, w: number, h: number, head: string, body: string, color = '@accent1'): El[] => {
  const bg = newShape('roundRect', x, y, w, h, ); bg.fill = { t: 'solid', c: '@bg2' }; bg.line = undefined; bg.adj = [6000]; bg.text = undefined
  const bar = newShape('rect', x, y, 8, h); bar.fill = { t: 'solid', c: color }; bar.line = undefined; bar.text = undefined
  const t = newTextBox(x + 24, y + 14, w - 40, 44); t.text = plainText(head); t.st = { sz: 24, b: true, f: '+head', c: '@text' }
  const b = newTextBox(x + 24, y + 62, w - 40, h - 76); b.text = plainText(body); b.st = { sz: 18, f: '+body', c: '@text2' }
  void d
  return [bg, bar, t, b]
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank', blurb: 'One title slide', theme: 'milk', build: () => { const d = makeDeck('milk'); d.slides.push(slideFromLayout(d, 'title')); return d } },
  { id: 'pitch', name: 'Pitch deck', blurb: 'Problem, solution, traction, ask', theme: 'midnight', build: () => {
    const d = makeDeck('midnight', 'Pitch deck')
    slide(d, 'title', (s) => { put(s, 'title', 'Your company name'); put(s, 'subtitle', 'One sentence that says what you do and for whom') }, 'Open with the one-line pitch.')
    slide(d, 'titleBody', (s) => { put(s, 'title', 'The problem'); put(s, 'body', bullets('Who has it, and how often', 'What it costs them today', 'Why the usual fixes fall short')) })
    slide(d, 'titleBody', (s) => { put(s, 'title', 'Our solution'); put(s, 'body', bullets('What it is, in plain words', 'The one thing it does better than anything else', 'A moment that shows it working')) })
    slide(d, 'titleOnly', (s) => { put(s, 'title', 'Traction'); s.els.push(chart('column', { y: 140, h: 350, title: 'Monthly active users (thousands)', legend: 'none', series: [{ name: 'Users', vals: [2, 3.1, 4.8, 7.4, 11.2, 16.5] }], cats: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] })) })
    slide(d, 'twoContent', (s) => { put(s, 'title', 'Business model'); put(s, 'body', bullets('Who pays', 'How much', 'How often')); put(s, 'body2', bullets('Cost to serve', 'Margin today', 'Margin at scale')) })
    slide(d, 'section', (s) => { put(s, 'title', 'The ask'); put(s, 'body', 'What you are raising, and what it buys') })
    return d
  } },
  { id: 'report', name: 'Quarterly review', blurb: 'Numbers, highlights and next steps', theme: 'milk', build: () => {
    const d = makeDeck('milk', 'Quarterly review')
    slide(d, 'title', (s) => { put(s, 'title', 'Quarterly review'); put(s, 'subtitle', 'Q3 results and what comes next') })
    slide(d, 'titleOnly', (s) => { put(s, 'title', 'Highlights'); s.els.push(...card(d, 48, 140, 270, 150, 'Revenue', '$4.2M, up 18% on last quarter'), ...card(d, 345, 140, 270, 150, 'Customers', '1,240 active, 96 new', '@accent2'), ...card(d, 642, 140, 270, 150, 'Satisfaction', '4.6 out of 5 across 380 reviews', '@accent3'), ...card(d, 48, 320, 864, 150, 'Biggest win', 'The new onboarding cut time to first result from 3 days to 40 minutes.', '@accent4')) })
    slide(d, 'titleOnly', (s) => { put(s, 'title', 'Revenue by region'); s.els.push(chart('column', { grouping: 'stacked', title: undefined })) })
    slide(d, 'twoContent', (s) => { put(s, 'title', 'What went well, what did not'); put(s, 'body', bullets('Launch landed on time', 'Support wait times halved', 'Two large renewals closed')); put(s, 'body2', bullets('Churn rose in the smallest plan', 'Mobile release slipped a month', 'Hiring behind plan')) })
    slide(d, 'titleBody', (s) => { put(s, 'title', 'Next quarter'); put(s, 'body', bullets('Ship the mobile release', 'Fix the small-plan churn', 'Open the second office')) })
    return d
  } },
  { id: 'lesson', name: 'Lesson', blurb: 'Goals, explanation, activity, recap', theme: 'ocean', build: () => {
    const d = makeDeck('ocean', 'Lesson')
    slide(d, 'title', (s) => { put(s, 'title', 'Lesson title'); put(s, 'subtitle', 'Grade or class · date') })
    slide(d, 'titleBody', (s) => { put(s, 'title', 'Today we will'); put(s, 'body', bullets('Learn the key idea', 'Try it on an example', 'Check what we understood')) })
    slide(d, 'twoContent', (s) => { put(s, 'title', 'The key idea'); put(s, 'body', bullets('Say it in one sentence', 'Give a clear example', 'Name the common mistake')); put(s, 'body2', bullets('Write the rule here')) })
    slide(d, 'titleBody', (s) => { put(s, 'title', 'Try it'); put(s, 'body', bullets('Work in pairs for five minutes', 'Write your answer on a card', 'Be ready to explain it')) })
    slide(d, 'section', (s) => { put(s, 'title', 'Questions?'); put(s, 'body', 'Recap in one line') })
    return d
  } },
  { id: 'project', name: 'Project plan', blurb: 'Goals, timeline, owners, risks', theme: 'forest', build: () => {
    const d = makeDeck('forest', 'Project plan')
    slide(d, 'title', (s) => { put(s, 'title', 'Project name'); put(s, 'subtitle', 'Plan and timeline') })
    slide(d, 'titleBody', (s) => { put(s, 'title', 'Goal'); put(s, 'body', bullets('What done looks like', 'How we will measure it', 'What is out of scope')) })
    slide(d, 'titleOnly', (s) => {
      put(s, 'title', 'Timeline')
      const phases = ['Plan', 'Build', 'Test', 'Launch']
      phases.forEach((p, i) => { const sh = newShape('homePlate', 48 + i * 216, 220, 230, 90); sh.fill = { t: 'solid', c: `@accent${(i % 4) + 1}` }; sh.text = plainText(p); sh.st = { sz: 24, b: true, c: '#ffffff', f: '+head', align: 'center' }; s.els.push(sh); const t = newTextBox(48 + i * 216, 330, 210, 90); t.text = plainText(`Week ${i * 3 + 1}–${i * 3 + 3}\nWhat happens in this phase`); t.st = { sz: 16, c: '@text2', f: '+body' }; s.els.push(t) })
    })
    slide(d, 'twoContent', (s) => { put(s, 'title', 'Owners and risks'); put(s, 'body', bullets('Product: name', 'Design: name', 'Engineering: name')); put(s, 'body2', bullets('Risk and how we will watch it', 'Another risk', 'What we do if it happens')) })
    return d
  } },
  { id: 'story', name: 'Photo story', blurb: 'Big pictures, few words', theme: 'rose', build: () => {
    const d = makeDeck('rose', 'Photo story')
    slide(d, 'title', (s) => { put(s, 'title', 'A story in pictures'); put(s, 'subtitle', 'Add your photos with Insert → Picture') })
    for (let i = 1; i <= 3; i++) slide(d, 'pictureCaption', (s) => { put(s, 'title', `Chapter ${i}`); put(s, 'body', 'A sentence or two about this picture.') })
    slide(d, 'section', (s) => { put(s, 'title', 'Thank you'); put(s, 'body', 'Where to find more') })
    return d
  } },
  { id: 'event', name: 'Event or party', blurb: 'Invitation and schedule', theme: 'sunrise', build: () => {
    const d = makeDeck('sunrise', 'Event')
    slide(d, 'title', (s) => { put(s, 'title', 'You are invited'); put(s, 'subtitle', 'Saturday · 6 pm · The garden') })
    slide(d, 'titleBody', (s) => { put(s, 'title', 'The plan'); put(s, 'body', bullets('6:00  Arrivals and drinks', '7:00  Dinner', '8:30  Music and dancing')) })
    slide(d, 'section', (s) => { put(s, 'title', 'See you there'); put(s, 'body', 'Reply by Friday') })
    return d
  } },
]

export function buildTemplate(id: string): Deck { return (TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]).build() }
export { applyTheme }
