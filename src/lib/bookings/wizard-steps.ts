/**
 * Los pasos del funnel, que dejaron de ser una lista fija.
 *
 * Antes eran seis entradas numeradas y el wizard comparaba `currentStep === 4`. Con
 * un paso que aparece sólo en algunos negocios eso se rompe en silencio por dos
 * lados a la vez: la barra de progreso dice "paso 4 de 6" cuando son 7, y el restore
 * de sesión —que mapeaba a índices escritos a mano— devuelve a la clienta a un paso
 * que no es el que estaba.
 *
 * Por eso el estado del wizard es una CLAVE y no un número. Un índice deja de
 * significar lo mismo cuando la lista cambia de largo a mitad del recorrido, que es
 * justo lo que pasa acá: la lista se deriva del servicio elegido, así que crece
 * cuando la clienta elige uno con equipo.
 */
export type StepKey = 'service' | 'professional' | 'date' | 'time' | 'customer' | 'payment' | 'confirmation'

export interface WizardStep {
  key: StepKey
  label: string
}

/**
 * `professionalLabel` es el sustantivo de oficio del rubro ("Barbero",
 * "Manicurista"): viene del vocabulario y por eso entra como argumento en vez de
 * estar escrito acá. `null` = el paso no va, que es el caso de casi todos los
 * negocios.
 */
export function stepsFor(professionalLabel: string | null): WizardStep[] {
  return [
    { key: 'service', label: 'Servicio' },
    ...(professionalLabel ? [{ key: 'professional' as const, label: professionalLabel }] : []),
    { key: 'date', label: 'Fecha' },
    { key: 'time', label: 'Hora' },
    { key: 'customer', label: 'Tus datos' },
    { key: 'payment', label: 'Pago' },
    { key: 'confirmation', label: 'Confirmación' },
  ]
}

/** El siguiente/anterior de la lista, con los bordes pegados. */
export function stepAfter(steps: WizardStep[], current: StepKey): StepKey {
  const i = steps.findIndex((s) => s.key === current)
  return steps[Math.min(i + 1, steps.length - 1)]?.key ?? current
}

export function stepBefore(steps: WizardStep[], current: StepKey): StepKey {
  const i = steps.findIndex((s) => s.key === current)
  return steps[Math.max(i - 1, 0)]?.key ?? current
}

/**
 * A qué paso vuelve la clienta que se fue a crear su cuenta y volvió.
 *
 * Se avanza al más lejano que el estado restaurado sostiene, no al que estaba: el
 * viaje a `/ingresar` no tiene por qué costarle re-elegir lo que ya eligió. Lo que
 * el restore ya descartó (un servicio dado de baja, una persona que ya no atiende)
 * no llega hasta acá — `restoreWizardState` lo limpia antes, y limpiar de a partes
 * es lo que dejaría a alguien parado en "Hora" sin fecha.
 */
export function entryStepAfterRestore(
  restored: { date: Date | null; timeSlot: unknown; professionalId: string | null },
  askProfessional: boolean,
): StepKey {
  // El paso pendiente manda sobre lo que venga después: sin persona elegida, la
  // fecha y la hora que se restauraron se calcularon para el horario equivocado.
  if (askProfessional && !restored.professionalId) return 'professional'
  if (restored.timeSlot) return 'customer'
  if (restored.date) return 'time'
  return 'date'
}
