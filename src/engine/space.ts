import { heap, withBuf, type Pdfium } from './core'

export type Pt = [number, number]
export type DRect = { x: number; y: number; w: number; h: number }

/**
 * Converts between PDF user space (origin bottom-left, unrotated) and "device points"
 * (origin top-left, page rotation applied, 1 unit = 1/72 in). The UI only ever sees device points.
 */
export class PageSpace {
  constructor(
    private m: Pdfium,
    private page: number,
    readonly width: number,
    readonly height: number,
  ) {}

  toDevice(x: number, y: number): Pt {
    const m = this.m
    // FPDF_PageToDevice takes an integer viewport and returns ints; scale by 100 for sub-point precision.
    const S = 100
    return withBuf(m, 8, (p) => {
      m.FPDF_PageToDevice(this.page, 0, 0, Math.round(this.width * S), Math.round(this.height * S), 0, x, y, p, p + 4)
      const dv = new DataView(heap(m).buffer)
      return [dv.getInt32(p, true) / S, dv.getInt32(p + 4, true) / S]
    })
  }

  toPage(dx: number, dy: number): Pt {
    const m = this.m
    const S = 100
    return withBuf(m, 16, (p) => {
      m.FPDF_DeviceToPage(this.page, 0, 0, Math.round(this.width * S), Math.round(this.height * S), 0, Math.round(dx * S), Math.round(dy * S), p, p + 8)
      const dv = new DataView(heap(m).buffer)
      return [dv.getFloat64(p, true), dv.getFloat64(p + 8, true)]
    })
  }

  /** Bounding box in device points of a rectangle given in page space. */
  rectToDevice(left: number, bottom: number, right: number, top: number): DRect {
    const pts = [this.toDevice(left, bottom), this.toDevice(right, top), this.toDevice(left, top), this.toDevice(right, bottom)]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }

  /** Bounding box in page space (left, bottom, right, top) of a device rectangle. */
  rectToPage(r: DRect): { left: number; bottom: number; right: number; top: number } {
    const pts = [this.toPage(r.x, r.y), this.toPage(r.x + r.w, r.y + r.h), this.toPage(r.x + r.w, r.y), this.toPage(r.x, r.y + r.h)]
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) }
  }
}

