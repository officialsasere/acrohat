import type { Editor } from '@tiptap/core'
import { DEFAULT_SIZE } from '../../../shared/fonts'

export const STYLES = [
  { id: 'normal', label: 'Normal text' },
  { id: 'title', label: 'Title' },
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'h4', label: 'Heading 4' },
  { id: 'quote', label: 'Quote' },
  { id: 'code', label: 'Code' },
] as const
export type StyleId = (typeof STYLES)[number]['id']

export function currentStyle(e: Editor): StyleId {
  for (let l = 1; l <= 4; l++) if (e.isActive('heading', { level: l })) return `h${l}` as StyleId
  if (e.isActive('blockquote')) return 'quote'
  if (e.isActive('codeBlock')) return 'code'
  const p = e.getAttributes('paragraph').pStyle
  return p === 'title' ? 'title' : p === 'subtitle' ? 'subtitle' : 'normal'
}

export function applyStyle(e: Editor, s: StyleId) {
  const c = e.chain().focus()
  // Clear whatever block style is there first so styles replace each other.
  const base = () => { if (e.isActive('blockquote')) c.lift('blockquote'); if (e.isActive('codeBlock')) c.setParagraph() }
  base()
  if (s.startsWith('h')) c.setHeading({ level: Number(s[1]) as 1 | 2 | 3 | 4 }).setParagraphStyle('normal').run()
  else if (s === 'quote') c.setParagraph().setBlockquote().run()
  else if (s === 'code') c.setCodeBlock().run()
  else c.setParagraph().setParagraphStyle(s === 'title' || s === 'subtitle' ? s : 'normal').run()
}

export const fontSizeOf = (e: Editor): number => {
  const v = e.getAttributes('textStyle').fontSize as string | undefined
  return v ? parseFloat(v) : DEFAULT_SIZE
}

export function stepFontSize(e: Editor, base: number, dir: 1 | -1) {
  const cur = e.getAttributes('textStyle').fontSize ? fontSizeOf(e) : base
  const sizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48, 56, 64, 72, 96]
  const next = dir > 0 ? sizes.find((s) => s > cur) ?? cur : [...sizes].reverse().find((s) => s < cur) ?? cur
  e.chain().focus().setFontSize(`${next}pt`).run()
}

export function clearFormatting(e: Editor) {
  e.chain().focus().unsetAllMarks().setParagraphStyle('normal').setLineHeight(null).setSpacing({ before: null, after: null }).setFirstLine(null).run()
}

export const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
]

export const SYMBOLS = [
  ...'©®™§¶†‡•…‰′″‹›«»‘’“”–—±×÷≠≈≤≥∞√∑∏∫∂∆∇∈∉⊂⊃∪∩∧∨¬∀∃∅°µπΩαβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΘΛΞΠΣΦΨ',
  ...'←↑→↓↔↕⇐⇒⇔✓✔✗✘★☆♠♣♥♦♪♫☀☁☂☎☑☒☐✉✂✈€£¥¢₹₩₽₿¼½¾⅓⅔⅛⅜⅝⅞¹²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅₆₇₈₉',
  ...'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿŒœŠšŽž',
]
