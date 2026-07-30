import { isDeclaredTransferPayment } from '@/lib/bank-transfer/declared'

export type ConfirmationState =
  | 'confirmed'
  | 'verifying'
  | 'verifying_transfer'
  | 'rejected'
  | 'pending'
  | 'paid_unconfirmed'
  | 'expired'
  | 'cancelled'

interface DeriveInput {
  status: string
  /** Lo que hacía falta para confirmar y lo que entró de verdad (montos ya
   *  recalculados desde los pagos aprobados, ver `recalcBookingFromPayments`). */
  depositRequired: number
  depositPaid: number
  /** El marcador de la reserva, no el del pago: `refunded` sobrevive a la reversión. */
  paymentStatus: string
  payments: { status: string; provider: string; providerPaymentId?: string | null }[]
}

/**
 * Entró plata que alcanzaba para confirmar y la reserva sigue sin confirmar.
 *
 * Hoy lo produce un solo camino real: el pago llegó cuando el horario ya se lo
 * había llevado otra persona, así que `recalcBookingFromPayments` asienta el cobro
 * y NO confirma (ver su `slotConflict`). La plata está en el negocio y la dueña
 * decide reacomodar o reembolsar — a ella se le avisa por mail, y esta pantalla es
 * lo único que ve la clienta.
 *
 * Las cuatro condiciones, cada una por su motivo:
 * - `pending_payment`: es el único status del que `recalcBookingFromPayments` sale sin
 *   confirmar teniendo la plata. Mantenerlo pegado a su productor es lo que evita que
 *   esta pantalla le eche la culpa al horario en un caso que no es éste — hoy una
 *   solicitud por confirmar no es pagable, pero eso puede cambiar.
 * - `depositPaid > 0`: sin plata no hay "pagaste". Tapa además un caso viejo — una
 *   reserva con `depositRequired = 0` queda en `deposit_paid` sin haber pagado nada.
 * - `>= depositRequired`: si no alcanzaba, la reserva sigue debiendo y el estado
 *   correcto es `pending`, no éste.
 * - `paymentStatus !== 'refunded'`: una reversión (contracargo o reembolso) ya
 *   recalculó los montos, pero si quedó otro pago aprobado en pie el marcador es el
 *   que manda; "recibimos tu pago" no es lo que hay que decirle a quien lo recuperó.
 */
function isPaidButUnconfirmed(input: DeriveInput): boolean {
  return (
    input.status === 'pending_payment' &&
    input.depositPaid > 0 &&
    input.depositPaid >= input.depositRequired &&
    input.paymentStatus !== 'refunded'
  )
}

export function deriveConfirmationState(input: DeriveInput): ConfirmationState {
  if (input.status === 'confirmed' || input.status === 'completed') {
    return 'confirmed'
  }
  // Estados terminales primero: una reserva muerta nunca debe mostrar
  // "verificando" por un Payment pendiente huérfano.
  if (input.status === 'expired') return 'expired'
  if (input.status === 'cancelled') return 'cancelled'

  // Antes que cualquier lectura de los pagos: con la plata adentro, ni "verificando
  // tu transferencia" ni "completá el pago" son ciertos. La transferencia que la
  // dueña YA verificó sale de `isDeclaredTransferPayment` (exige `pending`), así que
  // sin este corte una reserva con transferencia verificada y horario perdido caía
  // en "pendiente de pago" y le pedía a la clienta que transfiriera de nuevo.
  if (isPaidButUnconfirmed(input)) return 'paid_unconfirmed'

  // Transferencia declarada por la clienta (discriminada por bt-declared:).
  if (input.payments.some(isDeclaredTransferPayment)) return 'verifying_transfer'

  // Acá abajo NO hay rama de `approved`, y es a propósito: un pago aprobado no
  // alcanza para decir "confirmada" —la autoridad es el status de la reserva, que ya
  // se leyó arriba—. Un aprobado que no llegó a cubrir el abono deja la reserva
  // debiendo, y eso cae solo en el `pending` del final.
  const mpPayments = input.payments.filter(p => p.provider === 'mercado_pago')

  if (mpPayments.length === 0) {
    return 'pending'
  }

  const hasPending = mpPayments.some(
    p => p.status === 'pending' || p.status === 'in_process',
  )
  if (hasPending) {
    return 'verifying'
  }

  const hasFailed = mpPayments.some(
    p => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'failed',
  )
  if (hasFailed) {
    return 'rejected'
  }

  return 'pending'
}
