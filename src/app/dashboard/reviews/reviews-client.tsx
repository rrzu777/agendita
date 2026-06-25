'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CheckCircle, EyeOff, Star, MessageSquare, ExternalLink, Search, X } from 'lucide-react'
import { ReviewLinkButton } from './review-link-button'
import { approveReview, hideReview } from '@/server/actions/reviews'

type ReviewState = 'pending' | 'approved' | 'hidden'

interface ReviewRow {
  id: string
  rating: number
  comment: string | null
  isApproved: boolean
  isHidden: boolean
  customer: { id: string; name: string | null } | null
  booking: { startDateTime: Date | string; service: { name: string } | null } | null
}

interface EligibleBooking {
  id: string
  reviewToken: string | null
  startDateTime: Date | string
  service: { name: string }
  customer: { id: string; name: string | null }
}

const statusOptions = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'hidden', label: 'Ocultas' },
] as const

const ratingOptions = [
  { value: 0, label: 'Todas' },
  { value: 1, label: '★ 1' },
  { value: 2, label: '★ 2' },
  { value: 3, label: '★ 3' },
  { value: 4, label: '★ 4' },
  { value: 5, label: '★ 5' },
] as const

const stateLabels: Record<ReviewState, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  hidden: 'Oculta',
}

const stateColors: Record<ReviewState, string> = {
  pending: 'bg-orange-100 text-orange-800',
  approved: 'bg-green-100 text-green-800',
  hidden: 'bg-muted text-muted-foreground',
}

function reviewState(review: ReviewRow): ReviewState {
  if (review.isHidden) return 'hidden'
  if (review.isApproved) return 'approved'
  return 'pending'
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ReviewsClient({
  reviews,
  eligibleBookings,
  pendingCount,
}: {
  reviews: ReviewRow[]
  eligibleBookings: EligibleBooking[]
  pendingCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [status, setStatus] = useState<(typeof statusOptions)[number]['value']>('all')
  const [rating, setRating] = useState<number>(0)
  const [search, setSearch] = useState('')

  const approvedCount = useMemo(() => reviews.filter(r => r.isApproved && !r.isHidden).length, [reviews])
  const hiddenCount = useMemo(() => reviews.filter(r => r.isHidden).length, [reviews])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reviews.filter(review => {
      if (status !== 'all' && reviewState(review) !== status) return false
      if (rating > 0 && review.rating !== rating) return false
      if (q) {
        const haystack = [
          review.customer?.name ?? '',
          review.comment ?? '',
          review.booking?.service?.name ?? '',
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [reviews, status, rating, search])

  const hasActiveFilters = status !== 'all' || rating > 0 || search.trim().length > 0

  function runAction(action: (id: string) => Promise<unknown>, id: string) {
    startTransition(async () => {
      await action(id)
      router.refresh()
    })
  }

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Pendientes</p>
          <p className="mt-1 font-heading text-3xl font-semibold text-primary">{pendingCount}</p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Aprobadas</p>
          <p className="mt-1 font-heading text-3xl font-semibold text-primary">{approvedCount}</p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Ocultas</p>
          <p className="mt-1 font-heading text-3xl font-semibold text-primary">{hiddenCount}</p>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex gap-1 rounded-2xl border border-border bg-card p-1">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  status === opt.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-2xl border border-border bg-card p-1">
            {ratingOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRating(opt.value)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  rating === opt.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente, comentario o servicio..."
            className="w-full rounded-2xl border border-border bg-card py-2.5 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {eligibleBookings.length > 0 && (
        <div className="studio-card mb-6 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
            <h2 className="font-heading text-lg font-semibold text-primary">Reservas completadas sin reseña</h2>
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
                  <TableCell className="font-semibold text-primary">{booking.service.name}</TableCell>
                  <TableCell>
                    <Link href={`/dashboard/customers/${booking.customer.id}`} className="text-primary hover:underline">
                      {booking.customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(booking.startDateTime)}</TableCell>
                  <TableCell className="text-right">
                    <ReviewLinkButton bookingId={booking.id} hasToken={!!booking.reviewToken} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className={`studio-card overflow-hidden transition-opacity ${isPending ? 'opacity-60' : ''}`}>
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
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                      <MessageSquare className="size-7 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="mb-1 font-heading text-base font-semibold text-primary">
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
              filtered.map((review) => {
                const state = reviewState(review)
                return (
                  <TableRow key={review.id}>
                    <TableCell className="font-semibold text-primary">
                      <Link href={`/dashboard/customers/${review.customer?.id}`} className="hover:underline">
                        {review.customer?.name || '—'}
                      </Link>
                      <div className="text-xs font-normal text-muted-foreground">#{review.id.slice(0, 8)}</div>
                    </TableCell>
                    <TableCell>{review.booking?.service?.name || '—'}</TableCell>
                    <TableCell>{review.booking?.startDateTime ? formatDate(review.booking.startDateTime) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-primary">{review.rating}</span>
                        <Star className="size-4 fill-primary text-primary" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="line-clamp-2 text-sm text-muted-foreground">{review.comment || '—'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={stateColors[state]}>{stateLabels[state]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {state !== 'approved' && (
                          <Button type="button" size="sm" variant="outline" disabled={isPending}
                            onClick={() => runAction(approveReview, review.id)}>
                            <CheckCircle className="mr-1 size-4" />
                            Aprobar
                          </Button>
                        )}
                        {state === 'approved' && (
                          <Button type="button" size="sm" variant="outline" disabled={isPending}
                            onClick={() => runAction(hideReview, review.id)}>
                            <EyeOff className="mr-1 size-4" />
                            Ocultar
                          </Button>
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
    </>
  )
}
