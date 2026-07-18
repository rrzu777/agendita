import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
import { PageMessage } from '@/components/ui/page-message'

export const metadata: Metadata = { robots: { index: false, follow: false } }

// El token es la credencial (mismo criterio que /tarjeta): va bindeado server-side.
async function optOutAction(token: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutByToken(token, optedOut)
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const customer = await resolveLoyaltyCustomer(prisma, token)

  if (!customer) {
    return <PageMessage title="Enlace no disponible" message="El enlace no es válido o ya no está activo." />
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-center font-heading text-xl font-semibold text-primary">
        Promociones de {customer.business.name}
      </h1>
      <MarketingOptOutSection
        businessName={customer.business.name}
        optedOut={customer.marketingOptOutAt != null}
        action={optOutAction.bind(null, token)}
      />
    </main>
  )
}
