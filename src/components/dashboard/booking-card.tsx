export type CalendarBooking = {
  id: string
  bookingNumber: number | null
  status: string
  startDateTime: string
  endDateTime: string
  service: { name: string } | null
  customer: { name: string; phone: string; email: string | null } | null
  totalPrice: number
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  paymentStatus: string
  customerNotes?: string | null
  internalNotes?: string | null
}
