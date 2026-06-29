import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer } from '@/lib/loyalty/token'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { loyaltyReasonLabel, displayBalance } from '@/lib/loyalty/view'

export const metadata: Metadata = { robots: { index: false, follow: false } }

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

  const config = customer.business.loyaltyConfig
  const [balance, history] = await Promise.all([
    getLoyaltyBalance(prisma, customer.id),
    getLoyaltyHistory(prisma, customer.id, 50),
  ])
  const label = config?.pointsLabel ?? 'puntos'
  const firstName = customer.name.split(' ')[0]

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      {customer.business.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={customer.business.logoUrl} alt={customer.business.name} className="mx-auto mb-4 h-12 w-auto" />
      )}
      <h1 className="text-center text-lg font-semibold">{config?.programName ?? 'Mi tarjeta'}</h1>
      <p className="text-center text-sm text-gray-500">Hola, {firstName}</p>

      {config?.isActive === false && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">
          El programa está pausado por el momento.
        </p>
      )}

      <div className="mt-6 rounded-2xl bg-pink-50 py-8 text-center">
        <div className="text-4xl font-bold text-pink-600">{displayBalance(balance)}</div>
        <div className="text-sm text-pink-700">{label}</div>
      </div>

      {config?.cardMessage && (
        <p className="mt-4 text-center text-sm text-gray-500">{config.cardMessage}</p>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Movimientos</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no tienes movimientos.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-600">
                  {loyaltyReasonLabel(h.reason)}
                  <span className="ml-2 text-gray-400">
                    {new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(h.createdAt)}
                  </span>
                </span>
                <span className={h.points >= 0 ? 'font-medium text-green-600' : 'font-medium text-gray-500'}>
                  {h.points >= 0 ? '+' : ''}{h.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
