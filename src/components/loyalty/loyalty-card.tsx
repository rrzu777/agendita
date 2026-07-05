import { formatShortDate } from '@/lib/format-date'
import { loyaltyReasonLabel, displayBalance, canAfford } from '@/lib/loyalty/view'
import type { LoyaltyCardData } from '@/lib/loyalty/card-data'
import { ReferralShare } from '@/components/loyalty/referral-share'

interface LoyaltyCardProps {
  customerName: string
  business: { name: string; logoUrl: string | null }
  data: LoyaltyCardData
  /** Server action ya bindeada con la credencial (token o customerId). */
  redeemAction: (formData: FormData) => Promise<void>
}

export function LoyaltyCard({ customerName, business, data, redeemAction }: LoyaltyCardProps) {
  const { config, balance, history, catalog, grants, packages, referralUrl } = data
  const label = config?.pointsLabel ?? 'puntos'
  const firstName = customerName.split(' ')[0]

  return (
    <>
      {business.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={business.logoUrl} alt={business.name} className="mx-auto mb-4 h-12 w-auto" />
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
                  <form action={redeemAction}>
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
                {g.expiresAt && <div className="text-xs text-pink-700/70">Válido hasta {formatShortDate(g.expiresAt)}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {packages.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Mis paquetes</h2>
          <ul className="space-y-2">
            {packages.map(p => (
              <li key={p.id} className="rounded-lg bg-pink-50 px-3 py-2 text-sm">
                <div className="font-medium text-pink-700">{p.product.name}</div>
                <div>{p._count.grants} sesiones disponibles</div>
                {p.expiresAt && <div className="text-xs text-pink-700/70">Válido hasta {formatShortDate(p.expiresAt)}</div>}
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
    </>
  )
}
