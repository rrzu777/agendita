import { headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'
import { getPackagesBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { getPackageCheckoutPrefill } from '@/server/actions/packages-checkout'

export default async function PaquetesIndexPage() {
  const requestHeaders = await headers()
  const tenant = await getTenantFromRequest(requestHeaders)

  if (tenant) {
    const business = await getPackagesBusinessBySubdomain(tenant.subdomain)

    if (business) {
      const [availability, prefill] = await Promise.all([
        resolveOnlinePaymentAvailabilityForBusiness(business.id),
        getPackageCheckoutPrefill(business.id),
      ])
      return (
        <PackagesBusinessPage
          business={business}
          profileHref="/"
          onlineAvailable={availability.available}
          onlineReason={availability.reason ?? null}
          prefill={prefill}
        />
      )
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
          <h1 className="text-4xl font-semibold tracking-normal text-primary">Paquetes</h1>
          <p className="mt-2 text-muted-foreground">Selecciona un negocio para ver sus paquetes</p>
        </div>
        <div className="space-y-4">
          {businesses.map((business) => (
            <Link
              key={business.id}
              href={`/paquetes/${business.slug}`}
              className="studio-card block p-6 transition-shadow hover:shadow-[var(--cream-shadow)]"
            >
              <h2 className="text-lg font-semibold text-primary">{business.name}</h2>
              <p className="mt-1 font-semibold text-muted-foreground">Ver paquetes →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
