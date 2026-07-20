import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import { formatMoney } from '@/lib/money'

export interface BookingWhatsappData {
  bookingNumber?: number | null
  customerName: string
  customerPhone: string
  serviceName: string
  startDateTime: Date
  businessTimezone: string
  businessCurrency: string
  totalPrice: number
  discountAmount?: number
  finalAmount?: number
  depositPaid: number
  remainingBalance: number
  businessAddress?: string | null
  loyaltyCardLink?: string
}

export interface ReviewRequestWhatsappData {
  customerName: string
  serviceName: string
  reviewLink: string
  loyaltyCardLink?: string
}

export interface BookingRescheduledWhatsappData {
  customerName: string
  serviceName: string
  previousStartDateTime: Date
  newStartDateTime: Date
  businessTimezone: string
  businessAddress?: string | null
}

function fmtDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "EEEE d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })
}

function fmtCurrency(amount: number, currency: string): string {
  return formatMoney(amount, currency || 'CLP')
}

function normalizePhone(phone: string): string {
  return phone.replace(/^\+/, '').replace(/\D/g, '')
}

export function buildWhatsappUrl(phone: string, message: string): string {
  const normalized = normalizePhone(phone)
  const encoded = encodeURIComponent(message)
  return `https://wa.me/${normalized}?text=${encoded}`
}

export function buildBookingConfirmationWhatsappMessage(data: BookingWhatsappData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const total = fmtCurrency(data.totalPrice, data.businessCurrency)
  const deposit = fmtCurrency(data.depositPaid || 0, data.businessCurrency)
  const remaining = fmtCurrency(data.remainingBalance, data.businessCurrency)

  const lines = [
    `¡Hola ${data.customerName}! 🎉`,
    `Tu reserva en Agendita fue creada exitosamente:`,
    ``,
    ...(data.bookingNumber != null ? [`🔖 Reserva #${data.bookingNumber}`] : []),
    `📋 Servicio: ${data.serviceName}`,
    `📅 Fecha y hora: ${dateStr}`,
  ]
  if (data.businessAddress) {
    lines.push(`📍 Dirección: ${data.businessAddress}`)
  }
  lines.push(
    ``,
    `💰 Precio total: ${total}`,
  )
  if ((data.discountAmount ?? 0) > 0) {
    lines.push(
      `🎟️ Descuento: −${fmtCurrency(data.discountAmount!, data.businessCurrency)}`,
      `💵 Total con descuento: ${fmtCurrency(data.finalAmount ?? (data.totalPrice - data.discountAmount!), data.businessCurrency)}`,
    )
  }
  lines.push(
    `✅ Abono: ${deposit}`,
    `💳 Saldo pendiente: ${remaining}`,
    ``,
    `¡Te esperamos!`,
  )

  let body = lines.join('\n')
  if (data.loyaltyCardLink) body += `\n\nTu tarjeta de puntos: ${data.loyaltyCardLink}`
  return body
}

export function buildReviewRequestWhatsappMessage(data: ReviewRequestWhatsappData): string {
  let body = [
    `¡Hola ${data.customerName}! 🌟`,
    ``,
    `Gracias por visitarnos. Nos encantaría saber cómo te fue con tu servicio de ${data.serviceName}.`,
    ``,
    `Dejanos tu reseña aquí:`,
    `${data.reviewLink}`,
    ``,
    `¡Gracias!`,
  ].join('\n')
  if (data.loyaltyCardLink) body += `\n\nTu tarjeta de puntos: ${data.loyaltyCardLink}`
  return body
}

export function buildWhatsappBookingSummaryText(data: BookingWhatsappData): string {
  const parts = [
    `Reserva creada para ${data.customerName}`,
    `Servicio: ${data.serviceName}`,
    `Fecha: ${fmtDate(data.startDateTime, data.businessTimezone)}`,
    `Total: ${fmtCurrency(data.totalPrice, data.businessCurrency)}`,
    `Teléfono: ${data.customerPhone}`,
  ]
  if (data.businessAddress) {
    parts.push(`Dirección: ${data.businessAddress}`)
  }
  return parts.join(' | ')
}

export function buildWhatsappReminderMessage(data: BookingWhatsappData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const total = fmtCurrency(data.totalPrice, data.businessCurrency)
  const deposit = fmtCurrency(data.depositPaid || 0, data.businessCurrency)
  const remaining = fmtCurrency(data.remainingBalance, data.businessCurrency)

  const lines = [
    `¡Hola ${data.customerName}!`,
    `Te recordamos tu reserva en Agendita:`,
    ``,
    ...(data.bookingNumber != null ? [`🔖 Reserva #${data.bookingNumber}`] : []),
    `📋 Servicio: ${data.serviceName}`,
    `📅 Fecha y hora: ${dateStr}`,
  ]
  if (data.businessAddress) {
    lines.push(`📍 Dirección: ${data.businessAddress}`)
  }
  lines.push(
    ``,
    `💰 Precio total: ${total}`,
    `✅ Abono: ${deposit}`,
  )
  if (data.remainingBalance > 0) {
    lines.push(`💳 Saldo pendiente: ${remaining}`)
  }
  lines.push(
    ``,
    `¡Te esperamos!`,
  )

  return lines.join('\n')
}

export function buildWhatsappReminderUrl(phone: string, data: BookingWhatsappData): string {
  const message = buildWhatsappReminderMessage(data)
  return buildWhatsappUrl(phone, message)
}

export function buildBookingRescheduledWhatsappMessage(data: BookingRescheduledWhatsappData): string {
  const previousDateStr = fmtDate(data.previousStartDateTime, data.businessTimezone)
  const newDateStr = fmtDate(data.newStartDateTime, data.businessTimezone)

  const lines = [
    `Hola ${data.customerName}, te avisamos que tu reserva fue reprogramada:`,
    ``,
    `Servicio: ${data.serviceName}`,
    `Horario anterior: ${previousDateStr}`,
    `Nuevo horario: ${newDateStr}`,
  ]
  if (data.businessAddress) lines.push(`Dirección: ${data.businessAddress}`)
  lines.push(``, `Si este nuevo horario no te acomoda, respondeme por aquí.`)

  return lines.join('\n')
}

export function buildBookingRescheduledWhatsappUrl(phone: string, data: BookingRescheduledWhatsappData): string {
  return buildWhatsappUrl(phone, buildBookingRescheduledWhatsappMessage(data))
}
