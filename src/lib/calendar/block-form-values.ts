import { formatInTimeZone } from 'date-fns-tz'
import { localDateTimeToUtc } from '@/lib/availability/timezone'

export interface BlockFormValues {
  date: string
  endDate: string
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
    endDate: formatInTimeZone(new Date(block.endDateTime), timezone, 'yyyy-MM-dd'),
    startTime: formatInTimeZone(new Date(block.startDateTime), timezone, 'HH:mm'),
    endTime: formatInTimeZone(new Date(block.endDateTime), timezone, 'HH:mm'),
    reason: block.reason || '',
    overlapTolerance: String(block.overlapToleranceMinutes ?? 0),
  }
}

/** Conserva el instante UTC original de cada extremo si la dueña no editó su
 * fecha/hora. Esto es esencial en una hora local repetida, donde recomponer el
 * mismo HH:mm podría elegir la otra ocurrencia. */
export function resolveBlockFormInterval(
  block: { startDateTime: string; endDateTime: string },
  values: Pick<BlockFormValues, 'date' | 'endDate' | 'startTime' | 'endTime'>,
  timezone: string,
): { start: Date; end: Date } {
  const initial = deriveBlockFormValues(block, timezone)
  const start = values.date === initial.date && values.startTime === initial.startTime
    ? new Date(block.startDateTime)
    : localDateTimeToUtc(values.date, values.startTime, timezone)
  const end = values.endDate === initial.endDate && values.endTime === initial.endTime
    ? new Date(block.endDateTime)
    : localDateTimeToUtc(values.endDate, values.endTime, timezone)
  return { start, end }
}
