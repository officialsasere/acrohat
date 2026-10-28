/** Facts about the .xlsx format that the reader and the writer both need. */

export const BUILTIN_FMT: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0;(#,##0)', 38: '#,##0;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
}
export const FMT_ID = new Map(Object.entries(BUILTIN_FMT).map(([id, f]) => [f, Number(id)]))

/** Functions added after the first version of the format are stored with a prefix; without it other programs show #NAME?. */
export const XLFN = new Set([
  'IFS', 'SWITCH', 'XLOOKUP', 'XMATCH', 'FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'TEXTJOIN', 'CONCAT', 'MAXIFS', 'MINIFS', 'IFNA', 'XOR', 'DAYS', 'ISOWEEKNUM',
  'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'BINOM.DIST', 'BINOM.INV', 'POISSON.DIST', 'EXPON.DIST', 'GAMMA.DIST', 'GAMMA.INV', 'GAMMA', 'GAMMALN.PRECISE',
  'T.DIST', 'T.DIST.2T', 'T.DIST.RT', 'T.INV', 'T.INV.2T', 'CHISQ.DIST', 'CHISQ.DIST.RT', 'CHISQ.INV', 'CHISQ.INV.RT', 'F.DIST', 'F.DIST.RT', 'F.INV', 'F.INV.RT', 'CONFIDENCE.NORM', 'CONFIDENCE.T',
  'LOGNORM.DIST', 'LOGNORM.INV', 'WEIBULL.DIST', 'BETA.DIST', 'Z.TEST', 'T.TEST', 'MODE.SNGL', 'MODE.MULT', 'RANK.EQ', 'RANK.AVG', 'PERCENTILE.INC', 'PERCENTILE.EXC', 'QUARTILE.INC', 'QUARTILE.EXC',
  'PERCENTRANK.INC', 'PERCENTRANK.EXC', 'COVARIANCE.P', 'COVARIANCE.S', 'FORECAST.LINEAR', 'SKEW.P', 'CEILING.MATH', 'FLOOR.MATH', 'NETWORKDAYS.INTL', 'WORKDAY.INTL', 'TEXTBEFORE', 'TEXTAFTER', 'TEXTSPLIT',
  'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSEROWS', 'CHOOSECOLS', 'TOCOL', 'TOROW', 'WRAPROWS', 'WRAPCOLS', 'EXPAND', 'ARRAYTOTEXT', 'VALUETOTEXT', 'NUMBERVALUE', 'PDURATION', 'RRI', 'PERMUTATIONA', 'COMBINA',
  'FORMULATEXT', 'ISFORMULA', 'SHEET', 'SHEETS', 'BITAND', 'BITOR', 'BITXOR', 'BITLSHIFT', 'BITRSHIFT', 'ERF.PRECISE', 'GAUSS', 'PHI', 'FISHER', 'UNICHAR', 'UNICODE', 'EPOCHTODATE',
])

/** Indexed colours (the old fixed palette). */
export const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333']
/** The default theme: lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink. */
export const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72']

export function tint(hex: string, t: number): string {
  const n = parseInt(hex, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = t < 0 ? v * (1 + t) : v + (255 - v) * t
    return Math.max(0, Math.min(255, Math.round(x)))
  })
  return ch.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export const colWidthToPx = (w: number) => Math.round(w * 7 + 5)
export const pxToColWidth = (px: number) => Math.round(((px - 5) / 7) * 100) / 100
export const pxToPt = (px: number) => Math.round(px * 0.75 * 100) / 100
export const ptToPx = (pt: number) => Math.round((pt * 4) / 3)
