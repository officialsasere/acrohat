import { describe, expect, it } from 'vitest'
import { formatGeneral, formatValue as f, editText } from '../grid/src/engine/numfmt'
import { parseDateTime, serialToYmd, ymdToSerial } from '../grid/src/engine/dates'

const t = (v: number | string | boolean | null, fmt: string) => f(v, fmt).text

describe('number formats', () => {
  it('General', () => {
    expect(formatGeneral(1)).toBe('1')
    expect(formatGeneral(0.1 + 0.2)).toBe('0.3')
    expect(formatGeneral(1 / 3)).toBe('0.333333333')
    expect(formatGeneral(123456789012)).toBe('1.23457E+11')
    expect(formatGeneral(-1234.5678)).toBe('-1234.5678')
    expect(formatGeneral(0.000000001234)).toBe('1.234E-09')
  })
  it('fixed decimals, thousands, percent, currency', () => {
    expect(t(1234.5, '0')).toBe('1235')
    expect(t(1234.5, '0.00')).toBe('1234.50')
    expect(t(1234567.891, '#,##0.00')).toBe('1,234,567.89')
    expect(t(0.1234, '0.0%')).toBe('12.3%')
    expect(t(0.5, '0%')).toBe('50%')
    expect(t(1234.5, '$#,##0.00')).toBe('$1,234.50')
    expect(t(-1234.5, '$#,##0.00')).toBe('-$1,234.50')
    expect(t(1.005, '0.00')).toBe('1.01')
    expect(t(0, '0.00')).toBe('0.00')
    expect(t(0.5, '#.##')).toBe('.5')
    expect(t(12, '000')).toBe('012')
    expect(t(1500000, '0.0,,"M"')).toBe('1.5M')
    expect(t(12345, '#,##0,"K"')).toBe('12K')
  })
  it('sections: negatives, zero, text, colors, conditions', () => {
    expect(t(-5, '#,##0;(#,##0)')).toBe('(5)')
    expect(t(0, '0;-0;"zero"')).toBe('zero')
    expect(t('hi', '0;0;0;"text: "@')).toBe('text: hi')
    expect(f(-3, '0;[Red]-0').color).toBeTruthy()
    expect(t(150, '[>=100]"big";"small"')).toBe('big')
    expect(t(50, '[>=100]"big";"small"')).toBe('small')
  })
  it('scientific and fractions', () => {
    expect(t(12345, '0.00E+00')).toBe('1.23E+04')
    expect(t(0.00012, '0.0E+00')).toBe('1.2E-04')
    expect(t(3.5, '# ?/?')).toBe('3 1/2')
    expect(t(0.75, '# ?/?')).toBe('3/4')
    expect(t(0.3333, '# ??/??')).toBe('1/3')
  })
  it('phone-style literals between digits', () => {
    expect(t(5551234567, '(000) 000-0000')).toBe('(555) 123-4567')
    expect(t(12345, '00000-0000')).toBe('00001-2345')
  })
  it('dates and times', () => {
    const d = ymdToSerial(2026, 3, 14) // a Saturday
    expect(t(d, 'yyyy-mm-dd')).toBe('2026-03-14')
    expect(t(d, 'm/d/yyyy')).toBe('3/14/2026')
    expect(t(d, 'mmmm d, yyyy')).toBe('March 14, 2026')
    expect(t(d, 'ddd mmm d')).toBe('Sat Mar 14')
    expect(t(d, 'dddd')).toBe('Saturday')
    expect(t(0.5625, 'h:mm AM/PM')).toBe('1:30 PM')
    expect(t(0.5625, 'hh:mm:ss')).toBe('13:30:00')
    expect(t(d + 0.25, 'yyyy-mm-dd hh:mm')).toBe('2026-03-14 06:00')
    expect(t(1.5, '[h]:mm')).toBe('36:00')
    expect(t(61 / 86400, 'mm:ss')).toBe('01:01')
  })
  it('text, booleans, errors, empty', () => {
    expect(t('abc', '0.00')).toBe('abc')
    expect(t(true, '0')).toBe('TRUE')
    expect(f(null).text).toBe('')
  })
  it('editing text shows full precision and dates as dates', () => {
    expect(editText(0.1 + 0.2)).toBe('0.3')
    expect(editText(ymdToSerial(2026, 3, 14), 'yyyy-mm-dd')).toBe('3/14/2026')
    expect(editText(0.25, '0%')).toBe('25%')
  })
})

describe('dates', () => {
  it('serials match the 1900 system, including its leap-year bug', () => {
    expect(ymdToSerial(1900, 1, 1)).toBe(1)
    expect(ymdToSerial(1900, 2, 28)).toBe(59)
    expect(ymdToSerial(1900, 3, 1)).toBe(61)
    expect(ymdToSerial(2000, 1, 1)).toBe(36526)
    expect(ymdToSerial(2026, 3, 14)).toBe(46095)
    expect(serialToYmd(60)).toEqual({ y: 1900, m: 2, d: 29 })
    expect(serialToYmd(36526)).toEqual({ y: 2000, m: 1, d: 1 })
    expect(serialToYmd(ymdToSerial(2024, 2, 29))).toEqual({ y: 2024, m: 2, d: 29 })
  })
  it('reads dates and times people type', () => {
    expect(parseDateTime('2026-03-14')?.serial).toBe(46095)
    expect(parseDateTime('3/14/2026')?.serial).toBe(46095)
    expect(parseDateTime('14 Mar 2026')?.serial).toBe(46095)
    expect(parseDateTime('March 14, 2026')?.serial).toBe(46095)
    expect(parseDateTime('13:30')?.serial).toBeCloseTo(0.5625)
    expect(parseDateTime('1:30 PM')?.serial).toBeCloseTo(0.5625)
    expect(parseDateTime('2026-03-14 13:30')?.serial).toBeCloseTo(46095.5625)
    expect(parseDateTime('13/45/2026')).toBeNull()
    expect(parseDateTime('hello')).toBeNull()
  })
})
