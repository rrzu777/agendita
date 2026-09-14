import { headers } from 'next/headers'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { PackagesBusinessPage } from '@/components/packages/packages-business-page'
import { getPackagesBusinessBySubdomain } from '@/lib/business/public'
import { getTenantFromRequest } from '@/lib/tenant/resolver'
import { resolveOnlinePaymentAvailabilityForBusiness } from '@/lib/payments/factory'
import { getPackageCheckoutPrefill } from '@/server/actions/packages-checkout'
import { getBankTransferInfo } from '@/server/actions/bank-transfer-public'
import { MarketingShell } from '@/components/platform/platform-shell'

export default async function PaquetesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ comprar?: string }>
}) {
  const { comprar } = await searchParams
  const requestHeaders = await headers()
  const tenant = await getTenantFromRequest(requestHeaders)

  if (tenant) {
    const business = await getPackagesBusinessBySubdomain(tenant.subdomain)

    if (business) {
      const [availability, prefill, transferInfo] = await Promise.all([
        resolveOnlinePaymentAvailabilityForBusiness(business.id),
        getPackageCheckoutPrefill(business.id),
        getBankTransferInfo(business.id),
      ])
      return (
        <PackagesBusinessPage
          business={business}
          profileHref="/"
          onlineAvailable={availability.available}
          onlineReason={availability.reason ?? null}
          prefill={prefill}
          preselectedProductId={comprar}
          transferInfo={transferInfo}
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
    <MarketingShell>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-semibold tracking-normal text-primary">Paquetes</h1>
          <p className="mt-2 text-muted-foreground">Selecciona un negocio para ver sus paquetes</p>
        </div>
        <div className="space-y-4">
          {businesses.map((business) => (
            <Link
              key={business.id}
              href={`/paquetes/${business.slug}`}
              className="block min-h-28 rounded-xl border border-border bg-card p-6 transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h2 className="text-lg font-semibold text-primary">{business.name}</h2>
              <p className="mt-1 font-semibold text-muted-foreground">Ver paquetes →</p>
            </Link>
          ))}
          {businesses.length === 0 && <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">Todavía no hay catálogos públicos disponibles.</p>}
        </div>
      </main>
    </MarketingShell>
  )
}
