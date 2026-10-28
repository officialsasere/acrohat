// Generates the brand artwork in public/ (run: node scripts/make-logos.mjs).
// The lettering is drawn as monoline strokes instead of a font, so the logos look the same everywhere and need no font file.
import { writeFileSync } from 'node:fs'

const SW = 22 // stroke width in glyph units; x-height 100, cap height 150, descender 50
const GLYPHS = {
  K: { w: 90, d: 'M0 -150V0M85 -150L0 -52M30 -87L90 0' },
  P: { w: 76, d: 'M0 -150V0M0 -150H38A38 38 0 0 1 38 -74H0' },
  w: { w: 140, d: 'M0 -100L35 0L70 -100L105 0L140 -100' },
  v: { w: 80, d: 'M0 -100L40 0L80 -100' },
  i: { w: 0, d: 'M0 -100V0', dot: [0, -142] },
  a: { w: 75, d: 'M37 -88A38 38 0 1 0 37 -12A38 38 0 1 0 37 -88ZM75 -100V0' },
  p: { w: 76, d: 'M0 -100V50M38 -88A38 38 0 1 1 38 -12A38 38 0 1 1 38 -88Z' },
  e: { w: 76, d: 'M0 -50H76A38 38 0 0 0 0 -50A38 38 0 0 0 70.9 -31' },
  W: { w: 150, d: 'M0 -150L35 0L75 -105L115 0L150 -150' },
  t: { w: 46, d: 'M18 -138V-30Q18 0 46 0M0 -100H46' },
  G: { w: 100, d: 'M100 -118A66 66 0 1 0 100 -30V-70H62' },
  d: { w: 75, d: 'M37 -88A38 38 0 1 0 37 -12A38 38 0 1 0 37 -88ZM75 -150V0' },
  r: { w: 50, d: 'M0 -100V0M0 -56C0 -86 18 -100 50 -100' },
}
const GAP = 38

/** Returns { w, paths } for a string, origin at the baseline's left edge. */
function word(text, { ink, dot }) {
  let x = 0, out = ''
  for (const ch of text) {
    if (ch === ' ') { x += 50; continue }
    const g = GLYPHS[ch]
    out += `<path transform="translate(${x} 0)" d="${g.d}"/>`
    if (g.dot) out += `<circle transform="translate(${x} 0)" cx="${g.dot[0]}" cy="${g.dot[1]}" r="${SW * 0.72}" fill="${dot}" stroke="none"/>`
    x += g.w + GAP
  }
  return { w: x - GAP, svg: `<g fill="none" stroke="${ink}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">${out}</g>` }
}

const KWIIVA_BG = `<linearGradient id="kbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9925b"/><stop offset=".6" stop-color="#8f5a33"/><stop offset="1" stop-color="#4e2e19"/></linearGradient>`
const HIGHLIGHT = `<path d="M0 232C0 104 104 0 232 0h560c-210 40-470 150-792 420z" fill="#fff" opacity=".18"/>`
const AMBER = '#d49a4a' // caramel
const CREAM = '#fff8ec'

/** Kwiiva mark: a K whose upper arm ends in the dot of an "i" — the dot is the brand's signature. */
function kwiivaMark(id = 'k') {
  const s = 3.7, ox = 362, oy = 790
  const t = (x, y) => `${(ox + x * s).toFixed(1)} ${(oy + y * s).toFixed(1)}`
  return `<defs>${KWIIVA_BG.replace('kbg', id + 'bg')}</defs>
  <rect width="1024" height="1024" rx="232" fill="url(#${id}bg)"/>${HIGHLIGHT}
  <g fill="none" stroke="${CREAM}" stroke-width="${(SW * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${t(0, -150)}V${(oy).toFixed(1)}"/>
    <path d="M${t(0, -52)}L${t(58, -119)}"/>
    <path d="M${t(30, -87)}L${t(90, 0)}"/>
  </g>
  <circle cx="${(ox + 90 * s).toFixed(1)}" cy="${(oy - 160 * s).toFixed(1)}" r="${(SW * 0.9 * s).toFixed(1)}" fill="#f6d28b"/>`
}

const paperMark = `<defs>
    <linearGradient id="pbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e9d2"/><stop offset=".55" stop-color="#e2c299"/><stop offset="1" stop-color="#c39560"/></linearGradient>
    <linearGradient id="ppage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffefb"/><stop offset="1" stop-color="#f6ecdc"/></linearGradient>
    <linearGradient id="pink" gradientUnits="userSpaceOnUse" x1="300" y1="300" x2="720" y2="800"><stop offset="0" stop-color="#b9824a"/><stop offset="1" stop-color="#6e4020"/></linearGradient>
    <filter id="psh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#5a3414" flood-opacity=".30"/></filter>
  </defs>
  <rect width="1024" height="1024" rx="232" fill="url(#pbg)"/>${HIGHLIGHT}
  <g filter="url(#psh)"><path d="M262 150h330l190 190v518c0 32-26 58-58 58H262c-32 0-58-26-58-58V208c0-32 26-58 58-58z" fill="url(#ppage)"/></g>
  <path d="M592 150v152c0 20 18 38 38 38h152z" fill="#e6cfae"/>
  <rect x="300" y="262" width="230" height="46" rx="23" fill="url(#pink)"/>
  <g stroke="#eadcc6" stroke-width="30" stroke-linecap="round"><path d="M315 392h370M315 466h370M315 540h250"/></g>
  <g stroke="#3a2416" stroke-width="15" stroke-linecap="round"><path d="M610 508v66M592 508h36M592 574h36"/></g>
  <path d="M300 770c36-84 66-96 82-52s30 74 70 20 62-86 86-48 46 52 92 0" fill="none" stroke="url(#pink)" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M300 826h400" stroke="#eadcc6" stroke-width="12" stroke-linecap="round"/>`

const writeMark = `<defs>
    <linearGradient id="wbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d9a0"/><stop offset=".55" stop-color="#e0a85a"/><stop offset="1" stop-color="#b9772e"/></linearGradient>
    <linearGradient id="wpage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffefb"/><stop offset="1" stop-color="#f6ecdc"/></linearGradient>
    <linearGradient id="wink" gradientUnits="userSpaceOnUse" x1="300" y1="300" x2="720" y2="800"><stop offset="0" stop-color="#b9824a"/><stop offset="1" stop-color="#6e4020"/></linearGradient>
    <linearGradient id="wpen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5a36"/><stop offset=".5" stop-color="#b9824a"/><stop offset="1" stop-color="#6e4020"/></linearGradient>
    <filter id="wsh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#5a3414" flood-opacity=".30"/></filter>
  </defs>
  <rect width="1024" height="1024" rx="232" fill="url(#wbg)"/>${HIGHLIGHT}
  <g filter="url(#wsh)"><path d="M262 150h330l190 190v518c0 32-26 58-58 58H262c-32 0-58-26-58-58V208c0-32 26-58 58-58z" fill="url(#wpage)"/></g>
  <path d="M592 150v152c0 20 18 38 38 38h152z" fill="#e6cfae"/>
  <rect x="300" y="262" width="250" height="52" rx="26" fill="url(#wink)"/>
  <g stroke="#eadcc6" stroke-width="30" stroke-linecap="round"><path d="M315 400h370M315 474h370M315 548h370M315 622h210"/></g>
  <g transform="translate(722 560) rotate(40)" filter="url(#wsh)">
    <rect x="-44" y="-40" width="88" height="330" rx="10" fill="url(#wpen)"/>
    <rect x="-44" y="-70" width="88" height="40" rx="8" fill="#e6cfae"/>
    <path d="M-44 290 0 380 44 290z" fill="#f6e6cc"/>
    <path d="M-15 350 0 380 15 350z" fill="#3a2416"/>
  </g>`

const gridMark = `<defs>
    <linearGradient id="gbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0b494"/><stop offset=".55" stop-color="#d27a56"/><stop offset="1" stop-color="#9a4a2e"/></linearGradient>
    <linearGradient id="gpage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffefb"/><stop offset="1" stop-color="#f6ecdc"/></linearGradient>
    <linearGradient id="gink" gradientUnits="userSpaceOnUse" x1="260" y1="260" x2="760" y2="760"><stop offset="0" stop-color="#c0653f"/><stop offset="1" stop-color="#7a3820"/></linearGradient>
    <filter id="gsh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#5a2a14" flood-opacity=".32"/></filter>
  </defs>
  <rect width="1024" height="1024" rx="232" fill="url(#gbg)"/>${HIGHLIGHT}
  <g filter="url(#gsh)"><rect x="172" y="172" width="680" height="680" rx="56" fill="url(#gpage)"/></g>
  <path d="M228 172h568a56 56 0 0 1 56 56v112H172V228a56 56 0 0 1 56-56z" fill="url(#gink)"/>
  <g stroke="#e3d3bb" stroke-width="12" stroke-linecap="round"><path d="M172 508H852M172 676H852M400 340V852M626 340V852"/></g>
  <rect x="404" y="344" width="218" height="160" fill="#fff0d9" opacity=".9"/>
  <rect x="404" y="344" width="218" height="164" rx="6" fill="none" stroke="#b4573a" stroke-width="16"/>
  <rect x="610" y="494" width="30" height="30" rx="6" fill="#b4573a" stroke="#fff" stroke-width="6"/>
  <g fill="#c0653f"><rect x="448" y="750" width="46" height="62" rx="8"/><rect x="520" y="706" width="46" height="106" rx="8"/><rect x="692" y="560" width="46" height="252" rx="8" opacity=".0"/></g>
  <g fill="#a8553a"><rect x="676" y="620" width="46" height="192" rx="8"/><rect x="748" y="570" width="46" height="242" rx="8"/></g>
  <g stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".95"><path d="M246 262h110M246 262l50 0"/></g>`

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  ${body}\n</svg>\n`
const nested = (inner, x, y, size) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 1024 1024">${inner}</svg>`

function lockup(markInner, { ink, name, sub }) {
  const size = 200, pad = 28
  const main = word(name, { ink, dot: AMBER })
  const k = sub ? 0.62 : 0.9 // wordmark scale
  const baseline = sub ? 100 : 152
  let body = nested(markInner, pad, pad, size)
  let width = pad + size + 36 + main.w * k + pad
  body += `<g transform="translate(${pad + size + 36} ${pad + baseline}) scale(${k})">${main.svg}</g>`
  if (sub) {
    const s2 = word(sub, { ink: '#9a6236', dot: AMBER })
    body += `<g transform="translate(${pad + size + 36} ${pad + 198}) scale(.55)">${s2.svg}</g>`
    width = Math.max(width, pad + size + 36 + s2.w * 0.55 + pad)
  }
  return svg(Math.ceil(width), size + pad * 2, body)
}

const out = (f, s) => writeFileSync(new URL(`../public/${f}`, import.meta.url), s)
out('kwiiva.svg', svg(1024, 1024, kwiivaMark()))
out('favicon.svg', svg(1024, 1024, kwiivaMark()))
out('paper.svg', svg(1024, 1024, paperMark))
out('write.svg', svg(1024, 1024, writeMark))
out('grid.svg', svg(1024, 1024, gridMark))
out('write-lockup.svg', lockup(writeMark.replace(/id="w(bg|page|ink|pen|sh)"/g, 'id="x$1"').replace(/url\(#w(bg|page|ink|pen|sh)\)/g, 'url(#x$1)'), { ink: '#2b1d14', name: 'Kwiiva', sub: 'Write' }))
out('grid-lockup.svg', lockup(gridMark.replace(/id="g(bg|page|ink|sh)"/g, 'id="y$1"').replace(/url\(#g(bg|page|ink|sh)\)/g, 'url(#y$1)'), { ink: '#2b1d14', name: 'Kwiiva', sub: 'Grid' }))
out('kwiiva-lockup.svg', lockup(kwiivaMark('lk'), { ink: '#2b1d14', name: 'Kwiiva' }))
out('paper-lockup.svg', lockup(paperMark.replace(/id="p(bg|page|ink|sh)"/g, 'id="q$1"').replace(/url\(#p(bg|page|ink|sh)\)/g, 'url(#q$1)'), { ink: '#2b1d14', name: 'Kwiiva', sub: 'Paper' }))
// The wordmark alone, for inlining in pages (uses currentColor so it follows light/dark mode).
const wm = word('Kwiiva', { ink: 'currentColor', dot: AMBER })
out('kwiiva-wordmark.svg', svg(Math.ceil(wm.w + SW), 220, `<g transform="translate(${SW / 2} 178)">${wm.svg}</g>`).replace('currentColor', '#2b1d14'))
console.log('wordmark path width', wm.w)
