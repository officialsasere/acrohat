import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { readDocx } from '../write/src/formats/docxRead'
import { writeDocx } from '../write/src/formats/docxWrite'
import { parseXml } from '../write/src/formats/xml'
import { DEFAULT_SETTINGS, type PMNode, type WriteDocument } from '../write/src/formats/types'

// 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const t = (text: string, marks?: PMNode['marks']): PMNode => ({ type: 'text', text, marks })
const p = (content: PMNode[], attrs?: Record<string, unknown>): PMNode => ({ type: 'paragraph', attrs, content })

function sample(): WriteDocument {
  return {
    title: 'Quarterly plan',
    settings: { ...DEFAULT_SETTINGS, size: 'a4', orientation: 'landscape', margins: { top: 0.8, right: 1.2, bottom: 0.8, left: 1.2 }, header: { left: 'Kwiiva', center: '', right: '' }, footer: { left: '', center: 'Page {page} of {pages}', right: '' }, bodyFont: 'Cambria', bodySize: 12 },
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('Plan & "goals" <2026>')] },
        p([t('Plain, '), t('bold', [{ type: 'bold' }]), t(' and '), t('italic', [{ type: 'italic' }]), t(' and '), t('both', [{ type: 'bold' }, { type: 'italic' }]), t('. '), t('Underlined', [{ type: 'underline' }]), t(' '), t('struck', [{ type: 'strike' }])]),
        p([t('Styled', [{ type: 'textStyle', attrs: { color: '#c00000', fontSize: '16pt', fontFamily: 'Georgia, serif' } }]), t(' '), t('marked', [{ type: 'highlight', attrs: { color: '#ffff00' } }]), t(' x'), t('2', [{ type: 'superscript' }]), t(' H'), t('2', [{ type: 'subscript' }]), t('O')], { textAlign: 'center', lineHeight: 1.5, spaceAfter: 20 }),
        p([t('A link', [{ type: 'link', attrs: { href: 'https://example.org/a?b=1&c=2' } }]), { type: 'hardBreak' }, t('after a break\tand a tab')], { textAlign: 'justify', indent: 36 }),
        { type: 'bulletList', content: [
          { type: 'listItem', content: [p([t('one')]), { type: 'bulletList', content: [{ type: 'listItem', content: [p([t('nested')])] }] }] },
          { type: 'listItem', content: [p([t('two')])] },
        ] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p([t('third')])] }, { type: 'listItem', content: [p([t('fourth')])] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p([t('done')])] }, { type: 'taskItem', attrs: { checked: false }, content: [p([t('todo')])] }] },
        { type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [p([t('H1')])] },
            { type: 'tableHeader', attrs: { colspan: 2, rowspan: 1 }, content: [p([t('H2')])] },
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 2, backgroundColor: '#ffeecc' }, content: [p([t('tall')])] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p([t('b')])] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p([t('c')])] },
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p([t('d')])] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p([t('e')])] },
          ] },
        ] },
        { type: 'blockquote', content: [p([t('Quoted words')])] },
        { type: 'codeBlock', content: [t('let a = 1\nlet b = 2')] },
        p([{ type: 'image', attrs: { src: PNG, width: 40, height: 40, alt: 'dot' } }]),
        { type: 'pageBreak' },
        p([t('Last page')], { pStyle: 'title' }),
      ],
    },
  }
}

const textOf = (n: PMNode): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('')
const find = (n: PMNode, type: string, out: PMNode[] = []): PMNode[] => { if (n.type === type) out.push(n); for (const c of n.content ?? []) find(c, type, out); return out }

describe('docx writer', () => {
  it('produces a well-formed package with every required part', () => {
    const zip = unzipSync(writeDocx(sample()))
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'word/header1.xml', 'word/footer1.xml']) expect(zip[f], f).toBeTruthy()
    expect(Object.keys(zip).some((k) => k.startsWith('word/media/'))).toBe(true)
    for (const [name, data] of Object.entries(zip)) if (/\.(xml|rels)$/.test(name)) expect(() => parseXml(strFromU8(data)), name).not.toThrow()
    const doc = strFromU8(zip['word/document.xml'])
    expect(doc).toContain('w:pgSz')
    expect(doc).toContain('Plan &amp; &quot;goals&quot; &lt;2026&gt;')
    expect(strFromU8(zip['word/_rels/document.xml.rels'])).toContain('https://example.org/a?b=1&amp;c=2')
  })
})

describe('docx round trip', () => {
  const back = readDocx(writeDocx(sample()), 'x.docx')

  it('keeps text, headings and the title', () => {
    expect(back.title).toBe('Quarterly plan')
    expect(back.doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(textOf(back.doc.content[0])).toBe('Plan & "goals" <2026>')
    const all = textOf(back.doc)
    for (const s of ['after a break', 'Quoted words', 'Last page', 'nested', 'fourth']) expect(all).toContain(s)
  })

  it('keeps character formatting', () => {
    const para = back.doc.content[1]
    const mark = (word: string) => para.content!.find((n) => n.text === word)?.marks?.map((m) => m.type).sort()
    expect(mark('bold')).toEqual(['bold'])
    expect(mark('italic')).toEqual(['italic'])
    expect(mark('both')).toEqual(['bold', 'italic'])
    expect(mark('Underlined')).toEqual(['underline'])
    expect(mark('struck')).toEqual(['strike'])
    const styled = back.doc.content[2].content!.find((n) => n.text === 'Styled')!
    const ts = styled.marks!.find((m) => m.type === 'textStyle')!.attrs!
    expect(ts.color).toBe('#c00000')
    expect(ts.fontSize).toBe('16pt')
    expect(String(ts.fontFamily)).toContain('Georgia')
    expect(back.doc.content[2].content!.find((n) => n.text === 'marked')!.marks!.find((m) => m.type === 'highlight')!.attrs!.color).toBe('#ffff00')
    expect(back.doc.content[2].content!.find((n) => n.text === '2')!.marks![0].type).toBe('superscript')
  })

  it('keeps paragraph formatting, links, breaks and tabs', () => {
    expect(back.doc.content[2].attrs).toMatchObject({ textAlign: 'center', lineHeight: 1.5, spaceAfter: 20 })
    const p4 = back.doc.content[3]
    expect(p4.attrs).toMatchObject({ textAlign: 'justify', indent: 36 })
    expect(p4.content!.find((n) => n.text === 'A link')!.marks!.find((m) => m.type === 'link')!.attrs!.href).toBe('https://example.org/a?b=1&c=2')
    expect(p4.content!.some((n) => n.type === 'hardBreak')).toBe(true)
    expect(textOf(p4)).toContain('\tand a tab')
  })

  it('keeps nested, numbered and check lists', () => {
    const bullet = back.doc.content[4]
    expect(bullet.type).toBe('bulletList')
    expect(find(bullet, 'bulletList')).toHaveLength(2)
    expect(textOf(bullet.content![0])).toContain('nested')
    const ordered = back.doc.content[5]
    expect(ordered).toMatchObject({ type: 'orderedList', attrs: { start: 3 } })
    expect(ordered.content).toHaveLength(2)
    const tasks = back.doc.content[6]
    expect(tasks.type).toBe('taskList')
    expect(tasks.content!.map((i) => i.attrs!.checked)).toEqual([true, false])
  })

  it('keeps tables with merged cells and shading', () => {
    const tbl = back.doc.content[7]
    expect(tbl.type).toBe('table')
    expect(tbl.content).toHaveLength(3)
    expect(tbl.content![0].content![0].type).toBe('tableHeader')
    expect(tbl.content![0].content![1].attrs).toMatchObject({ colspan: 2 })
    const tall = tbl.content![1].content![0]
    expect(tall.attrs).toMatchObject({ rowspan: 2, backgroundColor: '#ffeecc' })
    expect(tbl.content![2].content).toHaveLength(2)
  })

  it('keeps quotes, code, images and page breaks', () => {
    const types = back.doc.content.map((n) => n.type)
    expect(types).toContain('blockquote')
    const code = back.doc.content.find((n) => n.type === 'codeBlock')!
    expect(code.content![0].text).toBe('let a = 1\nlet b = 2')
    const img = find(back.doc, 'image')[0]
    expect(String(img.attrs!.src)).toMatch(/^data:image\/png;base64,/)
    expect(img.attrs).toMatchObject({ width: 40, height: 40, alt: 'dot' })
    expect(types).toContain('pageBreak')
    expect(back.doc.content[back.doc.content.length - 1].attrs).toMatchObject({ pStyle: 'title' })
  })

  it('keeps page setup, header, footer and body font', () => {
    expect(back.settings).toMatchObject({ size: 'a4', orientation: 'landscape', bodyFont: 'Cambria', bodySize: 12 })
    expect(back.settings.margins.left).toBeCloseTo(1.2, 2)
    expect(back.settings.margins.top).toBeCloseTo(0.8, 2)
    expect(back.settings.header.left).toBe('Kwiiva')
    expect(back.settings.footer.center).toBe('Page {page} of {pages}')
  })
})
