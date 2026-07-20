'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { BookingStatus, Prisma } from '@prisma/client'
import { submitReviewSchema } from '@/lib/reviews/schema'
import { headers } from 'next/headers'
import { getBusinessReplyToEmail, sendReviewRequestNotification } from '@/lib/notifications'
import { buildLoyaltyCardLink } from '@/lib/loyalty/token'
import { getAppUrl } from '@/lib/business/urls'
import { emitAutomaticReward, loadAutomaticRule } from '@/lib/loyalty/automatic'
import { reviewKey } from '@/lib/loyalty/automatic-match'
import { logger } from '@/lib/logger'

export type ReviewFilterStatus = 'all' | 'pending' | 'approved' | 'hidden'

export type ReviewFilters = {
  status?: ReviewFilterStatus
  rating?: number
  search?: string
}

export type ReviewListItem = {
  id: string
  rating: number
  comment: string | null
  isApproved: boolean
  isHidden: boolean
  createdAt: Date
  customer: { id: string; name: string }
  booking: {
    id: string
    startDateTime: Date
    service: { name: string }
  }
}

export type BookingForReviewLink = {
  id: string
  startDateTime: Date
  reviewToken: string | null
  customer: { id: string; name: string }
  service: { name: string }
}

export type ReviewRequestInfo = {
  businessName: string
  serviceName: string
  bookingDate: Date
  bookingId: string
  alreadyReviewed: boolean
}

export async function getReviewRequest(bookingId: string, token: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      business: { select: { name: true } },
      service: { select: { name: true } },
      review: true,
    },
  })

  if (!booking || booking.reviewToken !== token) {
    return null
  }

  if (booking.status !== BookingStatus.completed) {
    // SSR-only (page.tsx la llama en servidor): el throw llega al error boundary; no migrar a UserError
    throw new Error('Esta reserva aún no ha sido completada')
  }

  if (booking.review) {
    return {
      businessName: booking.business.name,
      serviceName: booking.service.name,
      bookingDate: booking.startDateTime,
      bookingId: booking.id,
      alreadyReviewed: true,
    } satisfies ReviewRequestInfo
  }

  return {
    businessName: booking.business.name,
    serviceName: booking.service.name,
    bookingDate: booking.startDateTime,
    bookingId: booking.id,
    alreadyReviewed: false,
  } satisfies ReviewRequestInfo
}

async function _submitReview(data: {
  bookingId: string
  token: string
  rating: number
  comment?: string | null
}) {
  const limit = await checkRateLimit('submit-review', 10, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = submitReviewSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const { bookingId, token, rating, comment } = parsed.data

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { review: true },
  })

  if (!booking || booking.reviewToken !== token) {
    throw new ForbiddenError('Link de reseña inválido o expirado')
  }

  if (booking.status !== BookingStatus.completed) {
    throw new UserError('Solo puedes dejar reseña para reservas completadas')
  }

  if (booking.review) {
    throw new UserError('Ya enviaste una reseña para esta reserva')
  }

  let review
  try {
    review = await prisma.review.create({
      data: {
        businessId: booking.businessId,
        bookingId: booking.id,
        customerId: booking.customerId,
        rating,
        comment: comment || null,
        isApproved: false,
        isHidden: false,
      },
    })
  } catch (e: unknown) {
    const prismaError = e as { code?: string }
    if (prismaError.code === 'P2002') {
      throw new UserError('Ya enviaste una reseña para esta reserva')
    }
    throw e
  }

  // Premio por reseña (R-EMIT: tx aparte, post-commit, best-effort; 1 por reserva vía dedupeKey).
  if (booking.customerId) {
    const customerId = booking.customerId
    try {
      await prisma.$transaction(async (tx) => {
        const config = await tx.loyaltyConfig.findUnique({ where: { businessId: booking.businessId } })
        if (config?.isActive) {
          const rule = await loadAutomaticRule(tx, booking.businessId, 'review')
          if (rule) await emitAutomaticReward(tx, {
            rule, businessId: booking.businessId, customerId,
            dedupeKey: reviewKey(customerId, booking.id),
            config: { grantExpiryDays: config.grantExpiryDays, forfeitGrantOnNoShow: config.forfeitGrantOnNoShow },
            triggeringBookingId: booking.id, now: new Date(),
          })
        }
      })
    } catch (e) {
      logger.error('loyalty.review_emit_failed', `review emit falló booking=${booking.id}: ${String(e)}`)
    }
  }

  await revalidateBusinessPublicPaths(booking.businessId)
  revalidatePath('/dashboard/reviews')
  return review
}

export const submitReview = action(_submitReview)

export async function getDashboardReviews(filters?: ReviewFilters): Promise<ReviewListItem[]> {
  const { businessId } = await requireBusiness()

  const where: Prisma.ReviewWhereInput = { businessId }

  if (filters?.status && filters.status !== 'all') {
    if (filters.status === 'pending') {
      where.isApproved = false
      where.isHidden = false
    } else if (filters.status === 'approved') {
      where.isApproved = true
      where.isHidden = false
    } else if (filters.status === 'hidden') {
      where.isHidden = true
    }
  }

  if (filters?.rating && filters.rating >= 1 && filters.rating <= 5) {
    where.rating = filters.rating
  }

  const search = filters?.search?.trim()
  if (search) {
    where.OR = [
      { customer: { name: { contains: search, mode: 'insensitive' } } },
      { comment: { contains: search, mode: 'insensitive' } },
      { booking: { service: { name: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  return prisma.review.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { id: true, name: true } },
      booking: {
        select: {
          id: true,
          startDateTime: true,
          service: { select: { name: true } },
        },
      },
    },
  })
}

export async function getPendingReviewCount(): Promise<number> {
  const { businessId } = await requireBusiness()

  return prisma.review.count({
    where: {
      businessId,
      isApproved: false,
      isHidden: false,
    },
  })
}

export async function getCompletedBookingsWithoutReview(): Promise<BookingForReviewLink[]> {
  const { businessId } = await requireBusiness()

  return prisma.booking.findMany({
    where: {
      businessId,
      status: BookingStatus.completed,
      review: null,
    },
    orderBy: { startDateTime: 'desc' },
    take: 20,
    select: {
      id: true,
      startDateTime: true,
      reviewToken: true,
      customer: { select: { id: true, name: true } },
      service: { select: { name: true } },
    },
  })
}

async function _approveReview(reviewId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('approve-review', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  })

  if (!review || review.businessId !== businessId) {
    throw new ForbiddenError('Reseña no encontrada')
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { isApproved: true, isHidden: false },
  })

  revalidatePath('/dashboard/reviews')
  await revalidateBusinessPublicPaths(businessId)

  return updated
}

export const approveReview = action(_approveReview)

async function _hideReview(reviewId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('hide-review', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  })

  if (!review || review.businessId !== businessId) {
    throw new ForbiddenError('Reseña no encontrada')
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { isApproved: false, isHidden: true },
  })

  revalidatePath('/dashboard/reviews')
  await revalidateBusinessPublicPaths(businessId)

  return updated
}

export const hideReview = action(_hideReview)

async function _ensureReviewTokenForBooking(bookingId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('ensure-review-token', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })

  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (booking.status !== BookingStatus.completed) {
    throw new UserError('Solo puedes generar link de reseña para reservas completadas')
  }

  if (booking.reviewToken) {
    return booking.reviewToken
  }

  // Atomic claim: only the request that matches `reviewToken: null` wins, so two
  // concurrent calls can't generate two tokens (last-writer-wins would otherwise
  // hand the loser a token that no longer matches the DB).
  const token = crypto.randomUUID()
  const result = await prisma.booking.updateMany({
    where: { id: bookingId, businessId, reviewToken: null },
    data: { reviewToken: token, reviewTokenCreatedAt: new Date() },
  })
  if (result.count === 0) {
    // Another request set the token first — return the persisted value.
    const fresh = await prisma.booking.findFirst({
      where: { id: bookingId, businessId },
      select: { reviewToken: true },
    })
    return fresh?.reviewToken ?? token
  }

  return token
}

export const ensureReviewTokenForBooking = action(_ensureReviewTokenForBooking)

async function _getReviewLink(bookingId: string): Promise<string | null> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    select: { id: true, reviewToken: true, status: true },
  })

  if (!booking || booking.status !== BookingStatus.completed) {
    return null
  }

  const token = booking.reviewToken
  if (!token) return null

  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') || 'https'

  return `${proto}://${host}/review/${booking.id}?token=${token}`
}

export const getReviewLink = action(_getReviewLink)

/**
 * Normaliza un teléfono chileno a formato wa.me (solo dígitos, con código país).
 * Devuelve null si no hay teléfono utilizable.
 */
function toWhatsappPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('56')) return digits
  if (digits.length === 9 && digits.startsWith('9')) return `56${digits}`
  if (digits.length === 8) return `569${digits}`
  return digits
}

/**
 * Prepara el envío de la solicitud de reseña por WhatsApp: asegura el token,
 * arma el link de reseña y un mensaje pre-redactado para wa.me.
 * `waUrl` es null si la clienta no tiene teléfono (se cae a copiar el link).
 */
async function _getReviewWhatsappLink(
  bookingId: string,
): Promise<{ waUrl: string | null; reviewLink: string } | null> {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    select: {
      id: true,
      status: true,
      reviewToken: true,
      customer: { select: { name: true, phone: true } },
      business: { select: { name: true } },
    },
  })

  if (!booking || booking.status !== BookingStatus.completed) {
    return null
  }

  // llamada interna: usar la versión _raw — la wrapped devuelve ActionResult, no el token
  const token = booking.reviewToken ?? (await _ensureReviewTokenForBooking(bookingId))

  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') || 'https'
  const reviewLink = `${proto}://${host}/review/${booking.id}?token=${token}`

  const firstName = booking.customer.name?.split(' ')[0] || ''
  const message =
    `Hola ${firstName}! ✨ Gracias por venir a ${booking.business.name}. ` +
    `¿Nos dejas una reseña? Te toma menos de un minuto 🙏\n${reviewLink}`

  const waPhone = toWhatsappPhone(booking.customer.phone)
  const waUrl = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}` : null

  return { waUrl, reviewLink }
}

export const getReviewWhatsappLink = action(_getReviewWhatsappLink)

async function _sendReviewRequestEmail(bookingId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-review-email', 10, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: {
      customer: { select: { id: true, name: true, email: true, loyaltyToken: true } },
      service: { select: { name: true } },
      business: { select: { name: true, timezone: true, loyaltyConfig: { select: { isActive: true } } } },
      review: { select: { id: true } },
    },
  })

  if (!bookingId || !booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (booking.status !== BookingStatus.completed) {
    throw new UserError('Solo puedes enviar solicitud de reseña para reservas completadas')
  }

  if (booking.review) {
    return { success: false, skipped: 'Ya existe una reseña para esta reserva' }
  }

  const token = booking.reviewToken
  if (!token) {
    throw new UserError('Primero debes generar el link de reseña')
  }

  if (!booking.customer.email) {
    return { success: false, skipped: 'La clienta no tiene email registrado' }
  }

  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') || 'https'
  const reviewLink = `${proto}://${host}/review/${booking.id}?token=${token}`

  // Link "Mi tarjeta" solo si el programa de fidelización está activo.
  // El link a "Mi tarjeta" usa el dominio canónico (getAppUrl), igual que la
  // confirmación, para no depender del host del request (host-injection) ni divergir
  // entre ambos correos. El reviewLink de arriba sí usa el host del tenant.
  const loyaltyCardLink = await buildLoyaltyCardLink(
    prisma,
    booking.customer,
    booking.business.loyaltyConfig,
    getAppUrl(''),
  )

  return sendReviewRequestNotification({
    businessName: booking.business.name,
    businessReplyToEmail: await getBusinessReplyToEmail(businessId),
    customerName: booking.customer.name,
    customerEmail: booking.customer.email,
    serviceName: booking.service.name,
    reviewLink,
    startDateTime: booking.startDateTime,
    businessTimezone: booking.business.timezone || 'America/Santiago',
    loyaltyCardLink,
  })
}

export const sendReviewRequestEmail = action(_sendReviewRequestEmail)
