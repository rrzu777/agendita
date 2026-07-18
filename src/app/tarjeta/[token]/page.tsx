import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { loadLoyaltyCardData } from '@/lib/loyalty/card-data'
import { LoyaltyCard } from '@/components/loyalty/loyalty-card'
import { redeemPointsAsCustomer } from '@/server/actions/loyalty'
import { setMarketingOptOutByToken } from '@/server/actions/marketing-optout'
import { MarketingOptOutSection } from '@/components/loyalty/marketing-optout-section'
import { PageMessage } from '@/components/ui/page-message'

export const metadata: Metadata = { robots: { index: false, follow: false } }

// El token va bindeado server-side (no como hidden input): es la credencial del
// carnet y no debe confiarse desde el body del form.
async function redeemAction(token: string, formData: FormData) {
  'use server'
  await redeemPointsAsCustomer(
    token,
    String(formData.get('optionId')),
    String(formData.get('requestId')),
  )
}

// Mismo criterio de bind server-side que redeemAction: el token es la credencial.
async function optOutAction(token: string, optedOut: boolean) {
  'use server'
  await setMarketingOptOutByToken(token, optedOut)
}

export default async function LoyaltyCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const customer = await resolveLoyaltyCustomer(prisma, token)

  if (!customer) {
    return <PageMessage title="Tarjeta no disponible" message="El enlace no es válido o ya no está activo." />
  }

  const data = await loadLoyaltyCardData(customer)

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <LoyaltyCard
        customerName={customer.name}
        business={{ name: customer.business.name, logoUrl: customer.business.logoUrl }}
        data={data}
        redeemAction={redeemAction.bind(null, token)}
      />
      {!customer.userId && (
        <p className="mt-8 text-center text-sm">
          <Link href={`/ingresar?next=/tarjeta/${token}/vincular`} className="font-semibold text-pink-700 hover:underline">
            Guardar mi tarjeta en mi cuenta
          </Link>
        </p>
      )}
      <MarketingOptOutSection
        businessName={customer.business.name}
        optedOut={customer.marketingOptOutAt != null}
        action={optOutAction.bind(null, token)}
      />
    </main>
  )
}
