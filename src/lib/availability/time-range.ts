/** Convierte "HH:MM" a minutos desde medianoche. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** Un rango horario es válido solo si el inicio es estrictamente anterior al fin. */
export function isValidTimeRange(startTime: string, endTime: string): boolean {
  return timeToMinutes(startTime) < timeToMinutes(endTime)
}
