import { headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { BookingBusinessPage } from '@/components/booking/booking-business-page'
import { getBookingBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'

// Los referralToken son UUID v4 (crypto.randomUUID). Validar la forma reduce la
// superficie y evita lookups innecesarios con tokens arbitrarios.
const REFERRAL_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      return <BookingBusinessPage business={business} profileHref="/" referralToken={referralToken} session={null} />
    }
  }

  const businesses = await prisma.business.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    take: 10,
  })

  return (
    <div className="studio-shell py-10">
      <div className="mx-auto max-w-2xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-normal text-primary">Reserva tu hora</h1>
          <p className="mt-2 text-muted-foreground">Selecciona un negocio para continuar</p>
        </div>
        <div className="space-y-4">
          {businesses.map((business) => (
            <Link
              key={business.id}
              href={`/book/${business.slug}`}
              className="studio-card block p-6 transition-shadow hover:shadow-[var(--cream-shadow)]"
            >
              <h2 className="text-lg font-semibold text-primary">{business.name}</h2>
              <p className="mt-1 font-semibold text-muted-foreground">Hacer reserva →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
