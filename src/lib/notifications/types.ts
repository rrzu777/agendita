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
  startDateTime: Date
  totalPrice: number
  discountAmount?: number
  finalAmount?: number
  depositRequired: number
  depositPaid: number
  remainingBalance: number
  reviewLink?: string
  loyaltyCardLink?: string
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
}

export interface RescheduledEmailData {
  businessName: string
  bookingNumber?: number | null
  businessReplyToEmail?: string | null
  businessWhatsapp?: string | null
  businessAddress?: string | null
  businessTimezone: string
  customerName: string
  customerEmail?: string | null
  customerPhone: string
  serviceName: string
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
  businessName: string
  bookingNumber?: number | null
  customerName: string
  customerPhone: string
  customerEmail?: string | null
  serviceName: string
  startDateTime: Date
  businessTimezone: string
  businessCurrency: string
  depositRequired: number
  remainingBalance: number
  dashboardLink: string
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
  businessId: string
  businessName: string
  businessTimezone: string
  customerName: string
  serviceName: string
  bookingNumber: number | null
  change:
    | { kind: 'cancelled' }
    | { kind: 'rescheduled'; previousStartDateTime: Date; newStartDateTime: Date }
  startDateTime: Date // horario (previo) de la reserva
}

export interface PackagePurchasedEmailData {
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
  businessName: string
  customerName: string
  productName: string
  amount: number
  businessCurrency: string
}

export interface BookingDisputedEmailData {
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

export interface PackageTransferDeclaredEmailData {
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
  startDateTime: Date
  businessTimezone: string
  businessWhatsapp?: string | null
  businessAddress?: string | null
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
