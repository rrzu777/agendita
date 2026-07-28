import { describe, it, expect } from 'vitest'
import { UserError } from '@/lib/actions/result'
import * as helper from '../helpers/auth-errors'
import * as real from '@/lib/auth/server'

/**
 * Guardia del helper: `tests/helpers/auth-errors` es lo que ~35 archivos de test
 * meten en su `vi.mock('@/lib/auth/server')`. Si las clases de producción
 * cambian y el helper no, todos esos mocks vuelven a mentir en silencio. Esto
 * ancla las dos cosas de las que depende el resto de la suite: la cadena de
 * prototipos (que `action()` mira con `instanceof UserError`) y el mensaje por
 * defecto (que los tests assertean tal cual).
 */
describe('helper de errores de auth para los mocks', () => {
  const cases = [
    ['AuthError', helper.AuthError, real.AuthError],
    ['ForbiddenError', helper.ForbiddenError, real.ForbiddenError],
  ] as const

  it.each(cases)('%s copia el contrato de la clase real', (name, Fake, Real) => {
    expect(new Real() instanceof UserError).toBe(true)
    expect(new Fake() instanceof UserError).toBe(true)
    expect(new Fake().message).toBe(new Real().message)
    expect(new Fake().name).toBe(name)
    expect(new Fake().name).toBe(new Real().name)
    expect(new Fake('mensaje explícito').message).toBe('mensaje explícito')
  })
})
