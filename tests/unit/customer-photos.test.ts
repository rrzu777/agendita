import { describe, it, expect } from 'vitest'
import {
  attachCustomerPhotoSchema,
  customerPhotoKey,
  customerPhotoPrefix,
  customerPhotoUrl,
  isAllowedPhotoType,
  isOwnCustomerPhotoKey,
  photoCaptionSchema,
  PHOTO_CAPTION_MAX,
} from '@/lib/storage/photos'

const BIZ = 'biz-1'
const CUS = 'cus-1'
const TOKEN = '0f2a1b3c-4d5e-6f70-8192-a3b4c5d6e7f8'

describe('isAllowedPhotoType', () => {
  it('acepta los tres formatos de imagen', () => {
    expect(isAllowedPhotoType('image/jpeg')).toBe(true)
    expect(isAllowedPhotoType('image/png')).toBe(true)
    expect(isAllowedPhotoType('image/webp')).toBe(true)
  })

  it('rechaza PDF: un comprobante puede serlo, una foto del trabajo no', () => {
    expect(isAllowedPhotoType('application/pdf')).toBe(false)
  })

  it('rechaza cualquier otro tipo', () => {
    expect(isAllowedPhotoType('image/gif')).toBe(false)
    expect(isAllowedPhotoType('text/html')).toBe(false)
    expect(isAllowedPhotoType('')).toBe(false)
  })
})

describe('customerPhotoKey', () => {
  it('cuelga la foto del prefijo de la ficha', () => {
    expect(customerPhotoPrefix(BIZ, CUS)).toBe(`photos/${BIZ}/${CUS}/`)
    expect(customerPhotoKey(BIZ, CUS, TOKEN)).toBe(`photos/${BIZ}/${CUS}/${TOKEN}`)
  })

  it('un UUID real de crypto.randomUUID() pasa la validación', () => {
    const key = customerPhotoKey(BIZ, CUS, crypto.randomUUID())
    expect(isOwnCustomerPhotoKey(key, BIZ, CUS)).toBe(true)
  })
})

describe('isOwnCustomerPhotoKey', () => {
  it('acepta una key propia', () => {
    expect(isOwnCustomerPhotoKey(customerPhotoKey(BIZ, CUS, TOKEN), BIZ, CUS)).toBe(true)
  })

  it('rechaza la key de OTRO negocio', () => {
    expect(isOwnCustomerPhotoKey(customerPhotoKey('biz-2', CUS, TOKEN), BIZ, CUS)).toBe(false)
  })

  it('rechaza la key de otra ficha del mismo negocio', () => {
    expect(isOwnCustomerPhotoKey(customerPhotoKey(BIZ, 'cus-2', TOKEN), BIZ, CUS)).toBe(false)
  })

  it('rechaza path traversal', () => {
    expect(isOwnCustomerPhotoKey(`photos/${BIZ}/${CUS}/../../otro/x`, BIZ, CUS)).toBe(false)
  })

  it('rechaza subcarpetas colgadas del token', () => {
    expect(isOwnCustomerPhotoKey(`photos/${BIZ}/${CUS}/${TOKEN}/evil`, BIZ, CUS)).toBe(false)
  })

  it('rechaza un token que no es UUID', () => {
    expect(isOwnCustomerPhotoKey(`photos/${BIZ}/${CUS}/mi-foto.jpg`, BIZ, CUS)).toBe(false)
    expect(isOwnCustomerPhotoKey(`photos/${BIZ}/${CUS}/`, BIZ, CUS)).toBe(false)
  })

  it('rechaza la key de un comprobante', () => {
    expect(isOwnCustomerPhotoKey(`proofs/${BIZ}/book-1/deposit`, BIZ, CUS)).toBe(false)
  })
})

describe('attachCustomerPhotoSchema', () => {
  const base = { customerId: CUS, key: customerPhotoKey(BIZ, CUS, TOKEN) }

  it('acepta lo mínimo: ficha + key + tipo', () => {
    const parsed = attachCustomerPhotoSchema.safeParse({ ...base, contentType: 'image/jpeg' })
    expect(parsed.success).toBe(true)
  })

  it('acepta colgarse solo de una reserva', () => {
    const parsed = attachCustomerPhotoSchema.safeParse({
      bookingId: 'book-1',
      key: base.key,
      contentType: 'image/png',
    })
    expect(parsed.success).toBe(true)
  })

  it('rechaza un tipo que no sea imagen', () => {
    const parsed = attachCustomerPhotoSchema.safeParse({ ...base, contentType: 'application/pdf' })
    expect(parsed.success).toBe(false)
  })

  it('recorta la nota', () => {
    const parsed = attachCustomerPhotoSchema.parse({
      ...base,
      contentType: 'image/jpeg',
      caption: '  color 7.3  ',
    })
    expect(parsed.caption).toBe('color 7.3')
  })

  it('rechaza una nota más larga que el tope', () => {
    const parsed = attachCustomerPhotoSchema.safeParse({
      ...base,
      contentType: 'image/jpeg',
      caption: 'x'.repeat(PHOTO_CAPTION_MAX + 1),
    })
    expect(parsed.success).toBe(false)
  })
})

describe('photoCaptionSchema', () => {
  it('recorta y acepta vacío (borrar la nota)', () => {
    expect(photoCaptionSchema.parse('   ')).toBe('')
    expect(photoCaptionSchema.parse('  antes ')).toBe('antes')
  })
})

describe('customerPhotoUrl', () => {
  it('apunta a la ruta del panel, nunca al bucket', () => {
    expect(customerPhotoUrl('photo-1')).toBe('/dashboard/photos/photo-1')
  })
})
