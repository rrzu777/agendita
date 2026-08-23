import { ManualPaymentDialog } from './manual-payment-dialog'
import type { ManualPaymentBooking } from './manual-payment-utils'

export function PaymentForm({ bookings, now }: { bookings: ManualPaymentBooking[]; now: Date }) {
  return (
    <div data-tour-id="payments-register">
      <ManualPaymentDialog bookings={bookings} now={now} />
    </div>
  )
}
