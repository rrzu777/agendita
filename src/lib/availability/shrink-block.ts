import { addMinutes } from 'date-fns'

export interface ShrinkableBlock {
  startDateTime: Date
  endDateTime: Date
  /** Minutos que una cita puede invadir por cada borde del bloqueo. */
  overlapToleranceMinutes?: number
}

/**
 * Bordes efectivos de un bloqueo para el cálculo de solape: la tolerancia
 * encoge el bloqueo por ambos lados. Devuelve null si el bloqueo queda sin
 * núcleo (tolerancia >= mitad de la duración): en ese caso no bloquea nada.
 * Única fuente de esta semántica — la consumen generateSlots y validation.
 */
export function shrinkBlock(block: ShrinkableBlock): { start: Date; end: Date } | null {
  const tolerance = block.overlapToleranceMinutes ?? 0
  if (tolerance <= 0) return { start: block.startDateTime, end: block.endDateTime }
  const start = addMinutes(block.startDateTime, tolerance)
  const end = addMinutes(block.endDateTime, -tolerance)
  if (end <= start) return null
  return { start, end }
}
