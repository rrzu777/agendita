import { formatShortDate } from '@/lib/format-date'
import { loyaltyReasonLabel, displayBalance, canAfford } from '@/lib/loyalty/view'
import type { LoyaltyCardData } from '@/lib/loyalty/card-data'
import { ReferralShare } from '@/components/loyalty/referral-share'
import { RedeemButton } from '@/components/loyalty/redeem-button'
import type { ActionResult } from '@/lib/actions/result'
import type { Vocabulary } from '@/lib/vocabulary'

interface LoyaltyCardProps {
  customerName: string
  business: { name: string; logoUrl: string | null }
  /** Léxico del rubro. Prop y no contexto: esta tarjeta vive fuera del dashboard. */
  vocabulary: Vocabulary
  data: LoyaltyCardData
  /** Server action ya bindeada con la credencial (token o customerId). */
  redeemAction: (optionId: string, requestId: string) => Promise<ActionResult<void>>
  /** 'h2' cuando la página ya tiene su propio h1 (ej. /mi/[slug]). */
  titleAs?: 'h1' | 'h2' | 'h3'
}

export function LoyaltyCard({ customerName, business, data, redeemAction, vocabulary, titleAs: TitleTag = 'h1' }: LoyaltyCardProps) {
  const SectionTag = TitleTag === 'h1' ? 'h2' : 'h3'
  const { config, balance, history, catalog, grants, packages, pendingPackages, referralUrl } = data
  const label = config?.pointsLabel ?? 'puntos'
  const firstName = customerName.split(' ')[0]

  return (
    <>
      {business.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={business.logoUrl} alt={business.name} className="mx-auto mb-4 h-12 w-auto" />
      )}
      <TitleTag className="text-center font-heading text-lg font-semibold text-primary">{config?.programName ?? 'Mi tarjeta'}</TitleTag>
      <p className="text-center text-sm text-muted-foreground">Hola, {firstName}</p>

      {config?.isActive === false && (
        <p className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-center text-sm text-warning">
          El programa está pausado por el momento.
        </p>
      )}

      <div className="mt-6 rounded-[var(--radius)] bg-[var(--tenant-brand-soft)] py-8 text-center">
        <div className="text-4xl font-bold text-[var(--tenant-brand-strong)]">{displayBalance(balance)}</div>
        <div className="text-sm text-[var(--tenant-brand-strong)]">{label}</div>
      </div>

      {config?.cardMessage && (
        <p className="mt-4 text-center text-sm text-muted-foreground">{config.cardMessage}</p>
      )}

      {config?.isActive && catalog.length > 0 && (
        <section className="mt-8">
          <SectionTag className="mb-2 text-sm font-semibold text-primary">Canjear puntos</SectionTag>
          <ul className="space-y-2">
            {catalog.map(o => (
              <RedeemButton
                key={o.id}
                optionId={o.id}
                name={o.name}
                pointsCost={o.pointsCost}
                label={label}
                disabled={!canAfford(balance, o.pointsCost ?? 0)}
                redeemAction={redeemAction}
              />
            ))}
          </ul>
        </section>
      )}

      {grants.length > 0 && (
        <section className="mt-8">
          <SectionTag className="mb-2 text-sm font-semibold text-primary">Mis recompensas</SectionTag>
          <ul className="space-y-2">
            {grants.map(g => (
              <li key={g.id} className="rounded-lg bg-[var(--tenant-brand-soft)] px-3 py-2 text-sm">
                <div className="font-medium text-[var(--tenant-brand-strong)]">{g.promotion.name}</div>
                <div>Código: <code className="font-mono text-base">{g.code}</code></div>
                {g.expiresAt && <div className="text-xs text-muted-foreground">Válido hasta {formatShortDate(g.expiresAt)}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingPackages.length > 0 && (
        <section className="mt-8">
          <SectionTag className="mb-2 text-sm font-semibold text-primary">Paquetes por confirmar</SectionTag>
          <ul className="space-y-2">
            {pendingPackages.map(p => (
              <li key={p.id} className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                <div className="font-medium text-warning">{p.productName}</div>
                <div className="text-warning">{p.declared ? 'En verificación' : 'Te falta transferir'}</div>
                <a href={p.resumeUrl} className="inline-flex min-h-11 items-center font-semibold text-warning underline underline-offset-4">
                  {p.declared ? 'Ver estado' : 'Retomar compra'}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {packages.length > 0 && (
        <section className="mt-8">
          <SectionTag className="mb-2 text-sm font-semibold text-primary">Mis paquetes</SectionTag>
          <ul className="space-y-2">
            {packages.map(p => (
              <li key={p.id} className="rounded-lg bg-[var(--tenant-brand-soft)] px-3 py-2 text-sm">
                <div className="font-medium text-[var(--tenant-brand-strong)]">{p.product.name}</div>
                <div>{p._count.grants} sesiones disponibles</div>
                {p.expiresAt && <div className="text-xs text-muted-foreground">Válido hasta {formatShortDate(p.expiresAt)}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {referralUrl && (
        <ReferralShare url={referralUrl} firstName={firstName} vocabulary={vocabulary} titleAs={SectionTag} />
      )}

      <section className="mt-8">
        <SectionTag className="mb-2 text-sm font-semibold text-primary">Movimientos</SectionTag>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no tienes movimientos.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-muted-foreground">
                  {loyaltyReasonLabel(h.reason)}
                  <span className="ml-2 text-muted-foreground/80">
                    {new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short' }).format(h.createdAt)}
                  </span>
                </span>
                <span className={h.points >= 0 ? 'font-medium text-success' : 'font-medium text-muted-foreground'}>
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
