export interface EmailResult {
  success: boolean
  skipped?: string
  messageId?: string
  error?: string
}

export interface BookingEmailData {
  businessName: string
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
  depositRequired: number
  depositPaid: number
  remainingBalance: number
  reviewLink?: string
}

export interface CancellationEmailData {
  businessName: string
  customerName: string
  customerEmail?: string | null
  serviceName: string
  startDateTime: Date
  businessTimezone: string
}

export interface ReviewRequestEmailData {
  businessName: string
  customerName: string
  customerEmail?: string | null
  serviceName: string
  reviewLink: string
  startDateTime: Date
  businessTimezone: string
}

export interface NewBookingBusinessEmailData {
  businessName: string
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

export interface NotificationResult {
  customerEmail?: EmailResult
  businessEmails: EmailResult[]
}
