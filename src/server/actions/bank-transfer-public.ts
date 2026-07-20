'use server'

import { addHours } from 'date-fns'
import { revalidatePath } from 'next/cache'
import { Prisma, PaymentProvider, PaymentStatus, PaymentType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { BANK_TRANSFER_PUBLIC_SELECT, type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { btDeclaredId, btBalanceId, BANK_TRANSFER_METHOD, FIRM_BOOKING_STATUSES } from '@/lib/bank-transfer/declared'
import { getProofStorage, isProofUploadAvailable, type ProofStorage } from '@/lib/storage/r2'
import { proofKey, isAllowedProofType, PROOF_MAX_BYTES, type ProofKind } from '@/lib/storage/proof'
import { deriveManualPaymentType } from '@/lib/payments/derive-payment-type'
import {
  sendMultiNotificationSafely,
  sendBankTransferDeclaredToBusiness,
  sendBalanceTransferDeclaredToBusiness,
} from '@/lib/notifications'
import { action, UserError } from '@/lib/actions/result'

// NOTE: módulo 'use server' — SOLO funciones async exportadas (schemas/consts
// en src/lib/bank-transfer/). Flujo PÚBLICO: sin sesión, mismo modelo de
// seguridad que payments.ts (identidad = bookingId cuid + rate limit).

/** Resuelve el ProofStorage: usa el inyectado por tests si viene (incluido
 *  `null` explícito), si no el real. */
function resolveStorage(injected?: ProofStorage | null): ProofStorage | null {
  return injected !== undefined ? injected : getProofStorage()
}

/**
 * Deliberadamente SIN action(): nunca lanza (solo lee vía prisma.findFirst y
 * devuelve null si no hay cuenta habilitada) — no hay throw que sanear.
 * Dual-use: la llaman páginas server (dashboard/bookings, book/confirmation,
 * paquetes/*) Y directo desde el cliente en step-payment.tsx (mismo
 * Promise.all que getOnlinePaymentAvailability — ver payments.ts, mismo
 * patrón documentado ahí). Envolverla en ActionResult rompería ambos
 * callers sin ganar nada: no hay mensaje user-facing que proteger.
 */
export async function getBankTransferInfo(businessId: string): Promise<BankTransferPublicInfo | null> {
  const row = await prisma.bankTransferAccount.findFirst({
    where: { businessId, isEnabled: true },
    select: { ...BANK_TRANSFER_PUBLIC_SELECT, business: { select: { requireTransferProof: true } } },
  })
  if (!row) return null
  const { business, ...rest } = row
  // requireProof se apaga si R2 no está disponible (aunque la dueña lo active).
  return { ...rest, requireProof: business.requireTransferProof && isProofUploadAvailable() }
}

type ProofDeps = { storage?: ProofStorage | null }

/** Mina una URL PUT prefirmada para subir el comprobante ANTES de declarar.
 *  Público: identidad = bookingId (cuid) + rate limit, igual que declare*. */
async function _createProofUploadUrl(
  bookingId: string,
  kind: ProofKind,
  contentType: string,
  deps: ProofDeps = {},
): Promise<{ uploadUrl: string; key: string }> {
  const limit = await checkRateLimit('proof-upload-url')
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  if (!isAllowedProofType(contentType)) throw new UserError('Tipo de archivo no permitido.')

  const storage = resolveStorage(deps.storage)
  if (!storage) throw new UserError('La subida de comprobantes no está disponible.')

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, businessId: true, status: true, paymentMethod: true, remainingBalance: true },
  })
  if (!booking) throw new UserError('Reserva no encontrada')

  // Elegibilidad mínima por kind (el declare re-valida en profundidad).
  if (kind === 'deposit' && booking.paymentMethod !== BANK_TRANSFER_METHOD) {
    throw new UserError('Esta reserva no eligió pago por transferencia')
  }
  if (kind === 'balance' && booking.remainingBalance <= 0) {
    throw new UserError('Esta reserva no tiene saldo pendiente.')
  }

  const key = proofKey(booking.businessId, booking.id, kind)
  const uploadUrl = await storage.presignUpload(key, contentType)
  return { uploadUrl, key }
}

export const createProofUploadUrl = action(_createProofUploadUrl)

// Opciones de comprobante para los declare* y attachProof. TS-only (erased):
// un módulo 'use server' solo puede EXPORTAR funciones async, pero declarar
// tipos a nivel de módulo es válido (no genera un export en runtime).
type DeclareProofOpts = { proofKey?: string; proofContentType?: string; storage?: ProofStorage | null }

/** Valida por HEAD que el objeto existe, pesa ≤ límite y es de tipo permitido.
 *  Devuelve { proofKey, proofContentType } para persistir, o null si no hubo proof.
 *  Hace I/O de red (HEAD) — llamar SIEMPRE ANTES de abrir la $transaction. */
async function validateProof(
  kind: ProofKind,
  businessId: string,
  bookingId: string,
  opts: DeclareProofOpts,
): Promise<{ proofKey: string; proofContentType: string } | null> {
  if (!opts.proofKey) return null
  const expected = proofKey(businessId, bookingId, kind)
  if (opts.proofKey !== expected) throw new UserError('Comprobante inválido.')
  if (!opts.proofContentType || !isAllowedProofType(opts.proofContentType)) {
    throw new UserError('Tipo de comprobante no permitido.')
  }
  const storage = resolveStorage(opts.storage)
  if (!storage) throw new UserError('La subida de comprobantes no está disponible.')
  const meta = await storage.head(opts.proofKey)
  if (!meta) throw new UserError('No encontramos el comprobante subido. Reintentá.')
  if (meta.contentLength > PROOF_MAX_BYTES) throw new UserError('El comprobante supera el tamaño máximo (5 MB).')
  if (meta.contentType && !isAllowedProofType(meta.contentType)) {
    throw new UserError('Tipo de comprobante no permitido.')
  }
  return { proofKey: opts.proofKey, proofContentType: opts.proofContentType }
}

/** Pre-lectura + validación del comprobante compartida por ambos declare*.
 *  Corre FUERA de la $transaction (el HEAD es I/O de red). Aplica el gate
 *  EFECTIVO: si el negocio exige comprobante (con R2 disponible) y no hay uno
 *  válido, corta antes de tocar la reserva. */
async function resolveProofForDeclare(kind: ProofKind, bookingId: string, opts: DeclareProofOpts) {
  const pre = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { businessId: true, business: { select: { requireTransferProof: true } } },
  })
  if (!pre) throw new UserError('Reserva no encontrada')
  const proof = await validateProof(kind, pre.businessId, bookingId, opts)
  if (pre.business.requireTransferProof && !proof) {
    throw new UserError('Este negocio exige adjuntar el comprobante para declarar la transferencia.')
  }
  return proof
}

/**
 * La clienta declara "ya transferí". Idempotente (providerPaymentId
 * determinístico) y con guard de carrera contra el cron expire-holds:
 * solo transiciona una pending_payment con hold vigente.
 */
async function _declareBankTransfer(
  bookingId: string,
  opts: DeclareProofOpts = {},
): Promise<{ ok: true }> {
  const limit = await checkRateLimit('declare-bank-transfer', 10, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const proof = await resolveProofForDeclare('deposit', bookingId, opts)

  const declared = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        business: { include: { bankTransferAccount: true } },
        service: true,
        customer: true,
      },
    })
    if (!booking) throw new UserError('Reserva no encontrada')
    if (booking.paymentMethod !== BANK_TRANSFER_METHOD) {
      throw new UserError('Esta reserva no eligió pago por transferencia')
    }
    const account = booking.business.bankTransferAccount
    if (!account || !account.isEnabled) {
      throw new UserError('Este negocio no tiene transferencia bancaria habilitada')
    }

    // Idempotencia por status del bt-declared existente:
    // - pending  → ya declaró; éxito sin tocar el hold (re-declarar no re-extiende).
    // - approved → ya verificado (alcanzable vía confirmación parcial); jamás tocarlo,
    //              el ledger ya lo contabilizó.
    // - cancelled/rejected → la declaración murió (cron/expiración) y la dueña
    //   reabrió la reserva: REACTIVAR el mismo Payment (el unique impide crear otro).
    // - refunded/failed → hoy inalcanzables para un bt-declared (no hay flujo de
    //   refund/failed sobre pagos manuales); si algún día aparecen, mejor cortar
    //   fuerte que pisar el registro.
    const existing = await tx.payment.findFirst({
      where: { bookingId, provider: 'manual', providerPaymentId: btDeclaredId(bookingId) },
    })
    if (existing && (existing.status === PaymentStatus.pending || existing.status === PaymentStatus.approved)) {
      return null
    }
    if (existing && existing.status !== PaymentStatus.cancelled && existing.status !== PaymentStatus.rejected) {
      throw new UserError('No se puede volver a declarar esta transferencia. Contactá al negocio.')
    }

    // Guard de carrera vs cron (spec §4): solo una pending_payment con hold
    // vigente puede declarar (creación Y reactivación pasan por acá).
    const now = new Date()
    const newHold = account.verifyHours == null ? null : addHours(now, account.verifyHours)
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: 'pending_payment', holdExpiresAt: { gt: now } },
      data: { holdExpiresAt: newHold },
    })
    if (count === 0) {
      // Mensaje según el estado real (una revivida-cancelada/confirmada no "expiró").
      if (booking.status === 'cancelled') throw new UserError('Tu reserva fue cancelada.')
      if (booking.status === 'confirmed') throw new UserError('Tu reserva ya está confirmada.')
      throw new UserError('Tu reserva expiró. Volvé a reservar para elegir un nuevo horario.')
    }

    // Monto server-authoritative, mismo criterio que initiatePayment (payments.ts).
    const amount = Math.min(booking.depositRequired, booking.remainingBalance)
    if (amount <= 0) throw new UserError('Esta reserva no requiere abono')

    if (existing) {
      // Reactivación: mismo Payment, declaración "nueva" — createdAt = now para
      // que el recordatorio-dueña (rama verifyHours=null, 24h desde createdAt)
      // no dispare al instante.
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: PaymentStatus.pending,
          amount,
          createdAt: now,
          proofKey: proof?.proofKey ?? null,
          proofContentType: proof?.proofContentType ?? null,
        },
      })
      return { booking, amount }
    }

    try {
      await tx.payment.create({
        data: {
          businessId: booking.businessId,
          bookingId,
          customerId: booking.customerId,
          provider: PaymentProvider.manual,
          providerPaymentId: btDeclaredId(bookingId),
          amount,
          currency: booking.business.currency || 'CLP',
          status: PaymentStatus.pending,
          paymentType: PaymentType.deposit,
          paymentMethod: 'Transferencia',
          proofKey: proof?.proofKey ?? null,
          proofContentType: proof?.proofContentType ?? null,
        },
      })
    } catch (e) {
      // P2002 = otro request ganó la carrera del create: tratarlo como éxito.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
      throw e
    }
    return { booking, amount }
  })

  if (declared) {
    // Post-tx, best-effort: un fallo de email no debe romper la declaración.
    await sendMultiNotificationSafely('bank transfer declared notification', () =>
      sendBankTransferDeclaredToBusiness(declared.booking.businessId, {
        businessName: declared.booking.business.name,
        businessTimezone: declared.booking.business.timezone,
        customerName: declared.booking.customer.name,
        serviceName: declared.booking.service?.name ?? 'servicio',
        startDateTime: declared.booking.startDateTime,
        amount: declared.amount,
        currency: declared.booking.business.currency || 'CLP',
        bookingNumber: declared.booking.bookingNumber,
        hasProof: !!proof,
      }),
    )
  }

  return { ok: true }
}

export const declareBankTransfer = action(_declareBankTransfer)

/**
 * La clienta declara "ya transferí el SALDO" (feature #3). Reserva firme
 * (confirmed|completed), sin hold ni plazo. Idempotente por btBalanceId.
 */
async function _declareBalanceTransfer(
  bookingId: string,
  opts: DeclareProofOpts = {},
): Promise<{ ok: true }> {
  const limit = await checkRateLimit('declare-balance-transfer', 10, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const proof = await resolveProofForDeclare('balance', bookingId, opts)

  const declared = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        business: { include: { bankTransferAccount: true } },
        service: true,
        customer: true,
      },
    })
    if (!booking) throw new UserError('Reserva no encontrada')
    const account = booking.business.bankTransferAccount
    if (!account || !account.isEnabled) {
      throw new UserError('Este negocio no tiene transferencia bancaria habilitada')
    }
    if (booking.status === 'pending_payment') {
      throw new UserError('Primero confirmá tu reserva pagando el abono.')
    }
    if (booking.status === 'expired') {
      throw new UserError('Tu reserva expiró. Volvé a reservar para elegir un nuevo horario.')
    }
    if (booking.status === 'cancelled') throw new UserError('Tu reserva fue cancelada.')
    if (booking.status === 'no_show') {
      throw new UserError('Esta reserva quedó como no asistida: escribile al negocio.')
    }

    // Idempotencia por status del bt-balance existente (spec §3.5):
    // - pending → ya avisó.
    // - approved con saldo 0 → ya verificado, jamás tocar.
    // - approved con saldo RESIDUAL (verificación parcial) → ERROR explícito:
    //   el unique impide un segundo bt-balance; un éxito silencioso sería un
    //   botón muerto para siempre.
    // - cancelled/rejected → reactivar el mismo Payment.
    // - refunded/failed → cortar fuerte.
    const existing = await tx.payment.findFirst({
      where: { bookingId, provider: 'manual', providerPaymentId: btBalanceId(bookingId) },
    })
    if (existing?.status === PaymentStatus.pending) return null
    if (existing?.status === PaymentStatus.approved) {
      if (booking.remainingBalance <= 0) return null
      throw new UserError(
        'Tu transferencia anterior fue registrada parcialmente. Escribile al negocio para coordinar el resto.',
      )
    }
    if (existing && existing.status !== PaymentStatus.cancelled && existing.status !== PaymentStatus.rejected) {
      throw new UserError('No se puede volver a declarar esta transferencia. Contactá al negocio.')
    }

    if (booking.remainingBalance <= 0) throw new UserError('Esta reserva no tiene saldo pendiente.')

    // Guard de carrera REAL vs cancel/no_show concurrente (spec §3.6): el
    // updateMany toma el row lock de la booking y serializa contra
    // cancelBookingInTx/updateBookingStatus. Releer el status no alcanza bajo
    // ReadCommitted. El write es benigno (touch de updatedAt).
    const { count } = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: [...FIRM_BOOKING_STATUSES] } },
      data: { updatedAt: new Date() },
    })
    if (count === 0) throw new UserError('Tu reserva ya no admite este pago. Escribile al negocio.')

    const amount = booking.remainingBalance
    const paymentType = deriveManualPaymentType(booking, amount)

    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: PaymentStatus.pending,
          amount,
          paymentType,
          createdAt: new Date(),
          proofKey: proof?.proofKey ?? null,
          proofContentType: proof?.proofContentType ?? null,
        },
      })
      return { booking, amount }
    }

    try {
      await tx.payment.create({
        data: {
          businessId: booking.businessId,
          bookingId,
          customerId: booking.customerId,
          provider: PaymentProvider.manual,
          providerPaymentId: btBalanceId(bookingId),
          amount,
          currency: booking.business.currency || 'CLP',
          status: PaymentStatus.pending,
          paymentType,
          paymentMethod: 'Transferencia',
          proofKey: proof?.proofKey ?? null,
          proofContentType: proof?.proofContentType ?? null,
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null
      throw e
    }
    return { booking, amount }
  })

  if (declared) {
    await sendMultiNotificationSafely('balance transfer declared notification', () =>
      sendBalanceTransferDeclaredToBusiness(declared.booking.businessId, {
        businessName: declared.booking.business.name,
        businessTimezone: declared.booking.business.timezone,
        customerName: declared.booking.customer.name,
        serviceName: declared.booking.service?.name ?? 'servicio',
        startDateTime: declared.booking.startDateTime,
        amount: declared.amount,
        currency: declared.booking.business.currency || 'CLP',
        bookingNumber: declared.booking.bookingNumber,
        hasProof: !!proof,
      }),
    )
    revalidatePath('/dashboard')
    revalidatePath('/dashboard/bookings')
    revalidatePath('/dashboard/payments')
  }
  return { ok: true }
}

export const declareBalanceTransfer = action(_declareBalanceTransfer)

/** Adjunta/reemplaza el comprobante de un Payment declarado (pending), sin
 *  re-declarar. Público: identidad = bookingId (cuid) + rate limit. El HEAD
 *  vuelve a validar existencia + tamaño + tipo (server-authoritative). */
async function _attachProof(
  bookingId: string,
  kind: ProofKind,
  opts: DeclareProofOpts,
): Promise<{ ok: true }> {
  const limit = await checkRateLimit('proof-upload-url')
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { businessId: true },
  })
  if (!booking) throw new UserError('Reserva no encontrada')

  const proof = await validateProof(kind, booking.businessId, bookingId, opts)
  if (!proof) throw new UserError('Falta el comprobante.')

  const providerPaymentId = kind === 'balance' ? btBalanceId(bookingId) : btDeclaredId(bookingId)
  const { count } = await prisma.payment.updateMany({
    where: { bookingId, provider: 'manual', providerPaymentId, status: 'pending' },
    data: { proofKey: proof.proofKey, proofContentType: proof.proofContentType },
  })
  if (count === 0) {
    throw new UserError('No hay una transferencia declarada pendiente para adjuntar el comprobante.')
  }
  return { ok: true }
}

export const attachProof = action(_attachProof)
