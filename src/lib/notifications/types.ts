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
}

export interface LoyaltyRewardEmailData {
  businessName: string
  businessReplyToEmail?: string | null
  customerName: string
  customerEmail: string
  rewardLabel: string
  reason: 'birthday' | 'winback' | 'referral'
  loyaltyCardLink: string | null
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
