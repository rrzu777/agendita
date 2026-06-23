'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { BookingStatus, Prisma } from '@prisma/client'
import { submitReviewSchema } from '@/lib/reviews/schema'
import { headers } from 'next/headers'
import { sendReviewRequestNotification } from '@/lib/notifications'

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

export async function submitReview(data: {
  bookingId: string
  token: string
  rating: number
  comment?: string | null
}) {
  const limit = await checkRateLimit('submit-review', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = submitReviewSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
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
    throw new Error('Solo puedes dejar reseña para reservas completadas')
  }

  if (booking.review) {
    throw new Error('Ya enviaste una reseña para esta reserva')
  }

  try {
    const review = await prisma.review.create({
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

    revalidateBusinessPublicPaths(booking.businessId)
    revalidatePath('/dashboard/reviews')

    return review
  } catch (e: unknown) {
    const prismaError = e as { code?: string }
    if (prismaError.code === 'P2002') {
      throw new Error('Ya enviaste una reseña para esta reserva')
    }
    throw e
  }
}

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

export async function approveReview(reviewId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('approve-review', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
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
  revalidateBusinessPublicPaths(businessId)

  return updated
}

export async function hideReview(reviewId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('hide-review', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
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
  revalidateBusinessPublicPaths(businessId)

  return updated
}

export async function ensureReviewTokenForBooking(bookingId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('ensure-review-token', 20, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
  })

  if (!booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (booking.status !== BookingStatus.completed) {
    throw new Error('Solo puedes generar link de reseña para reservas completadas')
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

export async function getReviewLink(bookingId: string): Promise<string | null> {
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

export async function sendReviewRequestEmail(bookingId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-review-email', 10, 60000)
  if (!limit.success) {
    throw new Error('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, businessId },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      service: { select: { name: true } },
      business: { select: { name: true, timezone: true } },
      review: { select: { id: true } },
    },
  })

  if (!bookingId || !booking) {
    throw new ForbiddenError('Reserva no encontrada')
  }

  if (booking.status !== BookingStatus.completed) {
    throw new Error('Solo puedes enviar solicitud de reseña para reservas completadas')
  }

  if (booking.review) {
    return { success: false, skipped: 'Ya existe una reseña para esta reserva' }
  }

  const token = booking.reviewToken
  if (!token) {
    throw new Error('Primero debes generar el link de reseña')
  }

  if (!booking.customer.email) {
    return { success: false, skipped: 'La clienta no tiene email registrado' }
  }

  const headersList = await headers()
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000'
  const proto = headersList.get('x-forwarded-proto') || 'https'
  const reviewLink = `${proto}://${host}/review/${booking.id}?token=${token}`

  return sendReviewRequestNotification({
    businessName: booking.business.name,
    customerName: booking.customer.name,
    customerEmail: booking.customer.email,
    serviceName: booking.service.name,
    reviewLink,
    startDateTime: booking.startDateTime,
    businessTimezone: booking.business.timezone || 'America/Santiago',
  })
}
