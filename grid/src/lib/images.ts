/** Shrinks a picture so the spreadsheet file stays small. Photos become JPEG, everything else PNG. */
export async function fileToImage(file: File, maxW = 1400): Promise<{ src: string; width: number; height: number } | null> {
  if (!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(file.type)) return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const w0 = img.naturalWidth || 300, h0 = img.naturalHeight || 200, k = Math.min(1, maxW / w0)
    const c = document.createElement('canvas')
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const shown = Math.min(c.width, 420)
    return { src: c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9), width: shown, height: Math.round((shown * c.height) / c.width) }
  } finally { URL.revokeObjectURL(url) }
}
