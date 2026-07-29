/**
 * Guard de los endpoints que se autentican con un secreto de entorno: los cuatro
 * crons (`CRON_SECRET`) y `/api/metrics` (`METRICS_SECRET`).
 *
 * **Falla cerrado a propósito**: si el secreto no está configurado —variable nueva,
 * typo, preview deploy sin el env— nadie puede autenticarse. Este chequeo estaba
 * copiado verbatim en cinco archivos y una de las copias se había desincronizado:
 * `/api/metrics` fallaba ABIERTO cuando `METRICS_SECRET` no estaba seteado y
 * publicaba las métricas por negocio a cualquiera. Con una sola implementación esa
 * deriva no se puede volver a dar.
 *
 * Devuelve un booleano y no una respuesta porque los callers no comparten el cuerpo
 * del 401: los crons responden JSON y metrics texto plano (lo scrapea Prometheus).
 * Lo que sí comparten es el código —401 y no 500— para no filtrarle a un caller
 * anónimo si el secreto está configurado o no.
 *
 * Toma `Request` y no `NextRequest` a propósito: `NextRequest` lo extiende, así que
 * entran los dos y el helper no arrastra `next/server`.
 */
export function hasValidBearerSecret(
  request: Request,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false
  return request.headers.get('authorization') === `Bearer ${expectedSecret}`
}
