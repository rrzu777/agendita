import { describe, expect, it } from 'vitest'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'

const req = (authorization?: string) =>
  new Request('http://localhost:3000/api/cron/whatever', {
    headers: authorization ? { authorization } : {},
  })

describe('hasValidBearerSecret', () => {
  it('acepta el Bearer que coincide con el secreto', () => {
    expect(hasValidBearerSecret(req('Bearer s3cr3t'), 's3cr3t')).toBe(true)
  })

  it('rechaza un secreto distinto', () => {
    expect(hasValidBearerSecret(req('Bearer otro'), 's3cr3t')).toBe(false)
  })

  it('rechaza si no viene el header', () => {
    expect(hasValidBearerSecret(req(), 's3cr3t')).toBe(false)
  })

  it('rechaza el secreto crudo sin el prefijo Bearer', () => {
    expect(hasValidBearerSecret(req('s3cr3t'), 's3cr3t')).toBe(false)
  })

  it('es sensible a mayúsculas en el esquema (no acepta "bearer")', () => {
    expect(hasValidBearerSecret(req('bearer s3cr3t'), 's3cr3t')).toBe(false)
  })

  // El punto entero del helper: la copia de /api/metrics fallaba ABIERTO acá.
  it('falla CERRADO cuando el secreto no está configurado', () => {
    expect(hasValidBearerSecret(req('Bearer s3cr3t'), undefined)).toBe(false)
    expect(hasValidBearerSecret(req('Bearer '), '')).toBe(false)
    expect(hasValidBearerSecret(req(), undefined)).toBe(false)
  })
})
