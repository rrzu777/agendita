import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import { unsubscribeFooterHtml, unsubscribeFooterText } from './marketing-email'
import { formatMoney } from '@/lib/money'
import type {
  BookingEmailData,
  CancellationEmailData,
  ReviewRequestEmailData,
  NewBookingBusinessEmailData,
  BankTransferDeclaredEmailData,
  BankTransferVerifyCustomerEmailData,
  BalanceTransferCustomerEmailData,
  ReminderEmailData,
  LoyaltyRewardEmailData,
  RescheduledEmailData,
  TransferReminderCustomerEmailData,
  TransferReminderBusinessEmailData,
  OwnerBookingChangedData,
  PackagePurchasedEmailData,
  PackageDisputedEmailData,
  BookingDisputedEmailData,
  PackageTransferDeclaredEmailData,
  PackageTransferReminderCustomerEmailData,
  PackageTransferUnverifiedBusinessEmailData,
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
  return formatMoney(amount, currency || 'CLP')
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

function bookingNumberRowHtml(n: number | null | undefined): string {
  return n != null
    ? `<tr><td style="padding:8px 0;color:#666">Reserva</td><td style="padding:8px 0;font-weight:600">#${n}</td></tr>`
    : ''
}

function loyaltyLinkHtml(link: string | undefined): string {
  return link
    ? `<p style="margin-top:16px"><a href="${escapeHtml(link)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver mi tarjeta de puntos</a></p>`
    : ''
}

export function bankTransferBlockHtml(
  bt: NonNullable<BookingEmailData['bankTransfer']>, depositLabel: string, timezone: string, kind: string = 'abono',
): string {
  return `<div style="margin-top:16px;border:1px solid #e0e0e0;border-radius:8px;padding:16px">
        <p style="font-weight:600;margin:0 0 8px">Datos para transferir el ${kind} (${depositLabel})</p>
        <table style="font-size:14px;border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0;color:#666">Titular</td><td>${escapeHtml(bt.accountHolder)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">RUT</td><td>${escapeHtml(bt.rut)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Banco</td><td>${escapeHtml(bt.bankName)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Tipo</td><td>${escapeHtml(bt.accountType)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#666">Cuenta</td><td>${escapeHtml(bt.accountNumber)}</td></tr>
          ${bt.email ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td>${escapeHtml(bt.email)}</td></tr>` : ''}
        </table>
        ${bt.instructions ? `<p style="font-size:13px;color:#666;margin:8px 0 0">${escapeHtml(bt.instructions)}</p>` : ''}
        ${bt.deadline ? `<p style="font-size:13px;margin:8px 0 0"><strong>Plazo:</strong> tenés hasta el ${fmtDate(bt.deadline, timezone)} para transferir y avisarnos.</p>` : ''}
        <p style="margin:12px 0 0"><a href="${escapeHtml(bt.confirmationUrl)}" style="color:#e91e63;text-decoration:none;font-weight:600">Cuando transfieras, avisá con el botón "Ya transferí" acá →</a></p>
      </div>`
}

export function bankTransferBlockText(
  bt: NonNullable<BookingEmailData['bankTransfer']>, depositLabel: string, timezone: string, kind: string = 'abono',
): string[] {
  const lines = [
    ``,
    `Datos para transferir el ${kind} (${depositLabel}):`,
    `Titular: ${bt.accountHolder}`,
    `RUT: ${bt.rut}`,
    `Banco: ${bt.bankName}`,
    `Tipo: ${bt.accountType}`,
    `Cuenta: ${bt.accountNumber}`,
  ]
  if (bt.email) lines.push(`Email: ${bt.email}`)
  if (bt.instructions) lines.push(bt.instructions)
  if (bt.deadline) lines.push(`Plazo: hasta ${fmtDate(bt.deadline, timezone)}`)
  lines.push(`Cuando transfieras, avisá con "Ya transferí" acá: ${bt.confirmationUrl}`)
  return lines
}

export function transferReminderCustomerHtml(data: TransferReminderCustomerEmailData): string {
  const deposit = fmtCurrency(data.depositAmount, data.businessCurrency)
  return baseHtml(`
    ${header('Te quedan pocas horas para transferir')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu reserva de <strong>${escapeHtml(data.serviceName)}</strong> sigue pendiente. Transferí el abono y avisanos hoy para no perder tu cupo.</p>
    ${bankTransferBlockHtml(data.bankTransfer, deposit, data.businessTimezone)}
    ${footer(data.businessName)}
  `)
}

export function transferReminderCustomerText(data: TransferReminderCustomerEmailData): string {
  const deposit = fmtCurrency(data.depositAmount, data.businessCurrency)
  return [
    `Hola ${data.customerName}, tu reserva de ${data.serviceName} sigue pendiente.`,
    `Transferí el abono y avisanos hoy para no perder tu cupo.`,
    ...bankTransferBlockText(data.bankTransfer, deposit, data.businessTimezone),
  ].join('\n')
}

export function transferReminderBusinessHtml(data: TransferReminderBusinessEmailData): string {
  return baseHtml(`
    ${header('Tenés una transferencia por verificar')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} declaró una transferencia por <strong>${escapeHtml(data.serviceName)}</strong>${data.bookingNumber != null ? ` (reserva #${data.bookingNumber})` : ''} que sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la reserva antes de que expire.</p>
    <p style="margin-top:16px"><a href="${escapeHtml(data.dashboardUrl)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ir a verificar en el dashboard →</a></p>
    ${footer(data.businessName)}
  `)
}

export function transferReminderBusinessText(data: TransferReminderBusinessEmailData): string {
  return `${data.customerName} declaró una transferencia por ${data.serviceName} en ${data.businessName} que sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la reserva antes de que expire. Ir al dashboard: ${data.dashboardUrl}`
}

// Reserva expirada que la dueña reabrió (reviveBooking mode 'reopen'): mismos
// datos que el recordatorio de transferencia — reusa su tipo a propósito.
export function transferReactivatedCustomerHtml(data: TransferReminderCustomerEmailData): string {
  const deposit = fmtCurrency(data.depositAmount, data.businessCurrency)
  return baseHtml(`
    ${header('Tu reserva fue reactivada')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ¡buenas noticias! ${escapeHtml(data.businessName)} reactivó tu reserva de <strong>${escapeHtml(data.serviceName)}</strong>${data.bookingNumber != null ? ` (reserva #${data.bookingNumber})` : ''}. Transferí el abono y avisanos antes del plazo para confirmarla.</p>
    ${bankTransferBlockHtml(data.bankTransfer, deposit, data.businessTimezone)}
    ${footer(data.businessName)}
  `)
}

export function transferReactivatedCustomerText(data: TransferReminderCustomerEmailData): string {
  const deposit = fmtCurrency(data.depositAmount, data.businessCurrency)
  return [
    `Hola ${data.customerName}, ${data.businessName} reactivó tu reserva de ${data.serviceName}.`,
    `Transferí el abono y avisanos antes del plazo para confirmarla.`,
    ...bankTransferBlockText(data.bankTransfer, deposit, data.businessTimezone),
  ].join('\n')
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
      ${bookingNumberRowHtml(data.bookingNumber)}
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
    ...(data.bookingNumber != null ? [`Reserva: #${data.bookingNumber}`] : []),
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

  const bankSection = data.bankTransfer
    ? bankTransferBlockHtml(data.bankTransfer, deposit, data.businessTimezone)
    : ''

  return baseHtml(`
    ${header('Reserva recibida')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, recibimos tu reserva. Está pendiente de pago para quedar confirmada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      ${bookingNumberRowHtml(data.bookingNumber)}
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
      ${data.businessAddress ? `<tr><td style="padding:8px 0;color:#666">Dirección</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.businessAddress)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666">Precio total</td><td style="padding:8px 0;font-weight:600">${total}</td></tr>
      ${discountSection}
      <tr><td style="padding:8px 0;color:#666">Abono requerido</td><td style="padding:8px 0;font-weight:600">${deposit}</td></tr>
    </table>
    ${bankSection}
    <p style="font-size:13px;color:#666;margin-top:16px">${data.bankTransfer ? 'Tu reserva quedará confirmada cuando el negocio verifique la transferencia.' : 'Recibirás una confirmación cuando el pago sea registrado.'}</p>
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
    ...(data.bookingNumber != null ? [`Reserva: #${data.bookingNumber}`] : []),
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
  lines.push(`Abono requerido: ${deposit}`)
  if (data.bankTransfer) {
    lines.push(
      ...bankTransferBlockText(data.bankTransfer, deposit, data.businessTimezone),
      ``,
      `Tu reserva quedará confirmada cuando el negocio verifique la transferencia.`,
    )
  } else {
    lines.push(``, `Recibirás una confirmación cuando el pago sea registrado.`)
  }
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
      ${bookingNumberRowHtml(data.bookingNumber)}
      <tr><td style="padding:8px 0;color:#666">Cliente</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Teléfono</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerPhone)}</td></tr>
      ${data.customerEmail ? `<tr><td style="padding:8px 0;color:#666">Email</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerEmail)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Abono</td><td style="padding:8px 0;font-weight:600">${deposit}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Saldo pendiente</td><td style="padding:8px 0;font-weight:600">${remaining}</td></tr>
    </table>
    ${data.paymentNote ? `<p style="margin-top:12px;font-size:13px;color:#666">${escapeHtml(data.paymentNote)}</p>` : ''}
    <p style="margin-top:16px"><a href="${data.dashboardLink}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver en dashboard</a></p>
    ${footer(data.businessName)}
  `)
}

function ownerBookingChangedCopy(data: OwnerBookingChangedData): { title: string; intro: string } {
  if (data.change.kind === 'cancelled') {
    return {
      title: 'Reserva cancelada',
      intro: `${escapeHtml(data.customerName)} canceló su reserva.`,
    }
  }
  return {
    title: 'Reserva reprogramada',
    intro: `${escapeHtml(data.customerName)} reprogramó su reserva.`,
  }
}

export function ownerBookingChangedHtml(data: OwnerBookingChangedData): string {
  const { title, intro } = ownerBookingChangedCopy(data)

  const scheduleRows =
    data.change.kind === 'cancelled'
      ? `<tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>`
      : `<tr><td style="padding:8px 0;color:#666">Horario anterior</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.change.previousStartDateTime, data.businessTimezone)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Nuevo horario</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.change.newStartDateTime, data.businessTimezone)}</td></tr>`

  return baseHtml(`
    ${header(title)}
    <p style="font-size:15px">${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      ${bookingNumberRowHtml(data.bookingNumber)}
      <tr><td style="padding:8px 0;color:#666">Cliente</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      ${scheduleRows}
    </table>
    ${footer(data.businessName)}
  `)
}

export function ownerBookingChangedText(data: OwnerBookingChangedData): string {
  const { title } = ownerBookingChangedCopy(data)
  const plainIntro = data.change.kind === 'cancelled'
    ? `${data.customerName} canceló su reserva.`
    : `${data.customerName} reprogramó su reserva.`

  const lines = [
    title,
    ``,
    plainIntro,
    ``,
    ...(data.bookingNumber != null ? [`Reserva: #${data.bookingNumber}`] : []),
    `Cliente: ${data.customerName}`,
    `Servicio: ${data.serviceName}`,
  ]

  if (data.change.kind === 'cancelled') {
    lines.push(`Fecha y hora: ${fmtDate(data.startDateTime, data.businessTimezone)}`)
  } else {
    lines.push(
      `Horario anterior: ${fmtDate(data.change.previousStartDateTime, data.businessTimezone)}`,
      `Nuevo horario: ${fmtDate(data.change.newStartDateTime, data.businessTimezone)}`,
    )
  }

  lines.push(``, `Enviado por ${data.businessName} a través de Agendita`)

  return lines.join('\n')
}

export function bankTransferDeclaredBusinessHtml(data: BankTransferDeclaredEmailData): string {
  return baseHtml(`
    ${header('Transferencia declarada')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} avisó que transfirió <strong>${fmtCurrency(data.amount, data.currency)}</strong> por la reserva${data.bookingNumber != null ? ` <strong>#${data.bookingNumber}</strong>` : ''}.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    ${data.hasProof ? `<p style="margin-top:16px;font-size:14px">Adjuntó comprobante de transferencia. Podés verlo en el dashboard.</p>` : ''}
    <p style="margin-top:16px;font-size:14px">Verificá en tu cuenta bancaria y confirmá la reserva desde el dashboard.</p>
    ${footer(data.businessName)}
  `)
}

export function bankTransferDeclaredBusinessText(data: BankTransferDeclaredEmailData): string {
  const lines = [
    'Transferencia declarada',
    '',
    `${data.customerName} avisó que transfirió ${fmtCurrency(data.amount, data.currency)} por la reserva${data.bookingNumber != null ? ` #${data.bookingNumber}` : ''}.`,
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${fmtDate(data.startDateTime, data.businessTimezone)}`,
    ...(data.hasProof ? ['', 'Adjuntó comprobante de transferencia. Podés verlo en el dashboard.'] : []),
    '',
    'Verificá en tu cuenta bancaria y confirmá la reserva desde el dashboard.',
    '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ]
  return lines.join('\n')
}

export function bankTransferRejectedCustomerHtml(data: BankTransferVerifyCustomerEmailData): string {
  return baseHtml(`
    ${header('Tu transferencia no pudo verificarse')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ${escapeHtml(data.businessName)} no pudo verificar tu transferencia y tu reserva fue cancelada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:14px">Si transferiste, contactá directamente al negocio para resolverlo.</p>
    ${footer(data.businessName)}
  `)
}

export function bankTransferRejectedCustomerText(data: BankTransferVerifyCustomerEmailData): string {
  return `Hola ${data.customerName}, ${data.businessName} no pudo verificar tu transferencia y tu reserva (${data.serviceName}, ${fmtDate(data.startDateTime, data.businessTimezone)}) fue cancelada. Si transferiste, contactá al negocio directamente.`
}

export function balanceTransferDeclaredBusinessHtml(data: BankTransferDeclaredEmailData): string {
  return baseHtml(`
    ${header('Transferencia del saldo por verificar')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} avisó que transfirió el saldo de <strong>${fmtCurrency(data.amount, data.currency)}</strong> por <strong>${escapeHtml(data.serviceName)}</strong>${data.bookingNumber != null ? ` (reserva #${data.bookingNumber})` : ''}.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    ${data.hasProof ? `<p style="margin-top:16px;font-size:14px">Adjuntó comprobante de transferencia. Podés verlo en el dashboard.</p>` : ''}
    <p style="margin-top:16px;font-size:14px">Verificá en tu cuenta bancaria y confirmá el saldo desde el dashboard.</p>
    ${footer(data.businessName)}
  `)
}

export function balanceTransferDeclaredBusinessText(data: BankTransferDeclaredEmailData): string {
  const lines = [
    'Transferencia del saldo por verificar',
    '',
    `${data.customerName} avisó que transfirió el saldo de ${fmtCurrency(data.amount, data.currency)} por ${data.serviceName}${data.bookingNumber != null ? ` (reserva #${data.bookingNumber})` : ''}.`,
    `Servicio: ${data.serviceName}`,
    `Fecha y hora: ${fmtDate(data.startDateTime, data.businessTimezone)}`,
    ...(data.hasProof ? ['', 'Adjuntó comprobante de transferencia. Podés verlo en el dashboard.'] : []),
    '',
    'Verificá en tu cuenta bancaria y confirmá el saldo desde el dashboard.',
    '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ]
  return lines.join('\n')
}

export function balanceTransferVerifiedCustomerHtml(data: BalanceTransferCustomerEmailData): string {
  return baseHtml(`
    ${header('Recibimos tu pago')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ${escapeHtml(data.businessName)} verificó tu transferencia del saldo de <strong>${fmtCurrency(data.amount, data.currency)}</strong> por <strong>${escapeHtml(data.serviceName)}</strong>. ¡Gracias!</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function balanceTransferVerifiedCustomerText(data: BalanceTransferCustomerEmailData): string {
  return `Hola ${data.customerName}, ${data.businessName} verificó tu transferencia del saldo de ${fmtCurrency(data.amount, data.currency)} por ${data.serviceName} (${fmtDate(data.startDateTime, data.businessTimezone)}). ¡Gracias!`
}

export function balanceTransferRejectedCustomerHtml(data: BalanceTransferCustomerEmailData): string {
  return baseHtml(`
    ${header('No pudimos verificar tu transferencia')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ${escapeHtml(data.businessName)} no pudo verificar tu transferencia del saldo de <strong>${fmtCurrency(data.amount, data.currency)}</strong> por <strong>${escapeHtml(data.serviceName)}</strong>. Tu reserva sigue igual.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:14px">Escribile al negocio o volvé a avisar desde tu página de reserva.</p>
    ${footer(data.businessName)}
  `)
}

export function balanceTransferRejectedCustomerText(data: BalanceTransferCustomerEmailData): string {
  return `Hola ${data.customerName}, ${data.businessName} no pudo verificar tu transferencia del saldo de ${fmtCurrency(data.amount, data.currency)} por ${data.serviceName} (${fmtDate(data.startDateTime, data.businessTimezone)}). Tu reserva sigue igual. Escribile al negocio o volvé a avisar desde tu página de reserva.`
}

export function bankTransferExpiredCustomerHtml(data: BankTransferVerifyCustomerEmailData): string {
  return baseHtml(`
    ${header('Tu reserva expiró')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu reserva en ${escapeHtml(data.businessName)} expiró porque no se verificó el pago a tiempo.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha y hora</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
    </table>
    <p style="margin-top:16px;font-size:14px">Si transferiste, escribile al negocio: también puede reactivar tu reserva. Si no, podés reservar de nuevo cuando quieras.</p>
    ${footer(data.businessName)}
  `)
}

export function bankTransferExpiredCustomerText(data: BankTransferVerifyCustomerEmailData): string {
  return `Hola ${data.customerName}, tu reserva en ${data.businessName} (${data.serviceName}, ${fmtDate(data.startDateTime, data.businessTimezone)}) expiró porque no se verificó el pago a tiempo. Si transferiste, escribile al negocio: también puede reactivar tu reserva.`
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
    ...(data.bookingNumber != null ? [`Reserva: #${data.bookingNumber}`] : []),
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

export function bookingRescheduledCustomerHtml(data: RescheduledEmailData): string {
  const previousDateStr = fmtDate(data.previousStartDateTime, data.businessTimezone)
  const newDateStr = fmtDate(data.newStartDateTime, data.businessTimezone)

  const whatsappSection = data.businessWhatsapp
    ? `<p style="margin-top:16px"><a href="https://wa.me/${data.businessWhatsapp.replace(/\D/g, '')}" style="color:#25D366;text-decoration:none;font-weight:600">Escribir por WhatsApp</a></p>`
    : ''

  return baseHtml(`
    ${header('Reserva reprogramada')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, ${escapeHtml(data.businessName)} reprogramó tu reserva.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      ${bookingNumberRowHtml(data.bookingNumber)}
      <tr><td style="padding:8px 0;color:#666">Servicio</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Horario anterior</td><td style="padding:8px 0;font-weight:600">${previousDateStr}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Nuevo horario</td><td style="padding:8px 0;font-weight:600">${newDateStr}</td></tr>
      ${data.businessAddress ? `<tr><td style="padding:8px 0;color:#666">Dirección</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.businessAddress)}</td></tr>` : ''}
    </table>
    <p style="font-size:13px;color:#666;margin-top:16px">Si este nuevo horario no te acomoda, contacta a ${escapeHtml(data.businessName)}.</p>
    ${whatsappSection}
    ${footer(data.businessName)}
  `)
}

export function bookingRescheduledCustomerText(data: RescheduledEmailData): string {
  const previousDateStr = fmtDate(data.previousStartDateTime, data.businessTimezone)
  const newDateStr = fmtDate(data.newStartDateTime, data.businessTimezone)

  const lines = [
    `Reserva reprogramada`,
    ``,
    `Hola ${data.customerName}, ${data.businessName} reprogramó tu reserva.`,
    ``,
    ...(data.bookingNumber != null ? [`Reserva: #${data.bookingNumber}`] : []),
    `Servicio: ${data.serviceName}`,
    `Horario anterior: ${previousDateStr}`,
    `Nuevo horario: ${newDateStr}`,
  ]
  if (data.businessAddress) lines.push(`Dirección: ${data.businessAddress}`)
  lines.push(
    ``,
    `Si este nuevo horario no te acomoda, contacta a ${data.businessName}.`,
  )
  if (data.businessWhatsapp) lines.push(`WhatsApp: https://wa.me/${data.businessWhatsapp.replace(/\D/g, '')}`)
  lines.push(``, `Enviado por ${data.businessName} a través de Agendita`)

  return lines.join('\n')
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

  const unsub = data.unsubscribeToken ? unsubscribeFooterHtml(data.unsubscribeToken) : ''
  return baseHtml(`
    ${header(title)}
    <p style="font-size:15px">${escapeHtml(intro)}</p>
    <p style="font-size:16px;margin-top:16px">Te regalamos <strong>${escapeHtml(data.rewardLabel)}</strong>.</p>
    ${cta}
    ${footer(data.businessName)}
    ${unsub}
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
  const unsub = data.unsubscribeToken ? `\n\n${unsubscribeFooterText(data.unsubscribeToken)}` : ''
  return lines.join('\n') + unsub
}

/** Cuerpo de email de campaña: el mensaje de la campaña (mismo texto que WhatsApp,
 *  placeholders ya sustituidos) envuelto en el layout estándar, con footer transaccional
 *  y el footer de baja de marketing (pasado ya renderizado por el caller). */
export function campaignPromoHtml(data: {
  businessName: string
  message: string
  unsubscribeFooterHtml: string
}): string {
  const body = escapeHtml(data.message).replace(/\n/g, '<br>')
  return baseHtml(`
    <p style="font-size:15px">${body}</p>
    ${footer(data.businessName)}
    ${data.unsubscribeFooterHtml}
  `)
}

export function campaignPromoText(message: string, unsubscribeFooterText: string): string {
  return `${message}\n\n${unsubscribeFooterText}`
}

export function packagePurchasedCustomerHtml(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  const cardSection = data.cardLink
    ? `<p style="margin-top:16px"><a href="${escapeHtml(data.cardLink)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ver mis paquetes</a></p>`
    : ''
  return baseHtml(`
    ${header('¡Paquete comprado!')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu compra fue confirmada.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Paquete</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.productName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Sesiones disponibles</td><td style="padding:8px 0;font-weight:600">${data.totalSessions}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Total pagado</td><td style="padding:8px 0;font-weight:600">${price}</td></tr>
    </table>
    ${cardSection}
    ${footer(data.businessName)}
  `)
}

export function packagePurchasedCustomerText(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  const lines = [
    '¡Paquete comprado!', '',
    `Hola ${data.customerName}, tu compra fue confirmada.`, '',
    `Paquete: ${data.productName}`,
    `Sesiones disponibles: ${data.totalSessions}`,
    `Total pagado: ${price}`,
  ]
  if (data.cardLink) lines.push('', `Ver mis paquetes: ${data.cardLink}`)
  lines.push('', `Enviado por ${data.businessName} a través de Agendita`)
  return lines.join('\n')
}

export function packageSoldBusinessHtml(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  return baseHtml(`
    ${header('Vendiste un paquete')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} compró un paquete online.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Clienta</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Paquete</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.productName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Sesiones</td><td style="padding:8px 0;font-weight:600">${data.totalSessions}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Total</td><td style="padding:8px 0;font-weight:600">${price}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function packageSoldBusinessText(data: PackagePurchasedEmailData): string {
  const price = fmtCurrency(data.pricePaid, data.businessCurrency)
  return [
    'Vendiste un paquete', '',
    `${data.customerName} compró un paquete online.`, '',
    `Clienta: ${data.customerName}`,
    `Paquete: ${data.productName}`,
    `Sesiones: ${data.totalSessions}`,
    `Total: ${price}`, '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}

export function packageDisputedBusinessHtml(data: PackageDisputedEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return baseHtml(`
    ${header('Contracargo de paquete')}
    <p style="font-size:15px">Se registró un contracargo (chargeback) de un paquete de ${escapeHtml(data.customerName)}. La compra fue revertida automáticamente.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Clienta</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Paquete</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.productName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Monto</td><td style="padding:8px 0;font-weight:600">${amount}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function packageDisputedBusinessText(data: PackageDisputedEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return [
    'Contracargo de paquete', '',
    `Se registró un contracargo (chargeback) de un paquete de ${data.customerName}. La compra fue revertida automáticamente.`, '',
    `Clienta: ${data.customerName}`,
    `Paquete: ${data.productName}`,
    `Monto: ${amount}`, '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}

export function bookingDisputedBusinessHtml(data: BookingDisputedEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return baseHtml(`
    ${header('Contracargo de reserva')}
    <p style="font-size:15px">Se registró un contracargo (chargeback) del pago de una reserva de ${escapeHtml(data.customerName)}. El pago fue revertido y la reserva quedó marcada — revisá si querés cancelarla, recobrar o atender igual.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Clienta</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Reserva</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.bookingLabel)} — ${escapeHtml(data.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Fecha</td><td style="padding:8px 0;font-weight:600">${fmtDate(data.startDateTime, data.businessTimezone)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Monto</td><td style="padding:8px 0;font-weight:600">${amount}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function bookingDisputedBusinessText(data: BookingDisputedEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return [
    'Contracargo de reserva', '',
    `Se registró un contracargo (chargeback) del pago de una reserva de ${data.customerName}. El pago fue revertido y la reserva quedó marcada.`, '',
    `Clienta: ${data.customerName}`,
    `Reserva: ${data.bookingLabel} — ${data.serviceName}`,
    `Fecha: ${fmtDate(data.startDateTime, data.businessTimezone)}`,
    `Monto: ${amount}`, '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
}

export function packageTransferDeclaredBusinessHtml(data: PackageTransferDeclaredEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return baseHtml(`
    ${header('Transferencia de paquete declarada')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} declaró una transferencia por un paquete. Verificá el pago y confirmá o rechazá.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
      <tr><td style="padding:8px 0;color:#666">Clienta</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Paquete</td><td style="padding:8px 0;font-weight:600">${escapeHtml(data.productName)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Monto</td><td style="padding:8px 0;font-weight:600">${amount}</td></tr>
    </table>
    ${footer(data.businessName)}
  `)
}

export function packageTransferDeclaredBusinessText(data: PackageTransferDeclaredEmailData): string {
  const amount = fmtCurrency(data.amount, data.businessCurrency)
  return [
    'Transferencia de paquete declarada', '',
    `${data.customerName} declaró una transferencia por un paquete. Verificá el pago y confirmá o rechazá.`, '',
    `Clienta: ${data.customerName}`,
    `Paquete: ${data.productName}`,
    `Monto: ${amount}`, '',
    `Enviado por ${data.businessName} a través de Agendita`,
  ].join('\n')
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
    ${data.bookingNumber != null ? `<p style="font-size:13px;color:#999;margin:0 0 8px">Reserva #${data.bookingNumber}</p>` : ''}
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
    ...(data.bookingNumber != null ? [`Reserva #${data.bookingNumber}`] : []),
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

export function packageTransferReminderCustomerHtml(data: PackageTransferReminderCustomerEmailData): string {
  const total = fmtCurrency(data.amount, data.businessCurrency)
  return baseHtml(`
    ${header('Te quedan pocas horas para transferir')}
    <p style="font-size:15px">Hola ${escapeHtml(data.customerName)}, tu compra del paquete <strong>${escapeHtml(data.productName)}</strong> sigue pendiente. Transferí y avisanos hoy para que el negocio la confirme.</p>
    ${bankTransferBlockHtml(data.bankTransfer, total, data.businessTimezone, 'pago')}
    ${footer(data.businessName)}
  `)
}

export function packageTransferReminderCustomerText(data: PackageTransferReminderCustomerEmailData): string {
  const total = fmtCurrency(data.amount, data.businessCurrency)
  return [
    `Hola ${data.customerName}, tu compra del paquete ${data.productName} sigue pendiente.`,
    `Transferí y avisanos hoy para que el negocio la confirme.`,
    ...bankTransferBlockText(data.bankTransfer, total, data.businessTimezone, 'pago'),
  ].join('\n')
}

export function packageTransferUnverifiedBusinessHtml(data: PackageTransferUnverifiedBusinessEmailData): string {
  return baseHtml(`
    ${header('Tenés una transferencia de paquete por verificar')}
    <p style="font-size:15px">${escapeHtml(data.customerName)} declaró una transferencia por el paquete <strong>${escapeHtml(data.productName)}</strong> hace más de un día y sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la compra.</p>
    <p style="margin-top:16px"><a href="${escapeHtml(data.dashboardUrl)}" style="color:#e91e63;text-decoration:none;font-weight:600">Ir a verificar en el dashboard →</a></p>
    ${footer(data.businessName)}
  `)
}

export function packageTransferUnverifiedBusinessText(data: PackageTransferUnverifiedBusinessEmailData): string {
  return `${data.customerName} declaró una transferencia por el paquete ${data.productName} en ${data.businessName} hace más de un día y sigue sin verificar. Revisá tu cuenta y confirmá o rechazá la compra. Ir al dashboard: ${data.dashboardUrl}`
}
