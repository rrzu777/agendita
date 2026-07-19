// NOTA: este módulo NO es `server-only` a propósito. `UserError` es la clase
// base de los errores user-facing (AuthError/ForbiddenError la extienden en
// src/lib/auth/server.ts, importado como VALOR por código server + tests). Un
// `import 'server-only'` acá rompe por transitividad todo test que carga el
// auth real. Además no hay secretos aquí y `unstable_rethrow` es isomórfico, así
// que la barrera aportaba poco.
import { unstable_rethrow } from 'next/navigation'

/**
 * Resultado estructurado de una Server Action invocada desde el cliente.
 * En prod Next.js redacta el mensaje de un throw; devolver el error preserva
 * el texto que el usuario debe ver.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Marcador: "este mensaje SÍ se muestra al usuario". Cualquier otro Error se
 * considera interno y se reemplaza por un genérico (nunca se filtra al cliente).
 *
 * El mensaje se muestra VERBATIM al usuario final: nunca interpolar texto de
 * error interno (p. ej. `new UserError(\`DB: ${err.message}\`)`) — eso lo filtra.
 * No arrastra `cause` a propósito, para no colar un error de control-flow de
 * Next por la cadena de causas.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

const GENERIC_ERROR = 'Ocurrió un error inesperado. Intenta nuevamente.'

/**
 * Envuelve una Server Action de mutación. Único borde de seguridad:
 * - UserError            → { ok: false, error: <mensaje> }
 * - control-flow de Next → se re-lanza (redirect/notFound/dynamic)
 * - cualquier otro Error → se loguea y devuelve un mensaje genérico
 * - éxito                → { ok: true, data }
 */
export function action<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<ActionResult<T>> {
  return async (...args: A): Promise<ActionResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e) {
      unstable_rethrow(e) // re-lanza redirect/notFound/dynamic — NO son errores
      if (e instanceof UserError) return { ok: false, error: e.message }
      console.error(e)
      return { ok: false, error: GENERIC_ERROR }
    }
  }
}
