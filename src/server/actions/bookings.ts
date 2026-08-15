'use server'

import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { Booking, Prisma } from '@prisma/client'
import { BookingStatus, BookingPaymentStatus, PaymentType, ServiceModality } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { getConfirmedSessionUser } from '@/lib/auth/user'
import { findOrCreateCustomerInTx } from '@/lib/customers/find-or-create'
import { logger } from '@/lib/logger'

import { SLOT_UNAVAILABLE_MESSAGE } from '@/lib/availability/validation'
import { activeProfessionalWhere, assertProfessionalOffersService, PROFESSIONAL_UNAVAILABLE_MESSAGE } from '@/lib/professionals/ownership'
import { assertSlotAndResolveProfessional } from '@/lib/professionals/assign'
import { NO_PROFESSIONAL, professionalEligibilityWhere, type ProfessionalPick } from '@/lib/professionals/eligible'
import { isNoOverlapViolation } from '@/lib/db/no-overlap'
import { assignBookingNumber } from '@/lib/bookings/number'
import { assertBusinessCanReceiveBookings } from '@/lib/subscriptions/enforcement'
import { normalizePhone } from '@/lib/customers/phone'
import { isValidBirthDateString, birthDateToUtcDate } from '@/lib/dates'
import { addDays, addMinutes, format } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { recomputeBookingAmountsAfterDiscount } from '@/lib/bookings/recompute'
import { assertBookingPayable } from '@/lib/bookings/payments'
import { applyApprovedPayment } from '@/server/services/finance'
import { firePaymentNotConfirmedNotification } from '@/lib/bookings/notify-payment-not-confirmed'
import { initialPublicBookingStatus, calculateApprovalExpiresAt } from '@/lib/bookings/approval'
import { DEFAULT_HOLD_MINUTES, DASHBOARD_HOLD_MINUTES, MANUAL_COORDINATION_METHOD } from '@/lib/bookings/hold'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { resumeBookingForRetry } from '@/lib/bookings/retry'
import { releaseRedemptionForBooking } from '@/lib/promotions/release'
import { cancelBookingInTx, reassignBookingInTx, rescheduleBookingInTx } from '@/lib/bookings/mutate'
import { isTerminalBookingStatus } from '@/lib/bookings/status-labels'
import { getVocabulary } from '@/lib/vocabulary'
import { creditVisitPoints } from '@/lib/loyalty/credit'
import { emitAutomaticRewardsOnCompletion } from '@/lib/loyalty/on-booking-completed'
import { captureReferral } from '@/lib/loyalty/referral'
import { type BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
import { BANK_TRANSFER_METHOD, anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'
import { holdPrecedencePaymentWhere } from '@/lib/payments/hold-precedence'
import { fireBookingNotifications } from '@/lib/bookings/notifications'
import { resolveBookingDraft } from '@/lib/bookings/draft'
import { issuePushGrant } from '@/lib/push/grant'
import { isPushBookingEligible } from '@/lib/push/eligibility'
import { cancellationPolicyRevision } from '@/lib/bookings/cancellation-policy-revision'
import { applyBookingDiscountInTx } from '@/lib/bookings/discount'
import { loadBookingInvite, loadBookingCancelNotice } from '@/lib/calendar/booking-invite'
import {
  sendBookingCancelledNotification,
  sendBookingConfirmedNotification,
  sendBookingRescheduledNotification,
  sendNotificationSafely,
  getBusinessReplyToEmail,
} from '@/lib/notifications'

// Lo que pide TODA salida que devuelve una reserva con sus nombres (las cuatro
// de createBooking y las dos del camino del dashboard). Constante y no literal
// repetido: sin la relación en UNA salida, la persona desaparece de la
// respuesta sin error de compilación — pasó con las salidas de paquete/código.
const BOOKING_RESULT_INCLUDE = { service: true, customer: true, professional: { select: { name: true } } } as const

type LockedCancellationPolicy = {
  selfServiceCutoffHours: number
  cancellationPolicy: string | null
  cancellationReminderEnabled: boolean
}

async function lockCancellationPolicy(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<LockedCancellationPolicy> {
  const rows = await tx.$queryRaw<LockedCancellationPolicy[]>`
    SELECT "selfServiceCutoffHours", "cancellationPolicy", "cancellationReminderEnabled"
    FROM "Business"
    WHERE "id" = ${businessId}
    FOR UPDATE
  `
  const policy = rows[0]
  if (!policy) throw new UserError('Negocio no válido')
  return policy
}

function withPushActivation<T extends {
  id: string
  customer: { id: string; userId?: string | null }
  startDateTime: Date
  status: BookingStatus
  cancellationCutoffHours: number | null
  depositRequired: number
  depositPaid: number
}>(
  booking: T,
  business: { id: string; cancellationReminderEnabled: boolean; selfServiceCutoffHours: number },
  sessionUser: { id: string } | null,
) {
  const eligible = isPushBookingEligible(booking, business, new Date())
  const pushMode = !eligible
    ? null
    : sessionUser === null
      ? 'guest' as const
      : booking.customer.userId === sessionUser.id
        ? 'account' as const
        : null
  const pushGrant = pushMode === 'guest'
    ? issuePushGrant({
        bookingId: booking.id,
        customerId: booking.customer.id,
        businessId: business.id,
      })
    : null

  return {
    ...booking,
    pushMode,
    pushGrant,
  }
}

// La forma con la que un ProfessionalPick cruza el borde, compartida entre los
// dos formularios que crean reservas (el público y el del panel): más estricta
// que `parseProfessionalPick` a propósito — lo que viene malformado se rechaza
// en vez de degradar a "sin persona".
const professionalPickSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('anyone') }),
  z.object({ kind: z.literal('person'), id: z.string().min(1).max(64) }),
])

const createBookingSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerBirthDate: z.string().optional().or(z.literal(''))
    .refine((v) => !v || isValidBirthDateString(v), 'Fecha de cumpleaños inválida'),
  startDateTime: z.date(),
  idempotencyKey: z.string().min(1).max(64).optional(),
  acceptedTerms: z.boolean(),
  cancellationPolicyRevision: z.string().min(1).max(128).optional(),
  promotionCode: z.string().trim().max(40).optional(),
  skipPackage: z.boolean().optional(),
  paymentMethod: z.enum(['bank_transfer']).optional(),
  // Elección de la clienta; el server la re-deriva contra las modalidades reales
  // del servicio (resolveBookingModality) antes de persistirla.
  modality: z.nativeEnum(ServiceModality).optional(),
  serviceAddress: z.string().trim().max(300, 'La dirección es demasiado larga').optional(),
  // Con quién se atiende. Ausente = sin persona, que es el funnel de siempre.
  // La procedencia se verifica abajo, con la modalidad ya resuelta; a quién le
  // toca en `anyone` lo decide el servidor adentro de la tx.
  professional: professionalPickSchema.optional(),
})

const confirmPaymentSchema = z.object({
  bookingId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().positive(),
})

const VALID_STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ['confirmed', 'cancelled', 'expired'],
  // Aceptar una solicitud = confirmarla. Rechazarla = cancelarla (con motivo,
  // vía cancelBooking). 'expired' lo pone el cron cuando nadie responde a tiempo.
  pending_confirmation: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
  // expired es terminal PARA ESTE PATH: la única salida es reviveBooking
  // (revive-booking.ts), que re-valida cupo antes de transicionar.
  expired: [],
}

const BOOKING_LIST_SELECT = {
      id: true,
      bookingNumber: true,
      startDateTime: true,
      status: true,
      depositPaid: true,
      depositRequired: true,
      finalAmount: true,
      paymentStatus: true,
      totalPrice: true,
      remainingBalance: true,
      paymentMethod: true,
      // El plazo decide QUÉ estado mostrar y si se puede cobrar: con el hold
      // vencido la reserva ya está condenada aunque el cron todavía no la haya
      // asentado (ver `effectiveBookingStatus` / `isManualPaymentAllowed`).
      holdExpiresAt: true,
      modality: true,
      serviceAddress: true,
      meetingUrl: true,
      service: { select: { name: true } },
      // Quién atiende: la tabla y la card lo muestran junto al servicio. null =
      // sin persona asignada (negocio sin equipo o reserva anterior al track 5).
      professional: { select: { name: true } },
      customer: { select: { name: true, phone: true, email: true } },
      // Pagos que ganan visualmente sobre un hold vencido: transferencia
      // declarada o Mercado Pago en vuelo. Las transferencias siguen
      // alimentando su sección sin una segunda query; el llamador filtra por
      // sus prefijos antes de construir los items.
      payments: {
        where: holdPrecedencePaymentWhere,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          provider: true,
          status: true,
          providerPaymentId: true,
          proofKey: true,
          proofContentType: true,
        },
      },
} satisfies Prisma.BookingSelect

export type BookingListItem = Prisma.BookingGetPayload<{ select: typeof BOOKING_LIST_SELECT }>

export type BookingPage = {
  items: BookingListItem[]
  nextCursor: string | null
}

const MAX_BOOKINGS_PAGE_SIZE = 100
const DEFAULT_BOOKINGS_PAGE_SIZE = 50

function bookingPageSize(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_BOOKINGS_PAGE_SIZE
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_BOOKINGS_PAGE_SIZE), 1), MAX_BOOKINGS_PAGE_SIZE)
}

async function getBookingPageForWhere({
  businessId,
  where,
  cursor,
  limit,
  orderBy,
}: {
  businessId: string
  where: Prisma.BookingWhereInput
  cursor?: string
  limit?: number
  orderBy: Prisma.BookingOrderByWithRelationInput[]
}): Promise<BookingPage> {
  const take = bookingPageSize(limit)

  if (cursor) {
    const ownedCursor = await prisma.booking.findFirst({
      where: { ...where, id: cursor, businessId },
      select: { id: true },
    })
    if (!ownedCursor) return { items: [], nextCursor: null }
  }

  const rows = await prisma.booking.findMany({
    where,
    orderBy,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
    select: BOOKING_LIST_SELECT,
  })
  const hasNextPage = rows.length > take
  const items = hasNextPage ? rows.slice(0, take) : rows

  return {
    items,
    nextCursor: hasNextPage ? items.at(-1)?.id ?? null : null,
  }
}

/**
 * Página estable del historial que consume la UI. El cursor se valida dentro
 * del tenant antes de entregárselo a Prisma: un ID válido de otro negocio no
 * filtra, salta ni revela ninguna fila de este negocio.
 */
export async function getBookingsPage({
  cursor,
  limit,
  bookingNumber,
}: {
  cursor?: string
  limit?: number
  bookingNumber?: number
} = {}): Promise<BookingPage> {
  const { businessId } = await requireBusiness()
  return getBookingPageForWhere({
    businessId,
    where: { businessId, ...(bookingNumber !== undefined ? { bookingNumber } : {}) },
    cursor,
    limit,
    orderBy: [{ startDateTime: 'desc' }, { id: 'desc' }],
  })
}

/**
 * Contadores de la cabecera de Reservas. Mantenerlos agregados evita que la
 * primera página de 50 filas cambie el significado de "Total" o que el
 * dashboard vuelva a descargar todo el historial sólo para contar.
 */
export async function getBookingListStats(now: Date): Promise<{
  total: number
  confirmed: number
  pendingPayment: number
  pendingConfirmation: number
}> {
  const { businessId } = await requireBusiness()
  const baseWhere = { businessId }
  const [total, confirmed, pendingPayment, pendingConfirmation] = await Promise.all([
    prisma.booking.count({ where: baseWhere }),
    prisma.booking.count({ where: { ...baseWhere, status: 'confirmed' } }),
    prisma.booking.count({
      where: {
        ...baseWhere,
        status: 'pending_payment',
        // El badge sigue siendo "Pendiente" si hay una transferencia declarada
        // o un MP en vuelo, aun cuando el hold ya venció.
        OR: [
          { holdExpiresAt: null },
          // `isExpiredPaymentHold` vence estrictamente después de este instante
          // (`holdExpiresAt < now`); en el límite exacto la fila sigue pendiente.
          { holdExpiresAt: { gte: now } },
          // Un abono registrado preserva la reserva aunque el hold ya haya
          // pasado; la tabla la sigue mostrando como pendiente de cobro.
          { paymentStatus: { not: 'unpaid' } },
          { payments: { some: holdPrecedencePaymentWhere } },
        ],
      },
    }),
    prisma.booking.count({ where: { ...baseWhere, status: 'pending_confirmation' } }),
  ])

  return { total, confirmed, pendingPayment, pendingConfirmation }
}

/** Cola operativa separada del historial: sólo reservas con una transferencia
 * declarada que todavía requiere decisión humana. */
export async function getPendingBookingTransfersPage({
  cursor,
  limit,
}: {
  cursor?: string
  limit?: number
} = {}): Promise<BookingPage> {
  const { businessId } = await requireBusiness()
  const where: Prisma.BookingWhereInput = {
    businessId,
    status: { notIn: ['cancelled', 'expired'] },
    payments: { some: anyDeclaredTransferWhere },
  }
  return getBookingPageForWhere({
    businessId,
    where,
    cursor,
    limit,
    orderBy: [{ startDateTime: 'asc' }, { id: 'asc' }],
  })
}

/** Lista de trabajo del selector de cobro manual. Las reservas cerradas o con
 * saldo cero nunca pueden elegirse, así que traerlas era sólo peso de HTML y
 * JavaScript en Pagos. */
export async function getManualPaymentBookings(): Promise<BookingListItem[]> {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: {
      businessId,
      remainingBalance: { gt: 0 },
      status: { in: ['pending_payment', 'confirmed', 'completed'] },
    },
    orderBy: [{ startDateTime: 'desc' }, { id: 'desc' }],
    take: DEFAULT_BOOKINGS_PAGE_SIZE,
    select: BOOKING_LIST_SELECT,
  })
}

/** Búsqueda acotada del selector de cobro manual. La página inicial trae sólo
 * 50 opciones; este camino permite encontrar cualquier saldo elegible sin
 * descargar el historial completo al abrir Pagos. */
export async function searchManualPaymentBookings(query: string): Promise<BookingListItem[]> {
  const { businessId } = await requireBusiness()
  const term = query.trim().slice(0, 100)
  const manualPaymentWhere: Prisma.BookingWhereInput = {
    businessId,
    remainingBalance: { gt: 0 },
    status: { in: ['pending_payment', 'confirmed', 'completed'] },
  }

  return prisma.booking.findMany({
    where: term
      ? {
          ...manualPaymentWhere,
          OR: [
            { customer: { is: { name: { contains: term, mode: 'insensitive' } } } },
            { customer: { is: { phone: { contains: term, mode: 'insensitive' } } } },
          ],
        }
      : manualPaymentWhere,
    orderBy: [{ startDateTime: 'desc' }, { id: 'desc' }],
    take: 25,
    select: BOOKING_LIST_SELECT,
  })
}

// Compatibilidad temporal para acciones server-side y tests históricos. Ninguna
// ruta de dashboard debe llamarla: la UI usa getBookingsPage para no cargar todo
// el historial por render.
export async function getBookings() {
  const { businessId } = await requireBusiness()
  return prisma.booking.findMany({
    where: { businessId },
    orderBy: [{ startDateTime: 'desc' }, { id: 'desc' }],
    select: BOOKING_LIST_SELECT,
  })
}

// Resumen liviano para el home del dashboard: los conteos se calculan en la
// base y sólo se cargan las 5 próximas citas. Evita
// arrastrar las columnas de plata y las relaciones completas en la landing más
// caliente. Mismo where/orderBy que getBookings → mismo orden y conjunto.
export async function getDashboardBookingSummary(now: Date, timezone: string) {
  const { businessId } = await requireBusiness()
  const localNow = toZonedTime(now, timezone)
  const todayStart = fromZonedTime(`${format(localNow, 'yyyy-MM-dd')}T00:00:00`, timezone)
  const tomorrowStart = fromZonedTime(`${format(addDays(localNow, 1), 'yyyy-MM-dd')}T00:00:00`, timezone)
  const activeBookingStatuses = [BookingStatus.cancelled, BookingStatus.no_show, BookingStatus.expired]

  const [total, today, pendingTransfers, upcoming] = await Promise.all([
    prisma.booking.count({ where: { businessId } }),
    prisma.booking.count({
      where: { businessId, startDateTime: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.booking.count({
      where: {
        businessId,
        status: { notIn: activeBookingStatuses },
        payments: { some: anyDeclaredTransferWhere },
      },
    }),
    prisma.booking.findMany({
      where: {
        businessId,
        startDateTime: { gte: todayStart },
        status: { notIn: activeBookingStatuses },
      },
      orderBy: [{ startDateTime: 'asc' }, { id: 'asc' }],
      take: 5,
      select: {
        id: true,
        startDateTime: true,
        status: true,
        service: { select: { name: true } },
        customer: { select: { name: true } },
        payments: {
          where: anyDeclaredTransferWhere,
          select: { provider: true, status: true, providerPaymentId: true },
        },
      },
    }),
  ])

  return { total, today, pendingTransfers, upcoming }
}

async function _createBooking(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  customerBirthDate?: string
  startDateTime: Date
  idempotencyKey?: string
  acceptedTerms: boolean
  cancellationPolicyRevision?: string
  promotionCode?: string
  skipPackage?: boolean
  referralToken?: string
  paymentMethod?: typeof BANK_TRANSFER_METHOD
  modality?: ServiceModality
  serviceAddress?: string
  professional?: ProfessionalPick
}, businessId: string) {
  const limit = await checkRateLimit('create-booking', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createBookingSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos de reserva inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  if (parsed.data.acceptedTerms !== true) {
    throw new UserError('Debes aceptar los términos y condiciones y la política de cancelación')
  }

  // Validar que el negocio exista, esté activo y pueda recibir reservas
  const business = await prisma.business.findUnique({
    where: { id: businessId, isActive: true },
    select: {
      id: true,
      timezone: true,
      name: true,
      whatsapp: true,
      addressText: true,
      currency: true,
      selfServiceCutoffHours: true,
      cancellationPolicy: true,
      slug: true,
      subdomain: true,
      category: true,
      requireBookingApproval: true,
      defaultMeetingUrl: true,
      subscriptionStatus: true,
      manualHoldHours: true,
      cancellationReminderEnabled: true,
    },
  })
  if (!business) {
    throw new UserError('Negocio no válido')
  }

  assertBusinessCanReceiveBookings(business.subscriptionStatus)

  // Servicio, modalidad y montos: todo server-side, nada del payload.
  const { service, modality, serviceAddress, meetingUrl, totalPrice, depositRequired, finalAmount, endDateTime } =
    await resolveBookingDraft({
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      modality: data.modality,
      serviceAddress: data.serviceAddress,
      defaultMeetingUrl: business.defaultMeetingUrl,
    })

  // Con quién. Va DESPUÉS del draft porque se valida contra la modalidad RESUELTA
  // (el servidor pisa la pedida cuando el servicio tiene una sola), y afuera de la
  // transacción porque es una lectura que el lock no protege: quien se dé de baja
  // entre este chequeo y el insert deja una reserva a su nombre, igual que las que
  // ya tenía agendadas.
  //
  // Sólo la elección explícita se autoriza acá. "Cualquiera disponible" no tiene nada
  // que autorizar todavía —la persona no existe hasta que la transacción la elija— y
  // su equivalente corre allá adentro (`assertSlotAndResolveProfessional`), que arma
  // la lista de candidatos con este mismo filtro de elegibilidad.
  const professional = data.professional ?? NO_PROFESSIONAL
  if (professional.kind === 'person') {
    await assertProfessionalOffersService(prisma, businessId, professional.id, data.serviceId, modality)
  }

  // Transferencia bancaria: validar server-side que esté habilitada. El hold
  // largo (holdHours, default 24h) da la ventana para transferir y declarar
  // (spec transferencia §5.2). Solo aplica si el servicio requiere abono.
  // Se leen los campos públicos completos porque el email de reserva recibida
  // los reusa (se pasan a fireBookingNotifications sin re-consultar).
  let bankTransferAccount: BankTransferPublicInfo | null = null
  if (data.paymentMethod === BANK_TRANSFER_METHOD) {
    bankTransferAccount = await getBankTransferInfo(businessId)
    if (!bankTransferAccount) {
      throw new UserError('Este negocio no tiene transferencia bancaria habilitada')
    }
  }

  // Vía 3 de vinculación (leer sesión ANTES de la tx: toca Supabase/cookies).
  // Remoto (getUser) porque el link exige el email_confirmed_at confiable.
  //
  // En paralelo va la disponibilidad de pago online, que sólo hace falta en la
  // rama abono-sin-transferencia: en serie le sumaba un round-trip de DB al
  // camino MP mayoritario sólo para confirmar el default de 15 minutos.
  const [sessionUser, onlineAvailability] = await Promise.all([
    getConfirmedSessionUser(),
    depositRequired > 0 && !bankTransferAccount
      ? resolveOnlinePaymentAvailabilityForBusiness(businessId)
      : Promise.resolve(null),
  ])

  // Cuánto vive el hold y cómo queda marcada la reserva — UNA decisión de tres
  // vías, para que el plazo y el marcador no puedan divergir. Se calcula acá
  // arriba porque el hold lo usan los dos caminos: la creación y el reintento
  // que lo renueva.
  //
  // Coordinación manual: con abono requerido pero sin checkout online NI
  // transferencia, la clienta no puede pagar dentro de la ventana del funnel —
  // la pantalla le promete "el negocio te contacta", así que el hold dura la
  // ventana que configuró la dueña (manualHoldHours), no los 15 minutos de un
  // checkout abierto. La decisión es del servidor (resolve...ForBusiness), no
  // del navegador: el mismo criterio que decide qué pantalla ve la clienta.
  let holdMinutes = DEFAULT_HOLD_MINUTES
  let metodoDePago: string | null = null
  if (bankTransferAccount && depositRequired > 0) {
    holdMinutes = bankTransferAccount.holdHours * 60
    metodoDePago = BANK_TRANSFER_METHOD
  } else if (onlineAvailability && !onlineAvailability.available) {
    holdMinutes = business.manualHoldHours * 60
    metodoDePago = MANUAL_COORDINATION_METHOD
  }

  // Las dos puertas a "esta key ya se usó" —el fast path de acá abajo y el P2002
  // del catch— pasan por el mismo resume con este contexto.
  const retryCtx = {
    serviceId: data.serviceId,
    startDateTime: data.startDateTime,
    professional,
    promotionCode: data.promotionCode,
    timezone: business.timezone || 'America/Santiago',
    holdMinutes,
  }

  // Idempotencia: si llega key, buscar booking existente fuera de tx (fast path).
  // El race final se maneja con el unique constraint de DB dentro de la tx.
  if (data.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey: data.idempotencyKey,
        },
      },
      include: BOOKING_RESULT_INCLUDE,
    })
    // `null` = la reserva guardada ya no está en pie y el resume le soltó la key:
    // seguimos al camino de creación normal, que ahora la puede volver a usar.
    if (existing) {
      const resumida = await resumeBookingForRetry(existing, retryCtx)
      if (resumida) return withPushActivation(resumida, business, sessionUser)
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Linealiza la aceptación con Settings y con el contador de reservas. El
      // lock exclusivo evita un upgrade SHARE -> UPDATE (bookingNumberSeq), que
      // podría deadlockear con otra creación. El fast path idempotente ya salió.
      const lockedPolicy = await lockCancellationPolicy(tx, businessId)
      const currentPolicyRevision = cancellationPolicyRevision({
        businessId,
        cutoffHours: lockedPolicy.selfServiceCutoffHours,
        additionalPolicy: lockedPolicy.cancellationPolicy,
      })
      if (parsed.data.cancellationPolicyRevision !== currentPolicyRevision) {
        throw new UserError('La política de cancelación se actualizó. Recargá la página y revisala antes de reservar.')
      }

      // Validación transaccional de disponibilidad con lock, y de paso quién atiende:
      // con una persona elegida el chequeo mira SU horario, SUS bloqueos (más los del
      // negocio) y las citas que le tapan la hora; con "cualquiera disponible" prueba
      // a los candidatos en orden de carga y devuelve al primero que da libre.
      // `null` = sin persona, que valida contra el horario del negocio y choca contra
      // todas.
      const professionalId = await assertSlotAndResolveProfessional({
        tx,
        businessId,
        serviceId: data.serviceId,
        startDateTime: data.startDateTime,
        endDateTime,
        timezone: business.timezone || 'America/Santiago',
        professional,
        modality,
      })

      // Buscar o crear cliente dentro de la transacción (matcher único por
      // teléfono; el link de sesión — vía 3 — vive en el helper).
      const { customer, created } = await findOrCreateCustomerInTx(tx, {
        businessId,
        phone: data.customerPhone,
        name: data.customerName,
        email: data.customerEmail || null,
        birthDate: birthDateToUtcDate(data.customerBirthDate),
        sessionUser,
      })

      // Atribución de referida: SOLO clientas nuevas (recién creadas).
      if (created && data.referralToken) {
        await captureReferral(tx, {
          businessId,
          referredCustomerId: customer.id,
          referrerToken: data.referralToken,
          referredPhone: normalizePhone(data.customerPhone),
        })
      }

      const isFreeService = finalAmount <= 0

      const status = initialPublicBookingStatus({
        depositRequired,
        requireBookingApproval: business.requireBookingApproval,
      })
      const holdExpiresAt =
        status === BookingStatus.pending_payment ? addMinutes(new Date(), holdMinutes) : null
      const approvalExpiresAt =
        status === BookingStatus.pending_confirmation ? calculateApprovalExpiresAt(data.startDateTime) : null
      const bookingPaymentStatus = isFreeService ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid

      const bookingNumber = await assignBookingNumber(tx, businessId)

      const booking = await tx.booking.create({
        data: {
          businessId,
          serviceId: data.serviceId,
          customerId: customer.id,
          professionalId,
          startDateTime: data.startDateTime,
          endDateTime,
          status,
          totalPrice,
          depositRequired,
          depositPaid: 0,
          remainingBalance: finalAmount,
          finalAmount,
          paymentStatus: bookingPaymentStatus,
          modality,
          serviceAddress,
          meetingUrl,
          holdExpiresAt,
          approvalExpiresAt,
          cancellationCutoffHours: lockedPolicy.selfServiceCutoffHours,
          cancellationPolicySnapshot: lockedPolicy.cancellationPolicy,
          paymentMethod: metodoDePago,
          idempotencyKey: data.idempotencyKey || null,
          bookingNumber,
        },
        include: {
          service: true,
          customer: true,
          // El nombre vuelve al navegador porque con "Cualquiera disponible" la
          // clienta no sabe a quién le tocó hasta que se lo decimos, y el estado del
          // wizard no lo puede saber: lo eligió el servidor recién acá adentro.
          professional: { select: { name: true } },
        },
      })

      // Paquete o código, dentro de la misma tx: un código inválido/agotado lanza y
      // hace rollback de todo (booking + canje + incremento), no se crea la reserva.
      const discount = await applyBookingDiscountInTx(tx, {
        businessId,
        customerId: customer.id,
        serviceId: data.serviceId,
        bookingId: booking.id,
        totalPrice,
        promotionCode: parsed.data.promotionCode,
        skipPackage: data.skipPackage,
        source: 'public_booking',
      })

      if (!discount) return { booking, lockedPolicy }

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: recomputeBookingAmountsAfterDiscount({
          price: service.price, depositAmount: service.depositAmount, discountAmount: discount.discountAmount,
          // Sin esto, una reserva-transferencia con promo perdería su ventana
          // de 24h: recompute re-derivaba el hold a +15min incondicionalmente.
          holdMinutes,
          approval: {
            requireBookingApproval: business.requireBookingApproval,
            startDateTime: data.startDateTime,
          },
        }),
        // Con la persona, como el `create` de arriba: sin esto, aplicar un paquete o
        // un código deja la reserva sin `professional` en la respuesta y la
        // confirmación se queda sin poder decir quién atiende — justo en el camino
        // más común, porque el paquete se usa por default cuando la clienta tiene.
        include: BOOKING_RESULT_INCLUDE,
      })
      return { booking: updated, lockedPolicy }
      // 15s: la tx hace lock de slot + upsert de cliente + creación de reserva +
      // aplicación de promo + update; el default de 5s queda corto cuando se aplica
      // un código (varias queries extra) o si la latencia a la DB es alta.
    }, { timeout: 15_000 })
    const { booking, lockedPolicy } = created

    const bookingForNotification = booking as Booking & {
      service: { name: string }
      customer: { name: string; phone: string; email: string | null }
      professional: { name: string } | null
    }

    await fireBookingNotifications(business, bookingForNotification, service.name, bankTransferAccount)

    logger.booking.created(booking.id, businessId, booking.customer?.email ?? undefined)

    revalidatePath('/dashboard/bookings')
    await revalidateBusinessPublicPaths(businessId)
    return withPushActivation(booking, {
      ...business,
      selfServiceCutoffHours: lockedPolicy.selfServiceCutoffHours,
      cancellationReminderEnabled: lockedPolicy.cancellationReminderEnabled,
    }, sessionUser)
  } catch (e: unknown) {
    // Race: otro request creó la misma idempotencyKey entre el findUnique y el create.
    // El unique constraint de DB lo detecta y devolvemos la reserva existente — por
    // el MISMO resume que el fast path, no pelada: la reserva que ganó la carrera
    // recién nació, pero nada garantiza que sea del horario que este request pidió
    // (dos envíos concurrentes con la misma key y distinto horario caen acá).
    const prismaError = e as { code?: string; meta?: { target?: string[] } }
    if (
      prismaError.code === 'P2002' &&
      data.idempotencyKey &&
      Array.isArray(prismaError.meta?.target) &&
      prismaError.meta.target.includes('businessId_idempotencyKey')
    ) {
      const existing = await prisma.booking.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: data.idempotencyKey,
          },
        },
        // Con la persona, por el mismo motivo que las otras dos lecturas de esta
        // key: lo que se devuelve acá es lo que va a leer la confirmación.
        include: BOOKING_RESULT_INCLUDE,
      })
      // Acá `null` no debería pasar: la reserva que ganó la carrera nació hace
      // milisegundos. Si pasara, cae al manejo de error de abajo con el P2002.
      if (existing) {
        const resumida = await resumeBookingForRetry(existing, retryCtx)
        if (resumida) return withPushActivation(resumida, business, sessionUser)
      }
    }
    // Safe error handling: log internal error, return generic message
    const msg = e instanceof Error ? e.message : String(e)
    // El EXCLUDE Booking_no_overlap rechazó el insert: alguien se quedó con el
    // horario en el medio, o quedó tapado por una reserva que el chequeo de solape
    // no puede liberar. Sin este caso el rechazo cae en el `throw e` de abajo (no
    // trae `.code`) y la clienta lee "Ocurrió un error inesperado" sobre un horario
    // que la pantalla le sigue ofreciendo.
    if (isNoOverlapViolation(e)) {
      logger.error('booking.error', `Booking_no_overlap rejected createBooking: ${msg}`, {
        businessId,
        metadata: { error: msg },
      })
      throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
    }
    if (prismaError.code?.startsWith('P')) {
      logger.error('booking.error', `Database error in createBooking: ${msg}`, {
        businessId,
        metadata: { error: msg },
      })
      throw new UserError('Error de base de datos. Por favor intenta nuevamente.')
    }
    throw e
  }
}

export const createBooking = action(_createBooking)

async function _updateBookingStatus(id: string, status: BookingStatus) {
  const { businessId } = await requireBusiness()
  const limit = await checkRateLimit('update-booking-status', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.booking.findFirst({
    where: { id, businessId },
    include: {
      customer: { select: { name: true, email: true } },
      service: { select: { name: true } },
      business: { select: { name: true, timezone: true } },
    },
  })
  if (!existing) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (!VALID_STATUS_TRANSITIONS[existing.status].includes(status)) {
    throw new ForbiddenError(`No se puede cambiar el estado de ${existing.status} a ${status}`)
  }

  // Al completar, generamos el token de reseña de inmediato para que el link
  // esté listo en el momento adecuado (sin un paso manual extra después).
  const completing = status === BookingStatus.completed && !existing.reviewToken
  const reviewTokenData = completing
    ? { reviewToken: crypto.randomUUID(), reviewTokenCreatedAt: new Date() }
    : {}

  // Aceptar una solicitud: la fecha límite para responder ya no aplica. Sin
  // limpiarla, el sweep no la toca (filtra por status) pero la reserva queda con
  // una fecha muerta que confunde al leerla.
  const approving =
    existing.status === BookingStatus.pending_confirmation && status === BookingStatus.confirmed
  const approvalData = approving ? { approvalExpiresAt: null } : {}

  // Config de fidelización (puede ser null si el negocio no la activó nunca).
  const loyaltyConfig =
    status === BookingStatus.completed
      ? await prisma.loyaltyConfig.findUnique({ where: { businessId } })
      : null

  // Pago revertido (chargeback/refund MP, spec FU-B4b-3 §7): completar está
  // permitido ("atender igual"), pero NO se acredita loyalty (visit points ni
  // emisiones automáticas) por una visita cuya plata se fue. Si la clienta
  // re-paga antes, el recalc ya limpió el marcador y esto no gatea.
  const paymentReverted = existing.paymentStatus === BookingPaymentStatus.refunded

  let isFirstVisit = false
  const updateResult = await prisma.$transaction(async (tx) => {
    // Guard por status esperado DENTRO de la tx (mismo patrón que
    // cancelBookingInTx/rescheduleBookingInTx en lib/bookings/mutate.ts): la
    // transición se validó recién sobre `existing.status`, pero entre ese read y
    // este write otra request pudo mover la reserva. Sin el `status` en el where,
    // un confirmed→completed lento pisaría una reserva ya cancelled y produciría
    // el inválido cancelled→completed. Con el guard, count===0 == carrera perdida.
    const res = await tx.booking.updateMany({
      where: { id, businessId, status: existing.status },
      data: { status, ...reviewTokenData, ...approvalData },
    })
    if (
      res.count > 0 &&
      (status === BookingStatus.cancelled || status === BookingStatus.no_show)
    ) {
      await releaseRedemptionForBooking(
        tx,
        id,
        status === BookingStatus.cancelled ? 'cancelled' : 'no_show',
      )
      // Una reserva que muere (cancelled/no_show) no puede quedar con una
      // transferencia declarada "por verificar" eterna (spec §5-ter).
      // completed NO barre: pagar el saldo después de atendida es el caso de uso.
      await tx.payment.updateMany({
        where: { bookingId: id, ...anyDeclaredTransferWhere },
        data: { status: 'cancelled' },
      })
    }
    if (res.count > 0 && status === BookingStatus.completed && existing.customerId) {
      // Marca de primera/última completación (sirve a aniversario y win-back del cron).
      const prevCompleted = await tx.booking.count({
        where: { customerId: existing.customerId, status: BookingStatus.completed, id: { not: id } },
      })
      isFirstVisit = prevCompleted === 0
      const now = new Date()
      await tx.customer.update({
        where: { id: existing.customerId },
        data: { lastCompletedAt: now, ...(isFirstVisit ? { firstCompletedAt: now } : {}) },
      })
      if (loyaltyConfig?.isActive && !paymentReverted) {
        await creditVisitPoints(tx, {
          businessId,
          customerId: existing.customerId,
          finalAmount: existing.finalAmount,
          bookingId: id,
          config: loyaltyConfig,
        })
      }
    }
    return res
  })
  if (updateResult.count === 0) {
    // La reserva existía (findFirst pasó); count 0 == el guard por status no
    // matcheó, i.e. otra request ya la transicionó entre el read y el write.
    throw new ForbiddenError('El estado de la reserva cambió. Recargá e intentá de nuevo.')
  }

  // R-EMIT: emisiones automáticas FUERA de la tx del evento (cada una en su propia tx, post-commit).
  if (status === BookingStatus.completed && existing.customerId && loyaltyConfig?.isActive && !paymentReverted) {
    await emitAutomaticRewardsOnCompletion({
      businessId,
      customerId: existing.customerId,
      bookingId: id,
      config: loyaltyConfig,
      isFirstVisit,
    })
  }

  // Solicitud aceptada: recién ahora la clienta tiene una reserva de verdad, así
  // que le llega el mismo email de confirmación que en el flujo con abono (lee la
  // reserva ya commiteada y exige status confirmed, por eso va acá y no en la tx).
  if (approving) {
    await sendNotificationSafely('booking approved', () =>
      sendBookingConfirmedNotification(id, businessId),
    )
  }

  if (status === BookingStatus.cancelled && existing.customer.email) {
    await sendNotificationSafely('cancellation', async () => {
      // Las dos lecturas van juntas: en serie le sumaban dos round-trips a la
      // respuesta de cada cancelación. El `calendar` sale del status PREVIO,
      // que es lo que decide si hay evento que borrar del calendario.
      const [businessReplyToEmail, calendar] = await Promise.all([
        getBusinessReplyToEmail(businessId),
        loadBookingCancelNotice(id, existing.status),
      ])
      return sendBookingCancelledNotification({
        businessName: existing.business.name,
        businessReplyToEmail,
        customerName: existing.customer.name,
        customerEmail: existing.customer.email,
        serviceName: existing.service.name,
        startDateTime: existing.startDateTime,
        businessTimezone: existing.business.timezone || 'America/Santiago',
        calendar,
      })
    })
  }

  const updated = await prisma.booking.findUnique({ where: { id } })
  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export const updateBookingStatus = action(_updateBookingStatus)

/**
 * Flujo privado (dashboard): confirma/aplica un pago ya existente a una reserva.
 * Requiere sesión y rol owner/admin. Delega toda la lógica financiera a
 * applyApprovedPayment para garantizar consistencia e idempotencia.
 */
async function _confirmPayment(bookingId: string, paymentId: string, amount: number) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('confirm-payment', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = confirmPaymentSchema.safeParse({ bookingId, paymentId, amount })
  if (!parsed.success) {
    throw new UserError('Datos de pago inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })
  if (!booking) throw new ForbiddenError('Reserva no encontrada')

  try {
    assertBookingPayable(booking)
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : 'No se puede confirmar pago para esta reserva')
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, businessId },
  })
  if (!payment) throw new ForbiddenError('Pago no encontrado')
  if (payment.bookingId !== bookingId) throw new ForbiddenError('El pago no corresponde a esta reserva')
  if (payment.amount !== amount) throw new ForbiddenError('El monto no coincide con el pago registrado')

  // Devolver el resultado en vez de escribirlo en variables de afuera: con un `let`
  // anotado, TypeScript no ve la asignación de adentro del callback.
  const { booking: updated, wasConfirmed, unconfirmedReason } = await prisma.$transaction((tx) =>
    applyApprovedPayment({
      tx,
      bookingId,
      businessId,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paymentType: payment.paymentType,
      paymentMethod: payment.paymentMethod,
      paymentId: payment.id,
    }),
  )

  if (updated && wasConfirmed) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  // El pago se aplicó pero la reserva quedó sin confirmar (horario ocupado, o el
  // cron de holds la venció entre el `assertBookingPayable` de arriba y esta tx).
  // Sin este aviso la dueña ve el pago aplicado y la reserva pendiente, sin
  // ninguna pista de por qué.
  if (unconfirmedReason) {
    await firePaymentNotConfirmedNotification({ bookingId, businessId, reason: unconfirmedReason, amount: payment.amount })
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard')
  if (updated) {
    await revalidateBusinessPublicPaths(updated.businessId)
  }
  return updated
}

export const confirmPayment = action(_confirmPayment)

// read raw a propósito (server page); el UserError acá NO sobrevive a prod —
// solo error boundary server-side.
export async function getBookingsByRange(start: Date, end: Date) {
  const { businessId } = await requireBusiness()

  if (!(start instanceof Date) || isNaN(start.getTime()) || !(end instanceof Date) || isNaN(end.getTime())) {
    throw new UserError('Rango de fechas inválido')
  }
  if (start > end) {
    throw new UserError('La fecha de inicio debe ser anterior a la fecha de término')
  }

  return prisma.booking.findMany({
    where: {
      businessId,
      startDateTime: { gte: start, lte: end },
    },
    orderBy: { startDateTime: 'asc' },
    include: {
      service: true,
      customer: true,
      // Para el calendario: el nombre va en el chip y en el drawer, y el
      // `professionalId` escalar (que el include trae solo) alimenta el filtro
      // por persona de la página.
      professional: { select: { name: true } },
      // Lo mínimo para la precedencia de `displayedBookingStatus`: sin esto el
      // chip le diría "Plazo vencido" a quien transfirió o tiene un pago MP en
      // vuelo. Mismo `where` que getBookings para que calendario y Reservas
      // decidan igual.
      payments: {
        where: holdPrecedencePaymentWhere,
        select: { provider: true, status: true, providerPaymentId: true },
      },
    },
  })
}

const createBookingFromDashboardSchema = z.object({
  serviceId: z.string().min(1),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().min(8).max(20),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerBirthDate: z.string().optional().or(z.literal(''))
    .refine((v) => !v || isValidBirthDateString(v), 'Fecha de cumpleaños inválida'),
  startDateTime: z.date(),
  internalNotes: z.string().max(500).optional(),
  markDepositPaid: z.boolean().optional().default(false),
  paymentMode: z.enum(['none', 'deposit_paid', 'full_paid']).optional(),
  paymentMethod: z.enum(['cash', 'transfer', 'external_card', 'other']).optional(),
  customerId: z.string().min(1).optional(),
  promotionCode: z.string().trim().max(40).optional(),
  skipPackage: z.boolean().optional(),
  modality: z.nativeEnum(ServiceModality).optional(),
  serviceAddress: z.string().trim().max(300, 'La dirección es demasiado larga').optional(),
  // Quién atiende, con la misma semántica del funnel: `anyone` lo resuelve el
  // servidor adentro de la tx. Ausente = sin persona (negocio sin equipo).
  professional: professionalPickSchema.optional(),
})

const PAYMENT_METHOD_MAP: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  external_card: 'Tarjeta externa',
  other: 'Otro',
}

async function _createBookingFromDashboard(data: {
  serviceId: string
  customerName: string
  customerPhone: string
  customerEmail?: string
  customerBirthDate?: string
  startDateTime: Date
  internalNotes?: string
  markDepositPaid?: boolean
  paymentMode?: 'none' | 'deposit_paid' | 'full_paid'
  paymentMethod?: string
  customerId?: string
  promotionCode?: string
  skipPackage?: boolean
  modality?: ServiceModality
  serviceAddress?: string
  professional?: ProfessionalPick
}) {
  const { user, business, businessId } = await requireBusinessRole(['owner', 'admin'])

  // A suspended/cancelled business must not accept new bookings through any path,
  // including manual dashboard creation (mirrors the public createBooking flow).
  assertBusinessCanReceiveBookings(business.subscriptionStatus)

  const parsed = createBookingFromDashboardSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  // Misma derivación que el flujo público (el formulario del panel ni siquiera
  // pregunta la modalidad cuando el servicio tiene una sola).
  const { service, modality, serviceAddress, meetingUrl, totalPrice, depositRequired, finalAmount, endDateTime } =
    await resolveBookingDraft({
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      modality: data.modality,
      serviceAddress: data.serviceAddress,
      defaultMeetingUrl: business.defaultMeetingUrl,
    })

  // Igual que en el flujo público: sólo la elección explícita se autoriza acá.
  // "Cualquiera disponible" no tiene a quién autorizar todavía — la persona no
  // existe hasta que la transacción la elija, con este mismo filtro.
  const professional = data.professional ?? NO_PROFESSIONAL
  if (professional.kind === 'person') {
    await assertProfessionalOffersService(prisma, businessId, professional.id, data.serviceId, modality)
  }

  // Derive payment mode: new explicit mode takes precedence, fallback to legacy markDepositPaid
  const rawPaymentMode = data.paymentMode
  const markDepositPaid = data.markDepositPaid ?? false
  const paymentMode: 'none' | 'deposit_paid' | 'full_paid' =
    rawPaymentMode ?? (markDepositPaid ? 'deposit_paid' : 'none')

  const paymentMethod = data.paymentMethod ?? 'other'
  const displayMethod = PAYMENT_METHOD_MAP[paymentMethod] ?? paymentMethod

  // Validate paymentMethod when creating a payment
  if ((paymentMode === 'deposit_paid' || paymentMode === 'full_paid') && !data.paymentMethod) {
    throw new UserError('Método de pago requerido')
  }

  // Reject deposit_paid when service has no required deposit
  if (paymentMode === 'deposit_paid' && depositRequired <= 0) {
    throw new UserError('No se requiere abono para este servicio. Usa modo "Sin pago" o "Pago total".')
  }

  const noDepositNeeded = depositRequired <= 0
  const isFreeService = finalAmount <= 0

  // Payment mode determines if booking starts confirmed
  const shouldConfirm = paymentMode === 'full_paid' || paymentMode === 'deposit_paid' || noDepositNeeded

  const status = shouldConfirm ? BookingStatus.confirmed : BookingStatus.pending_payment

  const initialPaymentStatus = isFreeService
    ? BookingPaymentStatus.fully_paid
    : BookingPaymentStatus.unpaid

  const booking = await prisma.$transaction(async (tx) => {
    // Mantener el mismo orden global del camino público: Business antes que el
    // advisory del slot. El incremento revierte con la tx si el slot falla.
    const bookingNumber = await assignBookingNumber(tx, businessId)

    // Valida el horario y de paso resuelve quién atiende (con `anyone` prueba a
    // los candidatos en orden de carga). El lead time va en 0 y la resolución no
    // re-aplica el default: la dueña anota walk-ins que empiezan ahora mismo.
    const professionalId = await assertSlotAndResolveProfessional({
      tx,
      businessId,
      serviceId: data.serviceId,
      startDateTime: data.startDateTime,
      endDateTime,
      timezone: business.timezone || 'America/Santiago',
      professional,
      modality,
      leadTimeMinutes: 0,
    })

    let customer: { id: string; name: string; phone: string; email: string | null }

    if (data.customerId) {
      const existing = await tx.customer.findFirst({
        where: { id: data.customerId, businessId },
      })
      if (!existing) {
        throw new UserError(getVocabulary(business.category).clientNotFound)
      }
      customer = existing
    } else {
      const result = await findOrCreateCustomerInTx(tx, {
        businessId,
        phone: data.customerPhone,
        name: data.customerName,
        email: data.customerEmail || null,
        birthDate: birthDateToUtcDate(data.customerBirthDate),
      })
      customer = result.customer
    }

    const newBooking = await tx.booking.create({
      data: {
        businessId,
        serviceId: data.serviceId,
        customerId: customer.id,
        professionalId,
        startDateTime: data.startDateTime,
        endDateTime,
        status,
        totalPrice,
        depositRequired,
        depositPaid: 0,
        remainingBalance: finalAmount,
        finalAmount,
        paymentStatus: initialPaymentStatus,
        modality,
        serviceAddress,
        meetingUrl,
        internalNotes: data.internalNotes || null,
        holdExpiresAt: status === BookingStatus.pending_payment ? addMinutes(new Date(), DASHBOARD_HOLD_MINUTES) : null,
        cancellationCutoffHours: business.selfServiceCutoffHours,
        cancellationPolicySnapshot: business.cancellationPolicy,
        bookingNumber,
      },
      include: BOOKING_RESULT_INCLUDE,
    })

    // Paquete o código, dentro de la misma tx: un código inválido/agotado lanza y
    // hace rollback de todo (booking + canje + incremento + pagos).
    const discountRes = await applyBookingDiscountInTx(tx, {
      businessId,
      customerId: customer.id,
      serviceId: data.serviceId,
      bookingId: newBooking.id,
      totalPrice,
      promotionCode: parsed.data.promotionCode,
      skipPackage: data.skipPackage,
      source: 'dashboard_booking',
      createdByUserId: user.id,
    })

    // Montos efectivos: descontados cuando aplicó una promo, precio total si no.
    const discountAmount = discountRes?.discountAmount ?? 0
    const effFinal = service.price - discountAmount
    const effDeposit = Math.min(service.depositAmount, effFinal)

    // Si aplicó una promo, persistir el descuento y recalcular estado/montos con
    // los valores EFECTIVOS ANTES de las ramas de pago, porque applyApprovedPayment
    // recalcula remainingBalance/paymentStatus a partir del booking.finalAmount /
    // booking.depositRequired ya persistidos.
    let bookingResult = newBooking
    if (discountRes) {
      const effNoDeposit = effDeposit <= 0
      const effFree = effFinal <= 0
      // Mantener la semántica actual: full_paid/deposit_paid o sin abono => confirmed.
      const effShouldConfirm = paymentMode === 'full_paid' || paymentMode === 'deposit_paid' || effNoDeposit
      const effStatus = effShouldConfirm ? BookingStatus.confirmed : BookingStatus.pending_payment
      const effPaymentStatus = effFree ? BookingPaymentStatus.fully_paid : BookingPaymentStatus.unpaid
      const effHold = effStatus === BookingStatus.pending_payment ? addMinutes(new Date(), DASHBOARD_HOLD_MINUTES) : null
      bookingResult = await tx.booking.update({
        where: { id: newBooking.id },
        data: {
          discountAmount,
          finalAmount: effFinal,
          depositRequired: effDeposit,
          remainingBalance: effFinal,
          status: effStatus,
          paymentStatus: effPaymentStatus,
          holdExpiresAt: effHold,
        },
        // También acá: con paquete o código lo que se devuelve es ESTE update,
        // y sin la relación la persona desaparece del camino común (mismas
        // cuatro salidas que createBooking).
        include: BOOKING_RESULT_INCLUDE,
      })
    }

    if (paymentMode === 'deposit_paid' && effDeposit > 0) {
      const payment = await tx.payment.create({
        data: {
          businessId,
          bookingId: newBooking.id,
          customerId: customer.id,
          paymentType: PaymentType.deposit,
          provider: 'manual',
          providerPaymentId: null,
          amount: effDeposit,
          currency: business.currency || 'CLP',
          status: 'pending',
          paymentMethod: displayMethod,
          paidAt: null,
        },
      })

      await applyApprovedPayment({
        tx,
        bookingId: newBooking.id,
        businessId,
        amount: effDeposit,
        currency: business.currency || 'CLP',
        provider: 'manual',
        providerPaymentId: null,
        paymentType: PaymentType.deposit,
        paymentMethod: displayMethod,
        paymentId: payment.id,
      })
    }

    if (paymentMode === 'full_paid' && effFinal > 0) {
      const payment = await tx.payment.create({
        data: {
          businessId,
          bookingId: newBooking.id,
          customerId: customer.id,
          paymentType: PaymentType.full_payment,
          provider: 'manual',
          providerPaymentId: null,
          amount: effFinal,
          currency: business.currency || 'CLP',
          status: 'pending',
          paymentMethod: displayMethod,
          paidAt: null,
        },
      })

      await applyApprovedPayment({
        tx,
        bookingId: newBooking.id,
        businessId,
        amount: effFinal,
        currency: business.currency || 'CLP',
        provider: 'manual',
        providerPaymentId: null,
        paymentType: PaymentType.full_payment,
        paymentMethod: displayMethod,
        paymentId: payment.id,
      })
    }

    return bookingResult
    // 15s: la tx hace creación de reserva + aplicación de promo + creación de pago
    // + applyApprovedPayment (con upserts de ledger); el default de 5s queda corto.
  }, { timeout: 15_000 })

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)

  return booking
}

export const createBookingFromDashboard = action(_createBookingFromDashboard)

async function _cancelBooking(bookingId: string, reason?: string) {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: { service: true, customer: true },
  })

  if (!booking) {
    throw new UserError('Reserva no encontrada')
  }

  if (booking.status === 'completed') {
    throw new UserError('No se puede cancelar una reserva ya completada')
  }

  if (booking.status === 'cancelled') {
    throw new UserError('Esta reserva ya está cancelada')
  }

  await prisma.$transaction(async (tx) => {
    await cancelBookingInTx(tx, booking, { reason })
  })

  if (booking.customer?.email) {
    await sendNotificationSafely('booking cancelled', async () => {
      // Las dos lecturas en paralelo; el `calendar` sale del status PREVIO.
      const [businessReplyToEmail, calendar] = await Promise.all([
        getBusinessReplyToEmail(businessId),
        loadBookingCancelNotice(bookingId, booking.status),
      ])
      return sendBookingCancelledNotification({
        businessName: business.name,
        businessReplyToEmail,
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email,
        serviceName: booking.service!.name,
        startDateTime: booking.startDateTime,
        businessTimezone: business.timezone || 'America/Santiago',
        // Rechazar una solicitud es cancelarla con motivo: sin esto la clienta
        // recibía "tu reserva fue cancelada" a secas y el motivo se quedaba en
        // las notas internas de la dueña.
        reason,
        calendar,
      })
    })
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { cancelled: true }
}

export const cancelBooking = action(_cancelBooking)

async function _rescheduleBooking(bookingId: string, newStartDateTime: Date) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: BOOKING_RESULT_INCLUDE,
  })

  if (!booking) {
    throw new UserError('Reserva no encontrada')
  }

  if (isTerminalBookingStatus(booking.status)) {
    throw new UserError('No se puede reprogramar una reserva en este estado')
  }

  const service = booking.service
  if (!service) {
    throw new UserError('Servicio no encontrado')
  }

  const previousStartDateTime = booking.startDateTime

  try {
    await prisma.$transaction(async (tx) => {
      // La consulta de autorización vive afuera de la tx porque trae las
      // relaciones que necesita el mail. No sirve, sin embargo, para decidir si
      // el plazo sigue vivo: un pago puede haber aterrizado entre esa lectura y
      // este callback. Releer los cuatro campos del guard dentro de la tx evita
      // bloquear una reserva que ya quedó pagada usando un snapshot obsoleto.
      const freshState = await tx.booking.findFirst({
        where: { id: bookingId, businessId },
        select: {
          status: true,
          paymentStatus: true,
          holdExpiresAt: true,
          approvalExpiresAt: true,
          createdAt: true,
        },
      })
      if (!freshState) {
        throw new UserError('No se puede reprogramar una reserva en este estado')
      }
      if (isTerminalBookingStatus(freshState.status)) {
        throw new UserError('No se puede reprogramar una reserva en este estado')
      }

      // El horario/notas y las relaciones siguen siendo los de la lectura
      // autorizada. Sólo el estado que gobierna el guard se sustituye por la
      // lectura transaccional; así este follow-up no cambia el contrato de
      // notificaciones ni empieza a resolver carreras de reprogramación ajenas.
      await rescheduleBookingInTx(tx, {
        booking: {
          ...booking,
          status: freshState.status,
          paymentStatus: freshState.paymentStatus,
          holdExpiresAt: freshState.holdExpiresAt,
          approvalExpiresAt: freshState.approvalExpiresAt,
          createdAt: freshState.createdAt,
        },
        newStartDateTime,
        durationMinutes: service.durationMinutes,
        timezone: business.timezone || 'America/Santiago',
        // Reagendar desde el dashboard no exige anticipación (la dueña manda)
        leadTimeMinutes: 0,
        rescheduledBy: 'owner',
      })
    })
  } catch (error) {
    // Cerrojo final del chequeo de solape, como crear/revivir/reasignar: para quien
    // reprograma es la misma condición, así que sale con el mismo mensaje. Por qué
    // acá y no adentro del helper: ver `isNoOverlapViolation`.
    if (isNoOverlapViolation(error)) {
      // Y queda logueado, igual que en createBooking: que el chequeo de solape y el
      // EXCLUDE hayan discrepado es justo lo que uno quiere poder mirar después.
      // Traducirlo a UserError lo saca del console.error del wrapper `action()`, así
      // que sin esta línea la discrepancia sería muda.
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('booking.error', `Booking_no_overlap rejected rescheduleBooking: ${msg}`, {
        // `bookingId` de primer nivel, no adentro de metadata (misma forma que
        // lib/errors.ts): es un campo estructurado del log y es por el que se filtra.
        bookingId,
        businessId,
        metadata: { error: msg },
      })
      throw new UserError(SLOT_UNAVAILABLE_MESSAGE)
    }
    throw error
  }

  if (booking.customer?.email) {
    await sendNotificationSafely('booking rescheduled', async () =>
      sendBookingRescheduledNotification({
        businessName: business.name,
        // Releído: la fila en memoria conserva el horario anterior. Ver el
        // gemelo en `my-bookings.ts`.
        calendar: (await loadBookingInvite(booking.id))?.invite ?? null,
        bookingNumber: booking.bookingNumber,
        businessReplyToEmail: await getBusinessReplyToEmail(businessId),
        businessWhatsapp: business.whatsapp,
        businessAddress: business.addressText,
        // El dónde completo: sin la modalidad, whereRows caía al default y el
        // mail imprimía la dirección del local en una cita a domicilio u online.
        modality: booking.modality,
        serviceAddress: booking.serviceAddress,
        meetingUrl: booking.meetingUrl,
        businessTimezone: business.timezone || 'America/Santiago',
        customerName: booking.customer!.name,
        customerEmail: booking.customer!.email,
        customerPhone: booking.customer!.phone,
        serviceName: service.name,
        // Reprogramar conserva la persona, así que el nombre leído antes de la
        // tx sigue siendo el que atiende.
        professionalName: booking.professional?.name ?? null,
        previousStartDateTime,
        newStartDateTime,
      }),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  await revalidateBusinessPublicPaths(businessId)

  return { rescheduled: true }
}

export const rescheduleBooking = action(_rescheduleBooking)

/**
 * A quién se le puede pasar ESTA cita: gente activa del negocio que hace este
 * servicio en esta modalidad, sin quien ya la atiende. La regla es la MISMA del
 * funnel (`professionalEligibilityWhere`): ofrecer acá a alguien que la
 * escritura después rechaza es el bug que ese módulo existe para impedir.
 *
 * Se carga bajo demanda desde el drawer y no viaja con el calendario a
 * propósito: el calendario se abre en cada navegación del panel y esta lista
 * sólo se mira cuando la dueña aprieta "Reasignar" (mismo criterio con el que
 * `getProfessionalNames` existe aparte de `getProfessionals`).
 */
async function _getReassignTargets(bookingId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    select: { serviceId: true, modality: true, professionalId: true },
  })
  if (!booking) {
    throw new UserError('Reserva no encontrada')
  }

  return prisma.professional.findMany({
    where: {
      ...activeProfessionalWhere(businessId),
      ...professionalEligibilityWhere(booking.serviceId, booking.modality),
      ...(booking.professionalId ? { NOT: { id: booking.professionalId } } : {}),
    },
    select: { id: true, name: true },
    // El mismo orden (y el mismo desempate) que candidatesByLoad: dos personas
    // con igual sortOrder no deben salir en un orden que dependa del plan de
    // Postgres.
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
}

export const getReassignTargets = action(_getReassignTargets)

/** El rechazo de disponibilidad, contado para esta operación: acá "elegí otra
 *  hora" no es una salida — la hora es fija y lo que se elige es la persona. */
const REASSIGN_BUSY_MESSAGE = 'Esa persona no está disponible en ese horario'

async function _reassignBooking(bookingId: string, professionalId: string) {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])

  // La cita y el nombre de la persona nueva en paralelo: no dependen entre sí
  // (el nombre es para la nota del historial). Sólo los campos que consume la
  // tx — sin email de por medio, la fila gorda de BOOKING_RESULT_INCLUDE sobra.
  const [booking, target] = await Promise.all([
    prisma.booking.findFirst({
      where: { id: bookingId, businessId },
      select: {
        id: true,
        businessId: true,
        serviceId: true,
        modality: true,
        status: true,
        startDateTime: true,
        endDateTime: true,
        internalNotes: true,
        professionalId: true,
        professional: { select: { name: true } },
      },
    }),
    prisma.professional.findUnique({ where: { id: professionalId }, select: { name: true } }),
  ])
  if (!booking) {
    throw new UserError('Reserva no encontrada')
  }
  if (isTerminalBookingStatus(booking.status)) {
    throw new UserError('No se puede reasignar una reserva en este estado')
  }
  if (booking.professionalId === professionalId) {
    throw new UserError('Esa persona ya atiende esta cita')
  }

  // Autorización con la modalidad DE LA RESERVA (quedó resuelta al crearla).
  // Devuelve el id NORMALIZADO y es el que se persiste — el guard existe para
  // que el caller no use el crudo. Si la autorización pasó, la persona existe;
  // el `!target` sólo puede ser un id que la normalización cambió, y se trata
  // igual que no elegible.
  const normalizedId = await assertProfessionalOffersService(prisma, businessId, professionalId, booking.serviceId, booking.modality)
  if (!target) {
    throw new UserError(PROFESSIONAL_UNAVAILABLE_MESSAGE)
  }

  try {
    await prisma.$transaction(async (tx) => {
      await reassignBookingInTx(tx, {
        booking,
        newProfessionalId: normalizedId,
        newProfessionalName: target.name,
        previousProfessionalName: booking.professional?.name ?? null,
        timezone: business.timezone || 'America/Santiago',
      })
    })
  } catch (error) {
    // Los dos rechazos de disponibilidad —el chequeo con lock adentro de la tx
    // y el EXCLUDE por persona como cerrojo final— se cuentan con el mensaje de
    // ESTA operación, no con el genérico de "elegí otra hora".
    if ((error instanceof UserError && error.message === SLOT_UNAVAILABLE_MESSAGE) || isNoOverlapViolation(error)) {
      throw new UserError(REASSIGN_BUSY_MESSAGE)
    }
    throw error
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/calendar')
  revalidatePath('/dashboard')
  // La disponibilidad pública cambió: se libera la agenda de una persona y se
  // ocupa la de otra.
  await revalidateBusinessPublicPaths(businessId)

  // Sin aviso automático a la clienta a propósito: la hora no cambió, y el
  // panel tiene los WhatsApp a mano si el negocio quiere contarle quién la
  // atiende ahora.
  return { professionalName: target.name }
}

export const reassignBooking = action(_reassignBooking)
