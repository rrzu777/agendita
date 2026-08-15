/** A booking number is an integer allocated by the current business. Accept a
 * user-friendly leading # but never coerce partial or unsafe values. */
export function parseBookingNumberSearch(value: string | undefined): number | null {
  const term = value?.trim()
  if (!term) return null
  const match = term.match(/^#?([1-9]\d*)$/)
  if (!match) return null
  const bookingNumber = Number(match[1])
  return Number.isSafeInteger(bookingNumber) ? bookingNumber : null
}

export function bookingSearchClearPath(transferCursor: string | undefined): string {
  if (!transferCursor) return '/dashboard/bookings'
  return `/dashboard/bookings?${new URLSearchParams({ transferCursor }).toString()}`
}
