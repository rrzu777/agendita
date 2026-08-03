import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import { formatMoney } from '@/lib/money'
import { bookingWhere, isNotableModality, whereText, type BookingWhere } from '@/lib/services/modality'

export interface BookingWhatsappData extends BookingWhere {
  bookingNumber?: number | null
  customerName: string
  customerPhone: string
  serviceName: string
  /**
   * Requerido (no opcional) por el mismo motivo que en las interfaces de email:
   * opcional, el próximo caller lo olvida y la línea desaparece sin error de
   * compilación. `null` = reserva sin persona asignada.
   */
  professionalName: string | null
  startDateTime: Date
  businessTimezone: string
  businessCurrency: string
  totalPrice: number
  discountAmount?: number
  finalAmount?: number
  depositPaid: number
  remainingBalance: number
  loyaltyCardLink?: string
}

export interface ReviewRequestWhatsappData {
  customerName: string
  serviceName: string
  reviewLink: string
  loyaltyCardLink?: string
}

export interface BookingRescheduledWhatsappData extends BookingWhere {
  customerName: string
  serviceName: string
  /** Requerido como en `BookingWhatsappData`; reprogramar conserva la persona. */
  professionalName: string | null
  previousStartDateTime: Date
  newStartDateTime: Date
  businessTimezone: string
}

/** El "dónde" con el 📍 de estos mensajes; el texto es el compartido
 *  (`whereText`), para que el WhatsApp no cuente otra cosa que el mail. */
function whereLines(data: BookingWhere): string[] {
  return whereText(data).map((line) => `📍 ${line}`)
}

/** Sin nombre no hay línea — la regla de `attendsRowText` (templates.ts),
 *  reescrita acá porque aquel módulo es server-side y éste viaja al navegador.
 *  El prefijo trae el label: "Te atiende" a la clienta, "Atiende" al negocio. */
function attendsLine(name: string | null | undefined, prefix: string): string[] {
  return name ? [`${prefix}${name}`] : []
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

/**
 * El link que le damos a la clienta para escribirle al negocio por su reserva.
 *
 * Con el mensaje ya redactado: cuando alguien necesita mover o cancelar, lo
 * primero que el negocio pregunta es cuál reserva, y el número lo tenemos acá.
 */
export function buildBookingHelpWhatsappUrl(
  phone: string,
  data: { bookingRef: string; businessName: string },
): string {
  return buildWhatsappUrl(phone, `Hola, te escribo por mi reserva ${data.bookingRef} en ${data.businessName}.`)
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
    ...attendsLine(data.professionalName, '👤 Te atiende: '),
    `📅 Fecha y hora: ${dateStr}`,
    ...whereLines(data),
  ]
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
    // "Atiende" a secas: este resumen lo lee el negocio, no la clienta.
    ...attendsLine(data.professionalName, 'Atiende: '),
    `Fecha: ${fmtDate(data.startDateTime, data.businessTimezone)}`,
    `Total: ${fmtCurrency(data.totalPrice, data.businessCurrency)}`,
    `Teléfono: ${data.customerPhone}`,
  ]
  // El resumen es para la dueña, no para la clienta: en el local su propia
  // dirección es ruido, pero a domicilio el dato clave es A DÓNDE va (la
  // dirección de la clienta) y online, el link. Antes imprimía la dirección del
  // local en los tres casos.
  if (isNotableModality(data.modality)) {
    const where = bookingWhere(data)
    parts.push(where.detail ? `${where.label}: ${where.detail}` : where.label)
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
    ...attendsLine(data.professionalName, '👤 Te atiende: '),
    `📅 Fecha y hora: ${dateStr}`,
    ...whereLines(data),
  ]
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
    ...attendsLine(data.professionalName, 'Te atiende: '),
    `Horario anterior: ${previousDateStr}`,
    `Nuevo horario: ${newDateStr}`,
    // Este mensaje va sin emojis; las mismas filas que el resto, en plano.
    ...whereText(data),
  ]
  lines.push(``, `Si este nuevo horario no te acomoda, respondeme por aquí.`)

  return lines.join('\n')
}

export function buildBookingRescheduledWhatsappUrl(phone: string, data: BookingRescheduledWhatsappData): string {
  return buildWhatsappUrl(phone, buildBookingRescheduledWhatsappMessage(data))
}
