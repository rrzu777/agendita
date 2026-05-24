import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import {
  getDashboardReviews,
  getPendingReviewCount,
  getCompletedBookingsWithoutReview,
  approveReview,
  hideReview,
} from '@/server/actions/reviews'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { CheckCircle, EyeOff, Star, MessageSquare, ExternalLink } from 'lucide-react'
import { ReviewFilterBar } from './filter-bar'
import { ReviewLinkButton } from './review-link-button'
import type { ReviewFilterStatus } from '@/server/actions/reviews'

interface Props {
  searchParams: Promise<{ status?: string; rating?: string; search?: string }>
}

export default async function ReviewsPage({ searchParams }: Props) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const params = await searchParams

  const status = (params.status as ReviewFilterStatus) || 'all'
  const rating = params.rating ? parseInt(params.rating, 10) : undefined
  const filterRating = rating && rating >= 1 && rating <= 5 ? rating : undefined
  const search = params.search?.trim() || undefined

  const hasActiveFilters = status !== 'all' || filterRating !== undefined || (search !== undefined && search.length > 0)

  let reviews: Awaited<ReturnType<typeof getDashboardReviews>> = []
  let pendingCount = 0
  let eligibleBookings: Awaited<ReturnType<typeof getCompletedBookingsWithoutReview>> = []

  try {
    reviews = await getDashboardReviews({ status, rating: filterRating, search })
    pendingCount = await getPendingReviewCount()
    eligibleBookings = await getCompletedBookingsWithoutReview()
  } catch {
    // Auth error fallback
  }

  const approvedCount = reviews.filter(r => r.isApproved && !r.isHidden).length
  const hiddenCount = reviews.filter(r => r.isHidden).length

  function reviewState(review: (typeof reviews)[number]): 'pending' | 'approved' | 'hidden' {
    if (review.isHidden) return 'hidden'
    if (review.isApproved) return 'approved'
    return 'pending'
  }

  const stateLabels: Record<string, string> = {
    pending: 'Pendiente',
    approved: 'Aprobada',
    hidden: 'Oculta',
  }

  const stateColors: Record<string, string> = {
    pending: 'bg-orange-100 text-orange-800',
    approved: 'bg-green-100 text-green-800',
    hidden: 'bg-muted text-muted-foreground',
  }

  return (
    <div>
      <DashboardHeader title="Reseñas" subtitle="Modera y administra las reseñas de tus clientas." />
      <div className="p-5 md:p-10">
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Pendientes</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{pendingCount}</p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Aprobadas</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{approvedCount}</p>
          </div>
          <div className="studio-card p-4">
            <p className="studio-eyebrow">Ocultas</p>
            <p className="mt-1 text-3xl font-semibold text-primary">{hiddenCount}</p>
          </div>
        </div>

        <div className="mb-6">
          <ReviewFilterBar />
        </div>

        {eligibleBookings.length > 0 && (
          <div className="studio-card mb-6 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
              <h2 className="text-lg font-semibold text-primary">
                Reservas completadas sin reseña
              </h2>
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                {eligibleBookings.length}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Servicio</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleBookings.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-semibold text-primary">
                      {booking.service.name}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/customers/${booking.customer.id}`}
                        className="text-primary hover:underline"
                      >
                        {booking.customer.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {new Date(booking.startDateTime).toLocaleDateString('es-CL', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <ReviewLinkButton
                        bookingId={booking.id}
                        hasToken={!!booking.reviewToken}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="studio-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Cliente</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead>Fecha reserva</TableHead>
                <TableHead>Calificación</TableHead>
                <TableHead>Comentario</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                        <MessageSquare className="size-7 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="mb-1 text-base font-semibold text-primary">
                          {hasActiveFilters ? 'No hay reseñas con estos filtros' : 'No hay reseñas'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {hasActiveFilters
                            ? 'Prueba con otros filtros o limpia la búsqueda.'
                            : 'Las reseñas aparecerán después de que completes reservas.'}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                reviews.map((review) => {
                  const state = reviewState(review)

                  return (
                    <TableRow key={review.id}>
                      <TableCell className="font-semibold text-primary">
                        <Link
                          href={`/dashboard/customers/${review.customer.id}`}
                          className="hover:underline"
                        >
                          {review.customer?.name || '—'}
                        </Link>
                        <div className="text-xs font-normal text-muted-foreground">#{review.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell>
                        {review.booking?.service?.name || '—'}
                      </TableCell>
                      <TableCell>
                        {new Date(review.booking?.startDateTime).toLocaleDateString('es-CL', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-primary">{review.rating}</span>
                          <Star className="size-4 fill-primary text-primary" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {review.comment || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={stateColors[state]}>
                          {stateLabels[state]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {state === 'pending' && (
                            <form action={async () => {
                              'use server'
                              await approveReview(review.id)
                            }}>
                              <Button type="submit" size="sm" variant="outline">
                                <CheckCircle className="mr-1 size-4" />
                                Aprobar
                              </Button>
                            </form>
                          )}
                          {state === 'approved' && (
                            <form action={async () => {
                              'use server'
                              await hideReview(review.id)
                            }}>
                              <Button type="submit" size="sm" variant="outline">
                                <EyeOff className="mr-1 size-4" />
                                Ocultar
                              </Button>
                            </form>
                          )}
                          {state === 'hidden' && (
                            <form action={async () => {
                              'use server'
                              await approveReview(review.id)
                            }}>
                              <Button type="submit" size="sm" variant="outline">
                                <CheckCircle className="mr-1 size-4" />
                                Aprobar
                              </Button>
                            </form>
                          )}
                          <Link href={`/dashboard/bookings`}>
                            <Button type="button" size="sm" variant="ghost">
                              <ExternalLink className="mr-1 size-3" />
                              Ver reserva
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
