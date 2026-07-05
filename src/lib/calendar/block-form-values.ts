import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export function parseTimeUTC(dateStr: string, timeStr: string, timezone: string): Date {
  return fromZonedTime(`${dateStr} ${timeStr}`, timezone)
}

export interface BlockFormValues {
  date: string
  startTime: string
  endTime: string
  reason: string
  /** Tolerancia de solape en minutos, como string para el input numérico. */
  overlapTolerance: string
}

export function deriveBlockFormValues(
  block: { startDateTime: string; endDateTime: string; reason?: string | null; overlapToleranceMinutes?: number },
  timezone: string,
): BlockFormValues {
  return {
    date: formatInTimeZone(new Date(block.startDateTime), timezone, 'yyyy-MM-dd'),
    startTime: formatInTimeZone(new Date(block.startDateTime), timezone, 'HH:mm'),
    endTime: formatInTimeZone(new Date(block.endDateTime), timezone, 'HH:mm'),
    reason: block.reason || '',
    overlapTolerance: String(block.overlapToleranceMinutes ?? 0),
  }
}
