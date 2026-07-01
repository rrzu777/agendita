import { formatInTimeZone } from 'date-fns-tz'

export interface BlockFormValues {
  date: string
  startTime: string
  endTime: string
  reason: string
}

export function deriveBlockFormValues(
  block: { startDateTime: string; endDateTime: string; reason?: string | null },
  timezone: string,
): BlockFormValues {
  return {
    date: formatInTimeZone(new Date(block.startDateTime), timezone, 'yyyy-MM-dd'),
    startTime: formatInTimeZone(new Date(block.startDateTime), timezone, 'HH:mm'),
    endTime: formatInTimeZone(new Date(block.endDateTime), timezone, 'HH:mm'),
    reason: block.reason || '',
  }
}
