import type { ServiceModality } from '@prisma/client'

export type CalendarBooking = {
  id: string
  bookingNumber: number | null
  status: string
  startDateTime: string
  endDateTime: string
  service: { name: string } | null
  /** Quién atiende. Requerido a propósito (mismo criterio que los emails): si
   *  fuera opcional, una consulta que olvide la relación compila igual y la
   *  fila desaparece en silencio. `null` = sin persona asignada. */
  professional: { name: string } | null
  customer: { name: string; phone: string; email: string | null } | null
  totalPrice: number
  depositPaid: number
  depositRequired: number
  finalAmount: number
  remainingBalance: number
  paymentStatus: string
  /** Requerido por el mismo motivo que `professional`: el drawer decide con
   *  esto qué estado mostrar y si ofrece cobrar. `null` = sin hold. */
  holdExpiresAt: Date | null
  /** Sólo las transferencias declaradas sin verificar (el `where` lo pone
   *  `getBookingsByRange`). Vacío = no hay ninguna. Es lo que le da a
   *  `displayedBookingStatus` la precedencia sobre el plazo vencido. */
  payments: { providerPaymentId?: string | null }[]
  customerNotes?: string | null
  internalNotes?: string | null
  modality: ServiceModality
  serviceAddress?: string | null
  meetingUrl?: string | null
}
