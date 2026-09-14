import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
import { PageMessage } from '@/components/ui/page-message'
import { TenantPublicShell } from '@/components/client/client-shell'
import { MarketingShell } from '@/components/platform/platform-shell'

export const metadata: Metadata = { title: 'Preferencias de promociones', robots: { index: false, follow: false } }

// El token es la credencial (mismo criterio que /tarjeta): va bindeado server-side.
async function optOutAction(token: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutByToken(token, optedOut)
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const customer = await resolveLoyaltyCustomer(prisma, token)

  if (!customer) {
    return <MarketingShell><PageMessage title="Enlace no disponible" message="El enlace no es válido o ya no está activo." /></MarketingShell>
  }

  return (
    <TenantPublicShell business={customer.business} backHref={`/b/${customer.business.slug}`} backLabel="Volver al perfil" width="narrow">
      <div>
      <h1 className="text-center font-heading text-2xl font-semibold text-primary">
        Promociones de {customer.business.name}
      </h1>
      <MarketingOptOutSection
        businessName={customer.business.name}
        optedOut={customer.marketingOptOutAt != null}
        action={optOutAction.bind(null, token)}
      />
      </div>
    </TenantPublicShell>
  )
}
