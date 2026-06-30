import { ManualPaymentDialog } from './manual-payment-dialog'
import type { ManualPaymentBooking } from './manual-payment-utils'

export function PaymentForm({ bookings }: { bookings: ManualPaymentBooking[] }) {
  return <ManualPaymentDialog bookings={bookings} />
}
