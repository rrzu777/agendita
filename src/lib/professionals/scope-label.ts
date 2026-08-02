/**
 * Cómo se llama en pantalla el alcance "sin persona": el horario o el bloqueo que
 * vale para todo el mundo.
 *
 * Vive suelto y no como literal en cada pantalla porque hoy lo dicen TRES lugares —el
 * selector de horario, el selector de dueño del bloqueo y la etiqueta de cada bloqueo
 * listado— y los tres se leen juntos, en la misma pantalla y a centímetros de
 * distancia. Dos redacciones distintas ahí adentro se leen como dos alcances
 * distintos.
 *
 * Dice "negocio" y no "salón": el mismo texto lo lee una barbería, una masajista y un
 * taller de constelaciones. Es la palabra que el resto del panel ya usa para hablarle
 * a la dueña de lo suyo.
 */
export const WHOLE_BUSINESS_LABEL = 'Todo el negocio'

/**
 * Qué etiqueta lleva un bloqueo ya guardado en la lista, o `null` para no dibujar
 * ninguna. `scopeId` es de quién es el horario que se está mirando y `ownerName` de
 * quién es el bloqueo.
 *
 * La regla es "etiquetar sólo cuando aclara algo", y las dos mitades importan:
 *
 * - mirando el negocio la lista trae únicamente los suyos, así que una etiqueta
 *   idéntica en cada fila no dice nada — y ése es también el caso de un negocio sin
 *   equipo, donde la pantalla tiene que quedar igual que siempre;
 * - mirando a una persona la lista viene MEZCLADA, los suyos más los del negocio, que
 *   son justamente los dos que la dejan sin atender. Ahí cada fila necesita decir cuál
 *   es cuál: borrar lo que parece "su" almuerzo puede estar abriéndole el horario a
 *   todo el equipo.
 *
 * Vive acá y no en la página porque la respuesta se calcula igual para los bloqueos
 * sueltos y para las series, y porque equivocarla no rompe nada visible: dibuja una
 * etiqueta plausible sobre el bloqueo equivocado.
 */
export function blockOwnerLabel(scopeId: string | null, ownerName: string | null): string | null {
  if (scopeId === null) return null
  return ownerName ?? WHOLE_BUSINESS_LABEL
}
