/**
 * Decide cómo aplicar un cambio de horario "a toda la serie".
 *
 * Editar toda la serie parte la serie en dos SOLO cuando conviene preservar el
 * historial: la vieja termina ayer y una nueva arranca hoy con el horario nuevo.
 * Pero partir siempre es frágil: si la serie no tiene ocurrencias futuras (ya
 * terminó, o su `until` quedó en el pasado), el split crearía una serie nueva
 * con `anchor = hoy` y `until = ayer` — `anchor > until` — que NO se renderiza
 * jamás. El server dice "guardado" y la UI no cambia (bug real observado en
 * prod: una serie fantasma con until anterior al anchor).
 *
 * Regla: partir solo cuando la serie tiene ocurrencias pasadas Y futuras
 * respecto de hoy. En cualquier otro caso, actualizar el registro en el lugar
 * (sin split, sin fantasma, sin proliferar filas).
 *
 * Todas las fechas son cadenas locales `yyyy-MM-dd` en la zona del negocio para
 * que la comparación sea puramente de días de calendario.
 */
export type SeriesUpdateMode = 'split' | 'in-place'

export interface SeriesUpdatePlan {
  mode: SeriesUpdateMode
  /** La serie tiene ocurrencias de hoy en adelante (las que toman el horario nuevo). */
  hasFuture: boolean
}

export function planSeriesUpdate(
  anchorStr: string,
  untilStr: string | null,
  todayStr: string,
  yesterdayStr: string,
): SeriesUpdatePlan {
  // Tiene ocurrencias antes de hoy que conviene conservar con el horario viejo.
  const hasPast = anchorStr <= yesterdayStr
  // Tiene ocurrencias de hoy en adelante que deben tomar el horario nuevo.
  const hasFuture = untilStr === null || untilStr >= todayStr
  return { mode: hasPast && hasFuture ? 'split' : 'in-place', hasFuture }
}
