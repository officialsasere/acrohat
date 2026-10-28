import { pagePx, type PageSettings } from '../formats/types'
import { fontStack } from '../../../shared/fonts'
import type { LayoutConfig } from './pagination'
import { PAGE_GAP } from './pagination'

/** Geometry the editor and the printer both use, in CSS pixels. */
export function layoutFor(s: PageSettings, enabled: boolean): LayoutConfig {
  const p = pagePx(s)
  const m = s.margins
  return { enabled, pageH: p.h, top: Math.round(m.top * 96), bottom: Math.round(m.bottom * 96), left: Math.round(m.left * 96), right: Math.round(m.right * 96), gap: PAGE_GAP, header: s.header, footer: s.footer }
}

export function paperCssVars(s: PageSettings, printLayout: boolean): Record<string, string> {
  const p = pagePx(s)
  const m = s.margins
  return {
    '--page-w': p.w + 'px',
    '--m-top': Math.round(m.top * 96) + 'px',
    '--m-bottom': Math.round(m.bottom * 96) + 'px',
    '--m-left': Math.round(m.left * 96) + 'px',
    '--m-right': Math.round(m.right * 96) + 'px',
    '--body-font': fontStack(s.bodyFont),
    '--body-size': s.bodySize + 'pt',
    '--paper-mode': printLayout ? 'print' : 'web',
  }
}

/** CSS injected while printing, so the browser's own page breaks match the chosen paper and margins. */
export function printCss(s: PageSettings): string {
  const { w, h } = { w: pagePx(s).w, h: pagePx(s).h }
  const m = s.margins
  const hf = (t: { left: string; center: string; right: string }, pos: 'top' | 'bottom') => {
    const q = (v: string) => `"${v.replace(/\{pages\}/g, '" counter(pages) "').replace(/\{page\}/g, '" counter(page) "').replace(/"/g, '\\"')}"`
    return (['left', 'center', 'right'] as const).map((z) => (t[z] ? `@${pos}-${z} { content: ${q(t[z])}; font-size: 9pt; font-family: ${fontStack(s.bodyFont)}; }` : '')).join('\n')
  }
  return `@page { size: ${w}px ${h}px; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; ${hf(s.header, 'top')} ${hf(s.footer, 'bottom')} }`
}
