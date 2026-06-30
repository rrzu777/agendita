import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import type {
  BookingEmailData,
  CancellationEmailData,
  ReviewRequestEmailData,
  NewBookingBusinessEmailData,
  ReminderEmailData,
  LoyaltyRewardEmailData,
} from './types'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function fmtDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "EEEE d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })
}

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: currency || 'CLP' }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

function baseHtml(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">${body}</body></html>`
}

function header(title: string): string {
  return `<h1 style="font-size:20px;color:#e91e63;margin-bottom:16px">${escapeHtml(title)}</h1>`
}

function footer(businessName: string): string {
  return `<hr style="border:0;border-top:1px solid #e0e0e0;margin:24px 0 0"><p style="font-size:12px;color:#999;margin-top:8px">Enviado por ${escapeHtml(businessName)} a través de Agendita</p>`
}

function loyaltyLinkHtml(link: string | undefined): string {
  return link
    ? `<p style="margin-top:16px"><a href="${escapeHtml(link)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver mi tarjeta de puntos</a></p>`
    : ''
}

export function bookingConfirmationCustomerHtml(data: BookingEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const total = fmtCurrency(data.totalPrice, data.businessCurrency)
  const deposit = fmtCurrency(data.depositPaid || data.depositRequired, data.businessCurrency)
  const remaining = fmtCurrency(data.remainingBalance, data.businessCurrency)

  const policySection = data.businessCancellationPolicy
    ? `<p style="font-size:13px;color:#666;margin-top:8px"><strong>Política de cancelación:</strong> ${escapeHtml(data.businessCancellationPolicy)}</p>`
    : ''

  const reviewSection = data.reviewLink
    ? `<p style="margin-top:16px"><a href="${data.reviewLink}" style="color:#e91e63;text-decoration:none;font-weight:600">Dejar una reseña</a></p>`
    : ''

  const loyaltySection = loyaltyLinkHtml(data.loyaltyCardLink)

  const whatsappSection = data.businessWhatsapp
    ? `<p style="margin-top:16px"><a href="https://wa.me/${data.businessWhatsapp.replace(/\D/g, '')}" style="color:#25D366;text-decoration:none;font-weight:600">Escribir por WhatsApp</a></p>`
    : ''

  return baseHtml(`
    ${header('¡Reserva confirmada!')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu reserva está confirmada y lista en la agenda.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
      ${data.businessAddress ? `<tr><td style="padding:8px 0;color:#666">Dirección</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.businessAddress)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666">Precio total</td><td style="padding:8px 0;font-weight:600">${total}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Abono pagado</td><td style="padding:8px 0;font-weight:600">${deposit}</td></tr>
      ${remaining !== deposit ? `<tr><td style="padding:8px 0;color:#666">Saldo pendiente</td><td style="padding:8px 0;font-weight:600">${remaining}</td></tr>` : ''}
    </table>
    ${policySection}${reviewSection}${loyaltySection}${whatsappSection}
    ${footer(data.businessName)}
  `)
}

export function bookingConfirmationCustomerText(data: BookingEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const total = fmtCurrency(data.totalPrice, data.businessCurrency)
  const deposit = fmtCurrency(data.depositPaid || data.depositRequired, data.businessCurrency)
  const remaining = fmtCurrency(data.remainingBalance, data.businessCurrency)

  const lines = [
    `¡Reserva confirmada!`,
    ``,
    `Hola ${data.customerName}, tu reserva está confirmada y lista en la agenda.`,
    ``,
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${dateStr}`,
  ]
  if (data.businessAddress) lines.push(`Dirección: ${data.businessAddress}`)
  lines.push(
    `Precio total: ${total}`,
    `Abono pagado: ${deposit}`,
  )
  if (remaining !== deposit) lines.push(`Saldo pendiente: ${remaining}`)
  if (data.businessCancellationPolicy) lines.push(``, `Política de cancelación: ${data.businessCancellationPolicy}`)
  if (data.reviewLink) lines.push(``, `Dejar una reseña: ${data.reviewLink}`)
  if (data.loyaltyCardLink) lines.push(``, `Tu tarjeta de puntos: ${data.loyaltyCardLink}`)
  if (data.businessWhatsapp) lines.push(``, `WhatsApp: https://wa.me/${data.businessWhatsapp.replace(/\D/g, '')}`)
  lines.push(``, `Enviado por ${data.businessName} a través de Agendita`)

  return lines.join('\n')
}

export function bookingReceivedCustomerHtml(data: BookingEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const total = fmtCurrency(data.totalPrice, data.businessCurrency)
  const deposit = fmtCurrency(data.depositRequired, data.businessCurrency)

  const hasDiscount = (data.discountAmount ?? 0) > 0
  const discountSection = hasDiscount
    ? `<tr><td style="padding:8px 0;color:#666">Descuento</td><td style="padding:8px 0;font-weight:600;color:#2e7d32">−${fmtCurrency(data.discountAmount!, data.businessCurrency)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Total con descuento</td><td style="padding:8px 0;font-weight:600">${fmtCurrency(data.finalAmount ?? (data.totalPrice - data.discountAmount!), data.businessCurrency)}</td></tr>`
    : ''

  const policySection = data.businessCancellationPolicy
    ? `<p style="font-size:13px;color:#666;margin-top:8px"><strong>Política de cancelación:</strong> ${escapeHtml(data.businessCancellationPolicy)}</p>`
    : ''

  const whatsappSection = data.businessWhatsapp
    ? `<p style="margin-top:16px"><a href="https://wa.me/${data.businessWhatsapp.replace(/\D/g, '')}" style="color:#25D366;text-decoration:none;font-weight:600">Escribir por WhatsApp</a></p>`
    : ''

  return baseHtml(`
    ${header('Reserva recibida')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, recibimos tu reserva. Está pendiente de pago para quedar confirmada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
      ${data.businessAddress ? `<tr><td style="padding:8px 0;color:#666">Dirección</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.businessAddress)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666">Precio total</td><td style="padding:8px 0;font-weight:600">${total}</td></tr>
      ${discountSection}
      <tr><td style="padding:8px 0;color:#666">Abono requerido</td><td style="padding:8px 0;font-weight:600">${deposit}</td></tr>
    </table>
    <p style="font-size:13px;color:#666;margin-top:16px">Recibirás una confirmación cuando el pago sea registrado.</p>
    ${policySection}${whatsappSection}
    ${footer(data.businessName)}
  `)
}

export function bookingReceivedCustomerText(data: BookingEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const total = fmtCurrency(data.totalPrice, data.businessCurrency)
  const deposit = fmtCurrency(data.depositRequired, data.businessCurrency)

  const lines = [
    `Reserva recibida`,
    ``,
    `Hola ${data.customerName}, recibimos tu reserva. Está pendiente de pago para quedar confirmada.`,
    ``,
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${dateStr}`,
  ]
  if (data.businessAddress) lines.push(`Dirección: ${data.businessAddress}`)
  lines.push(`Precio total: ${total}`)
  if ((data.discountAmount ?? 0) > 0) {
    lines.push(
      `Descuento: −${fmtCurrency(data.discountAmount!, data.businessCurrency)}`,
      `Total con descuento: ${fmtCurrency(data.finalAmount ?? (data.totalPrice - data.discountAmount!), data.businessCurrency)}`,
    )
  }
  lines.push(
    `Abono requerido: ${deposit}`,
    ``,
    `Recibirás una confirmación cuando el pago sea registrado.`,
  )
  if (data.businessCancellationPolicy) lines.push(``, `Política de cancelación: ${data.businessCancellationPolicy}`)
  if (data.businessWhatsapp) lines.push(``, `WhatsApp: https://wa.me/${data.businessWhatsapp.replace(/\D/g, '')}`)
  lines.push(``, `Enviado por ${data.businessName} a través de Agendita`)

  return lines.join('\n')
}

export function newBookingBusinessHtml(data: NewBookingBusinessEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const deposit = fmtCurrency(data.depositRequired, data.businessCurrency)
  const remaining = fmtCurrency(data.remainingBalance, data.businessCurrency)

  return baseHtml(`
    ${header('Nueva reserva recibida')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} acaba de agendar una cita.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Cliente</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Teléfono</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerPhone)}</td></tr>
      ${data.customerEmail ? `<tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerEmail)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Abono</td><td style="padding:8px 0;font-weight:600">${deposit}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Saldo pendiente</td><td style="padding:8px 0;font-weight:600">${remaining}</td></tr>
    </table>
    <p style="margin-top:16px"><a href="${data.dashboardLink}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver en dashboard</a></p>
    ${footer(data.businessName)}
  `)
}

export function newBookingBusinessText(data: NewBookingBusinessEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const deposit = fmtCurrency(data.depositRequired, data.businessCurrency)
  const remaining = fmtCurrency(data.remainingBalance, data.businessCurrency)

  const lines = [
    `Nueva reserva recibida`,
    ``,
    `${data.customerName} acaba de agendar una cita.`,
    ``,
    `Cliente: ${data.customerName}`,
    `Teléfono: ${data.customerPhone}`,
  ]
  if (data.customerEmail) lines.push(`Email: ${data.customerEmail}`)
  lines.push(
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${dateStr}`,
    `Abono: ${deposit}`,
    `Saldo pendiente: ${remaining}`,
    ``,
    `Ver en dashboard: ${data.dashboardLink}`,
    ``,
    `Enviado por ${data.businessName} a través de Agendita`,
  )

  return lines.join('\n')
}

export function bookingCancelledCustomerHtml(data: CancellationEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)

  return baseHtml(`
    ${header('Reserva cancelada')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu reserva ha sido cancelada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
    </table>
    <p style="font-size:13px;color:#666;margin-top:16px">Si tienes dudas, contacta a ${escapeHtml(data.businessName)}.</p>
    ${footer(data.businessName)}
  `)
}

export function bookingCancelledCustomerText(data: CancellationEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)

  return [
    `Reserva cancelada`,
    ``,
    `Hola ${data.customerName}, tu reserva ha sido cancelada.`,
    ``,
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${dateStr}`,
    ``,
    `Si tienes dudas, contacta a ${data.businessName}.`,
    ``,
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}

export function reviewRequestHtml(data: ReviewRequestEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)

  const loyaltySection = loyaltyLinkHtml(data.loyaltyCardLink)

  return baseHtml(`
    ${header('¿Cómo te fue?')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, gracias por visitar ${escapeHtml(data.businessName)}.</p>
    <p style="font-size:14px;color:#666">Tu cita de <strong>${escapeHtml(data.serviceName)}</strong> del ${dateStr} ya fue completada. Nos encantaría saber tu opinión.</p>
    <p style="margin-top:24px"><a href="${data.reviewLink}" style="background:#e91e63;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Dejar reseña</a></p>
    ${loyaltySection}
    <p style="font-size:12px;color:#999;margin-top:16px">Tu opinión ayuda a ${escapeHtml(data.businessName)} a mejorar.</p>
    ${footer(data.businessName)}
  `)
}

export function reviewRequestText(data: ReviewRequestEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)

  const lines = [
    `¿Cómo te fue?`,
    ``,
    `Hola ${data.customerName}, gracias por visitar ${data.businessName}.`,
    ``,
    `Tu cita de ${data.serviceName} del ${dateStr} ya fue completada. Nos encantaría saber tu opinión.`,
    ``,
    `Dejar reseña: ${data.reviewLink}`,
  ]
  if (data.loyaltyCardLink) lines.push(``, `Tu tarjeta de puntos: ${data.loyaltyCardLink}`)
  lines.push(``, `Enviado por ${data.businessName} a través de Agendita`)

  return lines.join('\n')
}

/** Copy contextual por motivo de la recompensa automática. */
function loyaltyRewardCopy(data: LoyaltyRewardEmailData): { title: string; intro: string } {
  switch (data.reason) {
    case 'birthday':
      return {
        title: '¡Feliz cumpleaños! Tenés un regalo',
        intro: `¡Feliz cumpleaños, ${data.customerName}! En ${data.businessName} queremos celebrarlo con vos.`,
      }
    case 'winback':
      return {
        title: 'Te echamos de menos — tenés un regalo',
        intro: `Hola ${data.customerName}, hace rato que no te vemos por ${data.businessName} y te extrañamos.`,
      }
    case 'referral':
      return {
        title: 'Gracias por recomendarnos',
        intro: `Hola ${data.customerName}, gracias por recomendar ${data.businessName}. ¡Tenés un regalo!`,
      }
  }
}

export function loyaltyRewardHtml(data: LoyaltyRewardEmailData): string {
  const { title, intro } = loyaltyRewardCopy(data)
  const cta = data.loyaltyCardLink
    ? `<p style="margin-top:24px"><a href="${escapeHtml(data.loyaltyCardLink)}" style="background:#e91e63;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">Ver mi tarjeta</a></p>`
    : ''

  return baseHtml(`
    ${header(title)}
    <p style="font-size:15px">${escapeHtml(intro)}</p>
    <p style="font-size:16px;margin-top:16px">Te regalamos <strong>${escapeHtml(data.rewardLabel)}</strong>.</p>
    ${cta}
    ${footer(data.businessName)}
  `)
}

export function loyaltyRewardText(data: LoyaltyRewardEmailData): string {
  const { title, intro } = loyaltyRewardCopy(data)
  const lines = [
    title,
    ``,
    intro,
    ``,
    `Te regalamos ${data.rewardLabel}.`,
  ]
  if (data.loyaltyCardLink) lines.push(``, `Ver mi tarjeta: ${data.loyaltyCardLink}`)
  lines.push(``, `Enviado por ${data.businessName} a través de Agendita`)
  return lines.join('\n')
}

// Template definitions used for preview and rendering
export const BOOKING_CONFIRMED_TEMPLATE = {
  id: 'booking_confirmed',
  subject: 'Tu reserva en {businessName} está confirmada',
  variables: ['businessName', 'customerName', 'serviceName', 'startDateTime', 'price', 'amountPaid', 'remainingBalance'] as const,
}

export const BOOKING_REMINDER_TEMPLATE = {
  id: 'booking_reminder',
  subject: 'Recordatorio de tu reserva mañana en {businessName}',
  variables: ['businessName', 'customerName', 'serviceName', 'startDateTime', 'price', 'amountPaid', 'remainingBalance'] as const,
}

export const BOOKING_CANCELLED_TEMPLATE = {
  id: 'booking_cancelled',
  subject: 'Tu reserva fue cancelada',
  variables: ['businessName', 'customerName', 'serviceName', 'startDateTime'] as const,
}

export const PAYMENT_RECEIVED_TEMPLATE = {
  id: 'payment_received',
  subject: 'Abono recibido — {businessName}',
  variables: ['businessName', 'customerName', 'serviceName', 'startDateTime', 'amountPaid'] as const,
}

export function paymentReceivedHtml(data: {
  businessName: string
  customerName: string
  customerEmail?: string | null
  serviceName: string
  startDateTime: Date
  businessTimezone: string
  amountPaid: number
  businessCurrency: string
}): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const amount = fmtCurrency(data.amountPaid, data.businessCurrency)

  return baseHtml(`
    ${header('Abono recibido')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, hemos recibido tu abono.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Monto abonado</td><td style="padding:8px 0;font-weight:600;color:#2e7d32">${amount}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function paymentReceivedText(data: {
  businessName: string
  customerName: string
  serviceName: string
  startDateTime: Date
  businessTimezone: string
  amountPaid: number
  businessCurrency: string
}): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const amount = fmtCurrency(data.amountPaid, data.businessCurrency)

  return [
    `Abono recibido`,
    ``,
    `Hola ${data.customerName}, hemos recibido tu abono.`,
    ``,
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${dateStr}`,
    `Monto abonado: ${amount}`,
    ``,
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}

export function bookingReminderHtml(data: ReminderEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const balanceLine = data.remainingBalance > 0
    ? `<p style="font-size:14px;color:#e91e63;margin-top:12px">Saldo pendiente: ${fmtCurrency(data.remainingBalance, data.businessCurrency)}</p>`
    : ''

  const whatsappLine = data.businessWhatsapp
    ? `<p style="font-size:14px;color:#666;margin-top:12px">WhatsApp: <a href="https://wa.me/${data.businessWhatsapp.replace(/^\+/, '')}" style="color:#e91e63">${escapeHtml(data.businessWhatsapp)}</a></p>`
    : ''

  return baseHtml(`
    ${header('Recordatorio de tu cita')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)},</p>
    <p style="font-size:14px;color:#666">Tu cita de <strong>${escapeHtml(data.serviceName)}</strong> es mañana:</p>
    <div style="background:#f9f9f9;border-radius:12px;padding:20px;margin:16px 0">
      <p style="font-size:18px;font-weight:600;color:#1a1a2e;margin:0">${dateStr}</p>
      <p style="font-size:14px;color:#666;margin:8px 0 0">${escapeHtml(data.businessName)}</p>
      ${data.businessAddress ? `<p style="font-size:13px;color:#999;margin:4px 0 0">${escapeHtml(data.businessAddress!)}</p>` : ''}
    </div>
    <p style="font-size:14px;color:#666">Total: ${fmtCurrency(data.totalPrice, data.businessCurrency)} | Abonado: ${fmtCurrency(data.depositPaid, data.businessCurrency)}</p>
    ${balanceLine}
    ${whatsappLine}
    ${footer(data.businessName)}
  `)
}

export function bookingReminderText(data: ReminderEmailData): string {
  const dateStr = fmtDate(data.startDateTime, data.businessTimezone)
  const balanceLine = data.remainingBalance > 0
    ? `Saldo pendiente: ${data.businessCurrency} ${data.remainingBalance}`
    : ''

  return [
    `Recordatorio de tu cita`,
    ``,
    `Hola ${data.customerName},`,
    ``,
    `Tu cita de ${data.serviceName} es mañana:`,
    ``,
    `${dateStr}`,
    `${data.businessName}`,
    data.businessAddress ?? '',
    ``,
    `Total: ${data.businessCurrency} ${data.totalPrice} | Abonado: ${data.businessCurrency} ${data.depositPaid}`,
    balanceLine,
    data.businessWhatsapp ? `WhatsApp: ${data.businessWhatsapp}` : '',
    ``,
    `Enviado por ${data.businessName} a través de Agendita`,
  ].filter(Boolean).join('\n')
}
