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
  /** Para adelantar el "expiró" al hold vencido que el cron todavía no barrió.
   *  Requerido a propósito: el caller que no lo pase estaría mostrando
   *  "completá el pago" sobre un horario que ya se libera. `null` = sin hold. */
  holdExpiresAt: Date | null
  /** Ventana del negocio para responder una solicitud. Separada del hold de
   * pago para que cada status lea exclusivamente el reloj que le pertenece. */
  approvalExpiresAt: Date | null
  payments: { status: string; provider: string; providerPaymentId?: string | null }[]
}

/** Espejo exacto del sweep de `pending_payment`: sólo un hold vencido y todavía
 * `unpaid` está condenado. La plata parcial gana porque el cron tampoco la barre. */
export function isExpiredPaymentHold(
  input: Pick<DeriveInput, 'status' | 'paymentStatus' | 'holdExpiresAt'>,
  now: Date,
): boolean {
  return (
    input.status === 'pending_payment' &&
    input.paymentStatus === 'unpaid' &&
    input.holdExpiresAt != null &&
    input.holdExpiresAt < now
  )
}

/**
 * El plazo que corresponde al status venció y alguno de los dos sweeps del cron
 * va a expirar esta reserva. Conserva una sola autoridad para la decisión
 * combinada, pero cada rama lee su propia columna y espeja sólo su sweep:
 *
 * - `pending_payment` + `unpaid` + `holdExpiresAt` vencido.
 * - `pending_confirmation` + `approvalExpiresAt` vencido, sin filtro de pago.
 *
 * OJO: las etiquetas que lo usen respetan el mismo orden que
 * `deriveConfirmationState`: una transferencia declarada o un pago en vuelo
 * ganan visualmente sobre el plazo vencido aunque el cron aún pueda barrerlos.
 */
export function isDoomedBooking(
  input: Pick<DeriveInput, 'status' | 'paymentStatus' | 'holdExpiresAt' | 'approvalExpiresAt'>,
  now: Date,
): boolean {
  if (input.status === 'pending_payment') return isExpiredPaymentHold(input, now)
  return (
    input.status === 'pending_confirmation' &&
    input.approvalExpiresAt != null &&
    input.approvalExpiresAt < now
  )
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

export function deriveConfirmationState(input: DeriveInput, now = new Date()): ConfirmationState {
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

  const hasPending = mpPayments.some(
    p => p.status === 'pending' || p.status === 'in_process',
  )
  if (hasPending) {
    return 'verifying'
  }

  // De acá para abajo el resultado sólo puede ser 'pending' o 'rejected' — los
  // dos que le piden a la clienta que pague. Con el hold ya vencido eso es
  // mandarla a pagar un horario que se está liberando: mejor adelantarle el
  // "expiró" que el cron va a asentar de todas formas. Va DESPUÉS de
  // 'verifying': un pago en vuelo puede aterrizar y confirmar aunque el hold
  // haya vencido (esa carrera la arbitra el guard de solape del webhook).
  if (isDoomedBooking(input, now)) {
    return 'expired'
  }

  const hasFailed = mpPayments.some(
    p => p.status === 'rejected' || p.status === 'cancelled' || p.status === 'failed',
  )
  if (hasFailed) {
    return 'rejected'
  }

  return 'pending'
}
