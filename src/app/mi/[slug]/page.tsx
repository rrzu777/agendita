import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { prepareMiUser } from '@/lib/auth/mi-user'
import { loadLoyaltyCardData } from '@/lib/loyalty/card-data'
import { LoyaltyCard } from '@/components/loyalty/loyalty-card'
import { redeemPointsAsMe } from '@/server/actions/loyalty'
import { setMarketingOptOutAsMe } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
import { getBookingFunnelUrl } from '@/lib/business/urls'
import { formatBookingNumber } from '@/lib/bookings/number'
import { bookingStatusLabels } from '@/lib/bookings/status-labels'
import { formatShortDate } from '@/lib/format-date'
import { declaredTransferPaymentWhere } from '@/lib/bank-transfer/declared'
import { canSelfManage } from '@/lib/bookings/self-service'
import { BookingActions } from './booking-actions'
import type { BookingStatus } from '@prisma/client'

const UPCOMING_STATUSES = ['pending_payment', 'confirmed'] as const

// Solo el flag "transferencia declarada pendiente de verificación".
const BT_DECLARED_SELECT = {
  where: declaredTransferPaymentWhere,
  select: { id: true },
}

// "Pendiente de pago" suena a "no pagaste": si la clienta ya declaró la
// transferencia, mostrar el estado real.
function statusLabel(b: { status: BookingStatus; payments: { id: string }[] }) {
  return b.status === 'pending_payment' && b.payments.length > 0
    ? 'Transferencia en verificación'
    : bookingStatusLabels[b.status]
}

async function redeemAction(customerId: string, formData: FormData) {
  'use server'
  await redeemPointsAsMe(customerId, String(formData.get('optionId')), String(formData.get('requestId')))
}

// Mismo criterio de bind server-side que redeemAction: el customerId no viaja
// en el body del form (la action re-verifica ownership por sesión igualmente).
async function optOutAsMeAction(customerId: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutAsMe(customerId, optedOut)
}

export default async function MiBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // await la preparación (fila User + auto-link) antes de leer Customers, para
  // que el acceso directo a /mi/[slug] no dé 404 por leer antes del link.
  const result = await prepareMiUser()
  if (result.status !== 'ok') return null // layout maneja anon (redirect) / conflict
  const user = result.user

  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, subdomain: true, logoUrl: true, selfServiceCutoffHours: true,
      loyaltyConfig: { select: { isActive: true, programName: true, pointsLabel: true, cardMessage: true } },
    },
  })
  if (!business) notFound()

  // Sin Customer vinculado en este negocio -> 404 (no revela negocios ajenos).
  const customers = await prisma.customer.findMany({
    where: { userId: user.id, businessId: business.id },
    select: { id: true, name: true, businessId: true, referralToken: true, marketingOptOutAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (customers.length === 0) notFound()

  // Tx interactiva dentro del loader -> secuencial por customer (P2028).
  const cards: Awaited<ReturnType<typeof loadLoyaltyCardData>>[] = []
  for (const c of customers) {
    cards.push(await loadLoyaltyCardData({ ...c, business }))
  }

  const now = new Date()
  const customerIds = customers.map((c) => c.id)
  const [upcoming, past] = await Promise.all([
    prisma.booking.findMany({
      where: { customerId: { in: customerIds }, startDateTime: { gte: now }, status: { in: [...UPCOMING_STATUSES] } },
      orderBy: { startDateTime: 'asc' },
      select: { id: true, bookingNumber: true, startDateTime: true, status: true, service: { select: { name: true } }, payments: BT_DECLARED_SELECT },
    }),
    prisma.booking.findMany({
      where: { customerId: { in: customerIds }, OR: [{ startDateTime: { lt: now } }, { status: { notIn: [...UPCOMING_STATUSES] } }] },
      orderBy: { startDateTime: 'desc' },
      take: 20,
      select: { id: true, bookingNumber: true, startDateTime: true, status: true, service: { select: { name: true } }, payments: BT_DECLARED_SELECT },
    }),
  ])

  // La tarjeta se lee mejor angosta: ancho propio dentro del contenedor del layout.
  return (
    <main className="mx-auto max-w-md pb-10">
      <h1 className="pt-6 text-center text-xl font-semibold">{business.name}</h1>
      {customers.map((c, i) => (
        <LoyaltyCard
          key={c.id}
          customerName={c.name}
          business={{ name: business.name, logoUrl: business.logoUrl }}
          data={cards[i]}
          redeemAction={redeemAction.bind(null, c.id)}
          titleAs="h2"
        />
      ))}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Próximas reservas</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">No tienes reservas próximas.</p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id} className="rounded-lg border border-gray-100 px-3 py-2 text-sm">
                <div className="font-medium">{b.service?.name}</div>
                <div className="text-gray-500">{formatShortDate(b.startDateTime)} · {statusLabel(b)} · {formatBookingNumber(b.bookingNumber, b.id)}</div>
                <BookingActions
                  bookingId={b.id}
                  slug={business.slug}
                  canManage={canSelfManage(b.startDateTime, business.selfServiceCutoffHours)}
                  cutoffHours={business.selfServiceCutoffHours}
                />
              </li>
            ))}
          </ul>
        )}
        <a
          href={getBookingFunnelUrl({ slug: business.slug, subdomain: business.subdomain })}
          className="mt-3 inline-block rounded-full bg-pink-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Reservar
        </a>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Historial</h2>
        {past.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no tienes visitas.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {past.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                <span>{b.service?.name}</span>
                <span className="text-gray-400">{formatShortDate(b.startDateTime)} · {statusLabel(b)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {customers.map((c) => (
        <MarketingOptOutSection
          key={c.id}
          businessName={business.name}
          optedOut={c.marketingOptOutAt != null}
          action={optOutAsMeAction.bind(null, c.id)}
        />
      ))}
    </main>
  )
}
