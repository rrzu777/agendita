import { formatInTimeZone } from 'date-fns-tz'

export function groupBookingsByDay<T extends { startDateTime: Date }>(
  items: T[],
  timeZone: string
): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) {
    const dayKey = formatInTimeZone(item.startDateTime, timeZone, 'yyyy-MM-dd')
    if (!result[dayKey]) result[dayKey] = []
    result[dayKey].push(item)
  }
  return result
}
