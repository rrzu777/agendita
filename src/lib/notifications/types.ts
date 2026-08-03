import type { BusinessCategory, ServiceModality } from '@prisma/client'
import type { BookingCalendarInvite } from '@/lib/calendar/booking-invite'

export interface EmailResult {
  success: boolean
  skipped?: string
  messageId?: string
  error?: string
}

export interface BookingEmailData {
  businessName: string
  bookingNumber?: number | null
  businessReplyToEmail?: string | null
  businessWhatsapp?: string | null
  businessAddress?: string | null
  businessTimezone: string
  businessCurrency: string
  businessCancellationPolicy?: string | null
  customerName: string
  customerEmail?: string | null
  customerPhone: string
  serviceName: string
  /** Quién atiende la cita. Ausente/null = reserva sin persona asignada
   *  (negocio sin equipo, o anterior al track 5): la fila no se muestra. */
  professionalName?: string | null
  startDateTime: Date
  totalPrice: number
  discountAmount?: number
  finalAmount?: number
  depositRequired: number
  depositPaid: number
  remainingBalance: number
  /** Dónde se atiende esta cita. Ausente = en el local (reservas anteriores al
   *  Track 3). Decide qué dirección/link muestra el email: la del negocio, la de
   *  la clienta o el link de la videollamada. */
  modality?: ServiceModality | null
  /** Dirección de la clienta; sólo en a domicilio. */
  serviceAddress?: string | null
  /** Link de videollamada; sólo online. */
  meetingUrl?: string | null
  reviewLink?: string
  loyaltyCardLink?: string
  /** La reserva quedó esperando que el negocio la acepte (confirmación manual).
   *  Cambia el copy: sin esto el email decía "está pendiente de pago" sobre una
   *  reserva que no tiene nada que pagar. */
  awaitingApproval?: boolean
  /** La reserva ya está confirmada. Mismo problema que `awaitingApproval` y por
   *  el otro lado: el mail de "reserva recibida" decía "está pendiente de pago"
   *  sobre una reserva sin abono, que nace confirmada y ya está en la agenda.
   *
   *  Sale del status de la reserva, NUNCA de si se pudo armar el `calendar`: el
   *  evento es opcional y podría faltar por sus propios motivos, y el copy no
   *  puede quedar colgado de eso. */
  confirmed?: boolean
  /** El evento de calendario, ya armado por quien tenía la reserva a mano. El
   *  mail lo manda adjunto y ofrece el link en el cuerpo. Ausente = no hay nada
   *  que agendar (ver `deservesCalendarEvent`). */
  calendar?: BookingCalendarInvite | null
  /** Presente cuando la reserva eligió transferencia bancaria: el email de
   *  "reserva recibida" incluye los datos, el plazo y el link para declarar. */
  bankTransfer?: {
    accountHolder: string
    rut: string
    bankName: string
    accountType: string
    accountNumber: string
    email?: string | null
    instructions?: string | null
    deadline: Date | null
    confirmationUrl: string
  }
}

/** Mapea cuenta bancaria + plazo + link al bloque `bankTransfer` de los emails.
 *  Única fuente del shape: lo comparten reviveBooking (reopen) y el cron de
 *  recordatorios — agregar un campo acá en vez de duplicar el literal. */
export function toBankTransferEmailInfo(
  acct: {
    accountHolder: string
    rut: string
    bankName: string
    accountType: string
    accountNumber: string
    email: string | null
    instructions: string | null
  },
  deadline: Date | null,
  confirmationUrl: string,
): NonNullable<BookingEmailData['bankTransfer']> {
  return {
    accountHolder: acct.accountHolder,
    rut: acct.rut,
    bankName: acct.bankName,
    accountType: acct.accountType,
    accountNumber: acct.accountNumber,
    email: acct.email,
    instructions: acct.instructions,
    deadline,
    confirmationUrl,
  }
}

export interface CancellationEmailData {
  businessName: string
  businessReplyToEmail?: string | null
  customerName: string
  customerEmail?: string | null
  serviceName: string
  startDateTime: Date
  businessTimezone: string
  /** Motivo visible para la clienta. Lo escribe el negocio al rechazar una
   *  solicitud o al cancelar; el sweep de solicitudes sin responder manda el
   *  suyo. Sin motivo el email queda igual que siempre. */
  reason?: string | null
}

export interface RescheduledEmailData {
  businessName: string
  /** Ver `BookingEmailData.calendar`: el `.ics` del nuevo horario viaja con el
   *  mismo UID que el anterior, así que en el calendario pisa al viejo en vez de
   *  dejar la cita duplicada en dos horarios. */
  calendar?: BookingCalendarInvite | null
  bookingNumber?: number | null
  businessReplyToEmail?: string | null
  businessWhatsapp?: string | null
  businessAddress?: string | null
  businessTimezone: string
  customerName: string
  customerEmail?: string | null
  customerPhone: string
  serviceName: string
  /** Quién atiende la cita (reprogramar la conserva). Ausente/null = sin
   *  persona asignada: la fila no se muestra. */
  professionalName?: string | null
  previousStartDateTime: Date
  newStartDateTime: Date
}

export interface ReviewRequestEmailData {
  businessName: string
  businessReplyToEmail?: string | null
  customerName: string
  customerEmail?: string | null
  serviceName: string
  reviewLink: string
  startDateTime: Date
  businessTimezone: string
  loyaltyCardLink?: string
}

export interface NewBookingBusinessEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessName: string
  bookingNumber?: number | null
  customerName: string
  customerPhone: string
  customerEmail?: string | null
  serviceName: string
  /** Quién la atiende: con equipo, es lo primero que la dueña necesita saber
   *  para repartir el día. Ausente/null = sin persona, la fila no se muestra. */
  professionalName?: string | null
  startDateTime: Date
  businessTimezone: string
  businessCurrency: string
  depositRequired: number
  remainingBalance: number
  dashboardLink: string
  /** Dónde se atiende esta cita. Ausente = en el local (reservas anteriores al
   *  Track 3). Decide qué dirección/link muestra el email: la del negocio, la de
   *  la clienta o el link de la videollamada. */
  modality?: ServiceModality | null
  /** Dirección de la clienta; sólo en a domicilio. */
  serviceAddress?: string | null
  /** Link de videollamada; sólo online. */
  meetingUrl?: string | null
  /** Es una solicitud que espera respuesta, no una reserva ya agendada: el
   *  negocio tiene que entrar a aceptarla o rechazarla. */
  awaitingApproval?: boolean
  /** Nota extra sobre el método de pago (p.ej. "eligió transferencia"). */
  paymentNote?: string
}

export interface BankTransferDeclaredEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  startDateTime: Date
  amount: number
  currency: string
  bookingNumber?: number | null
  /** La clienta adjuntó un comprobante al declarar: el email lo menciona para
   *  que la dueña sepa que hay un comprobante esperando en el dashboard. */
  hasProof?: boolean
}

export interface BankTransferVerifyCustomerEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  startDateTime: Date
  bookingNumber?: number | null
  customerEmail?: string
  businessReplyToEmail?: string | null
}

/** Verificado/rechazado del SALDO: el de abono no trae monto; el email del
 *  saldo lo necesita ("recibimos tu pago de $X"). */
export interface BalanceTransferCustomerEmailData extends BankTransferVerifyCustomerEmailData {
  amount: number
  currency: string
}

export interface TransferReminderCustomerEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  depositAmount: number                       // monto crudo; el template lo formatea (consistente con los otros emails)
  businessCurrency: string
  bankTransfer: NonNullable<BookingEmailData['bankTransfer']>
  bookingNumber?: number | null
  customerEmail?: string
  businessReplyToEmail?: string | null
}

export interface TransferReminderBusinessEmailData {
  businessName: string
  customerName: string
  serviceName: string
  dashboardUrl: string
  bookingNumber?: number | null
}

export interface LoyaltyRewardEmailData {
  businessName: string
  businessReplyToEmail?: string | null
  customerName: string
  customerEmail: string
  rewardLabel: string
  reason: 'birthday' | 'winback' | 'referral'
  loyaltyCardLink: string | null
  /** Token de baja: presente sólo para emails de marketing (birthday/winback). null = sin footer/headers de baja. */
  unsubscribeToken?: string | null
}

export interface OwnerBookingChangedData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessId: string
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  /** Quién atendía la cita: dice a quién se le libera (o se le mueve) la hora.
   *  Ausente/null = sin persona asignada, la fila no se muestra. */
  professionalName?: string | null
  bookingNumber: number | null
  change:
    | { kind: 'cancelled' }
    | { kind: 'rescheduled'; previousStartDateTime: Date; newStartDateTime: Date }
  startDateTime: Date // horario (previo) de la reserva
}

export interface PackagePurchasedEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessName: string
  customerName: string
  productName: string
  totalSessions: number
  pricePaid: number
  businessCurrency: string
  cardLink?: string
  businessReplyToEmail?: string | null
}

export interface PackageDisputedEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessName: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
}

/** Aviso a la dueña de que entró un pago sobre un paquete que no lo esperaba. */
export interface PackageUnexpectedPaymentEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessName: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
  /** Por qué el pago no activó nada, en castellano llano ("el paquete ya estaba
   *  pagado y activo"). Lo arma `describeUnexpectedPackagePayment` para que el mail
   *  y el asiento de ledger cuenten exactamente lo mismo. */
  situation: string
}

export interface BookingDisputedEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessName: string
  customerName: string
  serviceName: string
  /** formatBookingNumber(bookingNumber, id) — p.ej. "#4738". */
  bookingLabel: string
  startDateTime: Date
  businessTimezone: string
  amount: number
  businessCurrency: string
}

/** Aviso a la dueña de que entró un pago sobre una reserva que ya estaba saldada. */
export interface BookingUnexpectedPaymentEmailData {
  businessName: string
  customerName: string
  serviceName: string
  /** formatBookingNumber(bookingNumber, id) — p.ej. "#4738". */
  bookingLabel: string
  amount: number
  businessCurrency: string
}

/**
 * Aviso a la dueña: entró el pago pero la reserva quedó SIN confirmar — el horario
 * ya no estaba libre, o la reserva ya no estaba vigente (vencida, cancelada). Es el
 * único canal por el que se entera: pasa en un webhook, sin nadie mirando la
 * pantalla.
 */
export interface BookingPaymentNotConfirmedEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso. */
  businessCategory: BusinessCategory
  businessName: string
  customerName: string
  serviceName: string
  /** formatBookingNumber(bookingNumber, id) — p.ej. "#4738". */
  bookingLabel: string
  startDateTime: Date
  businessTimezone: string
  amount: number
  businessCurrency: string
  /** Por qué no se confirmó, en castellano llano. Lo arma `describeUnconfirmedPayment`. */
  situation: string
}

export interface PackageTransferDeclaredEmailData {
  /** Rubro del negocio: decide cómo se nombra a la clientela en el aviso.
   *  Va acá, junto a businessName/businessTimezone, y no como parámetro suelto:
   *  el caller siempre tiene la fila del negocio a mano, así que no hace falta
   *  una query extra ni un string posicional sin nombre. */
  businessCategory: BusinessCategory
  businessName: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
}

export interface NotificationResult {
  customerEmail?: EmailResult
  businessEmails: EmailResult[]
}

export interface ReminderEmailData {
  businessName: string
  bookingNumber?: number | null
  businessReplyToEmail?: string | null
  customerName: string
  customerEmail: string
  serviceName: string
  /** Quién atiende la cita. Ausente/null = sin persona asignada: la línea no
   *  se muestra. */
  professionalName?: string | null
  startDateTime: Date
  businessTimezone: string
  businessWhatsapp?: string | null
  businessAddress?: string | null
  /** Dónde se atiende esta cita. Ausente = en el local (reservas anteriores al
   *  Track 3). Decide qué dirección/link muestra el email: la del negocio, la de
   *  la clienta o el link de la videollamada. */
  modality?: ServiceModality | null
  /** Dirección de la clienta; sólo en a domicilio. */
  serviceAddress?: string | null
  /** Link de videollamada; sólo online. */
  meetingUrl?: string | null
  businessCurrency: string
  totalPrice: number
  remainingBalance: number
  depositPaid: number
}

export interface PackageTransferReminderCustomerEmailData {
  businessName: string
  businessTimezone: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
  bankTransfer: NonNullable<BookingEmailData['bankTransfer']>
  customerEmail?: string
  businessReplyToEmail?: string | null
}

export interface PackageTransferUnverifiedBusinessEmailData {
  businessName: string
  customerName: string
  productName: string
  dashboardUrl: string
}
