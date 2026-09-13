import { headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { BookingBusinessPage } from '@/components/booking/booking-business-page'
import { getBookingBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { getFunnelSession } from '@/lib/customers/session-prefill'
import { PublicAnalytics } from '@/components/analytics/public-analytics'
import { isPublicAnalyticsEligible } from '@/lib/analytics/public-context'
import { getConfiguredAnalyticsConsentVersion } from '@/lib/analytics/budget'
import type { Metadata } from 'next'

// Los referralToken son UUID v4 (crypto.randomUUID). Validar la forma reduce la
// superficie y evita lookups innecesarios con tokens arbitrarios.
const REFERRAL_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers()
  const tenant = await getTenantFromRequest(requestHeaders)
  const business = tenant ? await getBookingBusinessBySubdomain(tenant.subdomain) : null

  if (!business) {
    return { title: 'Reserva tu hora — Agendita' }
  }

  return {
    title: `${business.name} — Reserva tu hora`,
    description: `Elige servicios, profesional y horario para reservar en ${business.name}.`,
  }
}

export default async function BookIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { ref } = await searchParams
  const referralToken = typeof ref === 'string' && REFERRAL_TOKEN_RE.test(ref) ? ref : undefined

  const requestHeaders = await headers()
  const tenant = await getTenantFromRequest(requestHeaders)

  if (tenant) {
    const business = await getBookingBusinessBySubdomain(tenant.subdomain)

    if (business) {
      const session = await getFunnelSession(business.id)
      return (
        <PublicAnalytics businessId={business.id} slug={business.slug} timezone={business.timezone || 'America/Santiago'} consentVersion={getConfiguredAnalyticsConsentVersion() ?? 1} eligible={await isPublicAnalyticsEligible(business.id)} surface="booking">
        <BookingBusinessPage
          business={business}
          profileHref="/"
          referralToken={referralToken}
          session={session}
        />
        </PublicAnalytics>
      )
    }
  }

  const businesses = await prisma.business.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    take: 11,
  })
  const visibleBusinesses = businesses.slice(0, 10)

  return (
    <div className="studio-shell py-10">
      <div className="mx-auto max-w-2xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-normal text-primary">Reserva tu hora</h1>
          <p className="mt-2 text-muted-foreground">Selecciona un negocio para continuar</p>
        </div>
        <div className="space-y-4">
          {!businesses.length && <div className="studio-card p-6"><p className="font-semibold text-primary">No hay negocios disponibles</p><p className="mt-1 text-sm text-muted-foreground">Abre el enlace directo que te compartió el negocio o vuelve a intentarlo más tarde.</p></div>}
          {visibleBusinesses.map((business) => (
            <Link
              key={business.id}
              href={`/book/${business.slug}`}
              className="studio-card block p-6 transition-shadow hover:shadow-[var(--cream-shadow)]"
            >
              <h2 className="text-lg font-semibold text-primary">{business.name}</h2>
              <p className="mt-1 font-semibold text-muted-foreground">Hacer reserva →</p>
            </Link>
          ))}
          {businesses.length > visibleBusinesses.length && <p className="text-sm text-muted-foreground">Mostramos los primeros 10 negocios. Para abrir otro, usa su enlace directo.</p>}
        </div>
      </div>
    </div>
  )
}
