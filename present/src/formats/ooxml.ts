import type { ArrowEnd, BulletKind, Dash, Effect, ThemeColor } from '../model'

export const EMU = 12700
export const emu = (pt: number) => Math.round(pt * EMU)
export const pt = (e: string | number | undefined) => (e === undefined ? 0 : Number(e) / EMU)

export const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
export const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
export const REL = {
  doc: `${NS_R}/officeDocument`, master: `${NS_R}/slideMaster`, layout: `${NS_R}/slideLayout`, slide: `${NS_R}/slide`, theme: `${NS_R}/theme`, notesMaster: `${NS_R}/notesMaster`, notesSlide: `${NS_R}/notesSlide`,
  image: `${NS_R}/image`, hyperlink: `${NS_R}/hyperlink`, chart: `${NS_R}/chart`, pkg: `${NS_R}/package`, presProps: `${NS_R}/presProps`, viewProps: `${NS_R}/viewProps`, tableStyles: `${NS_R}/tableStyles`,
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', app: `${NS_R}/extended-properties`, video: `${NS_R}/video`, audio: `${NS_R}/audio`, media: 'http://schemas.microsoft.com/office/2007/relationships/media',
  kwiiva: 'https://kwiiva.netlify.app/schemas/present/deck',
}
export const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export const SCHEME: Record<ThemeColor, string> = { bg: 'bg1', text: 'tx1', bg2: 'bg2', text2: 'tx2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', link: 'hlink' }
export const SCHEME_REV: Record<string, ThemeColor> = { bg1: 'bg', lt1: 'bg', tx1: 'text', dk1: 'text', bg2: 'bg2', lt2: 'bg2', tx2: 'text2', dk2: 'text2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'link', folHlink: 'link' }

export const DASH_OUT: Record<Dash, string> = { solid: 'solid', dash: 'dash', dot: 'sysDot', dashDot: 'dashDot' }
export const DASH_IN: Record<string, Dash> = { solid: 'solid', dash: 'dash', sysDash: 'dash', lgDash: 'dash', dot: 'dot', sysDot: 'dot', dashDot: 'dashDot', sysDashDot: 'dashDot', lgDashDot: 'dashDot' }
export const ARROW_OUT: Record<ArrowEnd, string | null> = { none: null, triangle: 'triangle', open: 'arrow', stealth: 'stealth', oval: 'oval', diamond: 'diamond' }
export const ARROW_IN: Record<string, ArrowEnd> = { triangle: 'triangle', arrow: 'open', stealth: 'stealth', oval: 'oval', diamond: 'diamond' }

export const BULLET_CHAR: Record<string, string> = { disc: '•', circle: '○', square: '▪', dash: '–', arrow: '➢', check: '✓' }
export const NUM_OUT: Partial<Record<BulletKind, string>> = { num: 'arabicPeriod', alpha: 'alphaLcPeriod', Alpha: 'alphaUcPeriod', roman: 'romanLcPeriod', Roman: 'romanUcPeriod' }
export const NUM_IN: Record<string, BulletKind> = { arabicPeriod: 'num', arabicParenR: 'num', arabicPlain: 'num', alphaLcPeriod: 'alpha', alphaLcParenR: 'alpha', alphaUcPeriod: 'Alpha', alphaUcParenR: 'Alpha', romanLcPeriod: 'roman', romanUcPeriod: 'Roman' }
export const CHAR_IN = (c: string): BulletKind => (c === '–' || c === '-' || c === '—' ? 'dash' : c === '○' || c === 'o' || c === '◦' ? 'circle' : c === '▪' || c === '§' || c === '■' || c === '□' ? 'square' : c === '➢' || c === 'Ø' || c === '➔' || c === '►' || c === '' ? 'arrow' : c === '✓' || c === 'ü' || c === '✔' ? 'check' : 'disc')

/** Our placeholder roles ↔ .pptx placeholder types. */
export const PH_OUT: Record<string, string> = { title: 'title', subtitle: 'subTitle', body: 'body', body2: 'body', object: 'body', picture: 'pic', footer: 'ftr', date: 'dt', num: 'sldNum' }

/** Preset id and class of each animation (the numbers PowerPoint uses). */
export const ANIM_PRESET: Record<Effect, { id: number; cls: 'entr' | 'exit' | 'emph' }> = {
  appear: { id: 1, cls: 'entr' }, fly: { id: 2, cls: 'entr' }, blinds: { id: 3, cls: 'entr' }, wipe: { id: 22, cls: 'entr' }, split: { id: 16, cls: 'entr' }, fade: { id: 10, cls: 'entr' },
  zoom: { id: 53, cls: 'entr' }, float: { id: 42, cls: 'entr' }, grow: { id: 6, cls: 'emph' }, spin: { id: 8, cls: 'emph' }, pulse: { id: 26, cls: 'emph' }, bounce: { id: 26, cls: 'emph' }, teeter: { id: 32, cls: 'emph' }, color: { id: 26, cls: 'emph' },
}
export const ANIM_BY_ID: Record<string, Effect> = { '1': 'appear', '2': 'fly', '3': 'blinds', '22': 'wipe', '16': 'split', '10': 'fade', '53': 'zoom', '42': 'float', '6': 'grow', '8': 'spin', '26': 'pulse', '32': 'teeter' }

export const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'video/webm': 'webm' }
export const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'video/webm', m4a: 'audio/mp4', mov: 'video/quicktime', emf: 'image/x-emf', wmf: 'image/x-wmf' }

export function dataUrlToBytes(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src)
  if (!m) return null
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime: m[1] }
}
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return `data:${mime};base64,${btoa(bin)}`
}
