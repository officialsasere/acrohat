import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, StandardFonts, type PDFField } from 'pdf-lib'

/** AcroForm support, built on pdf-lib (which also regenerates field appearances when values change). */

export type FieldType = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list'

export interface FormField {
  /** Fully qualified field name. */
  name: string
  type: FieldType
  /** One entry per on-page widget (a radio group has one per option). */
  widgets: { page: number; rect: [number, number, number, number]; option?: string }[]
  value: string | boolean
  options: string[]
  multiline: boolean
  readOnly: boolean
  maxLength?: number
}

function typeOf(f: PDFField): FieldType | null {
  if (f instanceof PDFTextField) return 'text'
  if (f instanceof PDFCheckBox) return 'checkbox'
  if (f instanceof PDFRadioGroup) return 'radio'
  if (f instanceof PDFDropdown) return 'dropdown'
  if (f instanceof PDFOptionList) return 'list'
  return null // buttons and signature fields are left to the viewer
}

export async function listFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const pages = doc.getPages()
  const out: FormField[] = []
  for (const field of doc.getForm().getFields()) {
    const type = typeOf(field)
    if (!type) continue
    const widgets = field.acroField.getWidgets().map((w) => {
      const r = w.getRectangle()
      const pageRef = w.P()
      let page = pageRef ? pages.findIndex((p) => p.ref === pageRef) : -1
      if (page < 0) page = pages.findIndex((p) => p.node.Annots()?.asArray().includes(w.dict as never))
      let option: string | undefined
      if (type === 'radio') {
        const on = w.getOnValue()
        option = on ? on.decodeText() : undefined
      }
      return { page, rect: [r.x, r.y, r.x + r.width, r.y + r.height] as [number, number, number, number], option }
    })
    if (widgets.every((w) => w.page < 0)) continue
    let value: string | boolean = ''
    let options: string[] = []
    let multiline = false
    let maxLength: number | undefined
    if (field instanceof PDFTextField) {
      value = field.getText() ?? ''
      multiline = field.isMultiline()
      maxLength = field.getMaxLength()
    } else if (field instanceof PDFCheckBox) value = field.isChecked()
    else if (field instanceof PDFRadioGroup) {
      value = field.getSelected() ?? ''
      options = field.getOptions()
    } else if (field instanceof PDFDropdown) {
      value = field.getSelected()[0] ?? ''
      options = field.getOptions()
    } else if (field instanceof PDFOptionList) {
      value = field.getSelected()[0] ?? ''
      options = field.getOptions()
    }
    out.push({ name: field.getName(), type, widgets: widgets.filter((w) => w.page >= 0), value, options, multiline, readOnly: field.isReadOnly(), maxLength })
  }
  return out
}

/** Writes the given values into the form and returns the updated PDF bytes. */
export async function fillFields(bytes: Uint8Array, values: Record<string, string | boolean>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const form = doc.getForm()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name)
    if (!field) throw new Error(`Form field "${name}" no longer exists`)
    try {
      if (field instanceof PDFTextField) field.setText(String(value) || undefined)
      else if (field instanceof PDFCheckBox) {
        if (value) field.check()
        else field.uncheck()
      }
      else if (field instanceof PDFRadioGroup) {
        if (value) field.select(String(value))
        else field.clear()
      }
      else if (field instanceof PDFDropdown) {
        if (value) field.select(String(value))
        else field.clear()
      }
      else if (field instanceof PDFOptionList) {
        if (value) field.select(String(value))
        else field.clear()
      }
    } catch (e) {
      throw new Error(`Cannot set "${name}": ${(e as Error).message}`)
    }
  }
  form.updateFieldAppearances(font)
  return doc.save({ updateFieldAppearances: false })
}

export interface NewField {
  type: FieldType
  name: string
  page: number
  /** PDF user space [left, bottom, right, top]. */
  rect: [number, number, number, number]
  options?: string[]
  multiline?: boolean
}

/** Adds an empty form field to the page. */
export async function addField(bytes: Uint8Array, f: NewField): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const form = doc.getForm()
  if (!f.name.trim()) throw new Error('Give the field a name')
  if (form.getFieldMaybe(f.name)) throw new Error(`A field named "${f.name}" already exists`)
  const page = doc.getPage(f.page)
  const [l, b, r, t] = f.rect
  const box = { x: l, y: b, width: r - l, height: t - b }
  const font = await doc.embedFont(StandardFonts.Helvetica)
  switch (f.type) {
    case 'text': {
      const tf = form.createTextField(f.name)
      if (f.multiline) tf.enableMultiline()
      tf.addToPage(page, { ...box, font })
      break
    }
    case 'checkbox':
      form.createCheckBox(f.name).addToPage(page, box)
      break
    case 'radio': {
      const rg = form.createRadioGroup(f.name)
      for (const [i, o] of (f.options?.length ? f.options : ['Option 1']).entries()) rg.addOptionToPage(o, page, { ...box, y: box.y - i * (box.height + 6) })
      break
    }
    default: {
      const dd = f.type === 'list' ? form.createOptionList(f.name) : form.createDropdown(f.name)
      dd.addOptions(f.options?.length ? f.options : ['Option 1', 'Option 2'])
      dd.addToPage(page, { ...box, font })
    }
  }
  form.updateFieldAppearances(font)
  return doc.save({ updateFieldAppearances: false })
}
