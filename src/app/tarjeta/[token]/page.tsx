import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { loadLoyaltyCardData } from '@/lib/loyalty/card-data'
import { LoyaltyCard } from '@/components/loyalty/loyalty-card'
import { redeemPointsAsCustomer } from '@/server/actions/loyalty'

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

export default async function LoyaltyCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const customer = await resolveLoyaltyCustomer(prisma, token)

  if (!customer) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Tarjeta no disponible</h1>
        <p className="mt-2 text-gray-500">El enlace no es válido o ya no está activo.</p>
      </main>
    )
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
    </main>
  )
}
