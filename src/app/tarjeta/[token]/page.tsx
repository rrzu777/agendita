import type { Metadata } from 'next'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { resolveLoyaltyCustomer, ensureReferralToken } from '@/lib/loyalty/token'
import { getBookingFunnelUrl } from '@/lib/business/urls'
import { ReferralShare } from './referral-share'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { loyaltyReasonLabel, displayBalance, canAfford } from '@/lib/loyalty/view'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'
import { conditionKind } from '@/lib/loyalty/automatic-match'
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

  await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customer.id, customer.businessId))

  const config = customer.business.loyaltyConfig
  // La reconciliación ya corrió; las 4 lecturas son independientes => en paralelo.
  const [balance, history, catalog, grants, referralRules] = await Promise.all([
    getLoyaltyBalance(prisma, customer.id, customer.businessId),
    getLoyaltyHistory(prisma, customer.id, customer.businessId, 50),
    config?.isActive
      ? prisma.promotion.findMany({
          where: { businessId: customer.businessId, triggerType: 'granted', pointsCost: { not: null }, isActive: true },
          orderBy: { pointsCost: 'asc' },
          select: { id: true, name: true, pointsCost: true },
        })
      : Promise.resolve([] as { id: string; name: string; pointsCost: number | null }[]),
    prisma.promotionGrant.findMany({
      where: { customerId: customer.id, businessId: customer.businessId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
    config?.isActive
      ? prisma.promotion.findMany({
          where: { businessId: customer.businessId, triggerType: 'automatic', isActive: true },
          select: { id: true, conditions: true },
        })
      : Promise.resolve([] as { id: string; conditions: Prisma.JsonValue }[]),
  ])

  // Bloque "Referí a una amiga": solo si la fidelización está activa y existe una
  // regla automática `referral` activa. El token de referido se genera lazy.
  const hasReferralRule = referralRules.some(
    (r) => conditionKind(r.conditions) === 'referral',
  )
  const referralUrl = hasReferralRule
    ? getBookingFunnelUrl(customer.business, `ref=${await ensureReferralToken(prisma, customer)}`)
    : null
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

      {config?.isActive && catalog.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Canjear puntos</h2>
          <ul className="space-y-2">
            {catalog.map(o => {
              const afford = canAfford(balance, o.pointsCost ?? 0)
              return (
                <li key={o.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span className={afford ? '' : 'text-gray-400'}>{o.name} · {o.pointsCost} {label}</span>
                  <form action={redeemAction.bind(null, token)}>
                    <input type="hidden" name="optionId" value={o.id} />
                    <input type="hidden" name="requestId" value={crypto.randomUUID()} />
                    <button type="submit" disabled={!afford} className="rounded-md bg-pink-600 px-3 py-1 text-white disabled:opacity-40">Canjear</button>
                  </form>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {grants.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Mis recompensas</h2>
          <ul className="space-y-2">
            {grants.map(g => (
              <li key={g.id} className="rounded-lg bg-pink-50 px-3 py-2 text-sm">
                <div className="font-medium text-pink-700">{g.promotion.name}</div>
                <div>Código: <code className="font-mono text-base">{g.code}</code></div>
                {g.expiresAt && <div className="text-xs text-pink-700/70">Válido hasta {new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' }).format(g.expiresAt)}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {referralUrl && <ReferralShare url={referralUrl} firstName={firstName} />}

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
