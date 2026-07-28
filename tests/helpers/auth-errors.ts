import { UserError } from '@/lib/actions/result'

/**
 * Las clases de error de `@/lib/auth/server`, para los tests que mockean ese
 * módulo.
 *
 * POR QUÉ EXISTE: el mock tiene que respetar el contrato real — las dos
 * extienden `UserError`, y de eso depende que el wrapper `action()` las
 * reconozca (`instanceof UserError`) y devuelva su mensaje en
 * `{ ok: false, error }` en vez de reemplazarlo por el genérico. Mientras cada
 * archivo declaraba su propia `class extends Error {}`, el mock mentía: la
 * suite pasaba sólo porque ningún test miraba la diferencia, y el primero que
 * la mirara habría dado falso verde. Los mensajes por defecto también son los
 * de producción, así que un test que no pasa mensaje explícito assertea contra
 * el texto que la usuaria vería de verdad.
 *
 * USO — importarlo ANTES que cualquier import que arrastre al módulo mockeado
 * (en la práctica: justo después del import de vitest) y pasar las clases por
 * shorthand. El orden importa: la factory de `vi.mock` corre cuando se carga el
 * módulo mockeado, y para entonces este binding tiene que estar inicializado.
 *
 *   import { describe, it, expect, vi } from 'vitest'
 *   import { ForbiddenError } from '../helpers/auth-errors'
 *
 *   vi.mock('@/lib/auth/server', () => ({
 *     requireBusinessRole: mockRequireBusinessRole,
 *     ForbiddenError,
 *   }))
 */
export class AuthError extends UserError {
  constructor(message: string = 'No autorizado') {
    super(message)
    this.name = 'AuthError'
  }
}

export class ForbiddenError extends UserError {
  constructor(message: string = 'No tienes permisos para realizar esta acción') {
    super(message)
    this.name = 'ForbiddenError'
  }
}
