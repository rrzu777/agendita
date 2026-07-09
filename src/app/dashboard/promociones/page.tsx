import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { StatusBadge } from '@/components/ui/status-badge'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { Ticket } from 'lucide-react'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { listPromotions } from '@/server/actions/promotions'
import { getServices } from '@/server/actions/services'
import { formatMoney } from '@/lib/money'
import { PromotionForm, type EditPromo } from './promotion-form'
import { PromotionRowActions } from './promotion-row-actions'

type Promo = Awaited<ReturnType<typeof listPromotions>>[number]
type PromoStatus = 'Inactiva' | 'Programada' | 'Vencida' | 'Agotada' | 'Activa'

// Estado derivado (no persistido). El orden importa: una promo inactiva se
// muestra como tal aunque también esté vencida; agotada gana sobre activa.
function derivePromoStatus(promo: Promo, now: Date): PromoStatus {
  if (!promo.isActive) return 'Inactiva'
  if (promo.validFrom && now < promo.validFrom) return 'Programada'
  if (promo.validUntil && now > promo.validUntil) return 'Vencida'
  if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) return 'Agotada'
  return 'Activa'
}

function formatReward(promo: Promo, currency: string): string {
  if (promo.rewardType === 'free_service') return 'Servicio gratis'
  if (promo.rewardType === 'percentage') return `${promo.rewardValue}%`
  return formatMoney(promo.rewardValue, currency)
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatVigencia(promo: Promo): string {
  if (!promo.validFrom && !promo.validUntil) return 'Sin límite'
  const from = promo.validFrom ? formatDate(promo.validFrom) : '…'
  const until = promo.validUntil ? formatDate(promo.validUntil) : '…'
  return `${from} – ${until}`
}

function scopeLabel(promo: Promo): string {
  return promo.appliesToAll
    ? 'Todos los servicios'
    : `${promo.services.length} servicio${promo.services.length === 1 ? '' : 's'}`
}

function toEditPromo(promo: Promo): EditPromo {
  return {
    id: promo.id,
    name: promo.name,
    description: promo.description,
    code: promo.code,
    rewardType: promo.rewardType,
    rewardValue: promo.rewardValue,
    maxDiscount: promo.maxDiscount,
    appliesToAll: promo.appliesToAll,
    serviceIds: promo.services.map((s) => s.id),
    validFrom: promo.validFrom ? promo.validFrom.toISOString().slice(0, 10) : null,
    validUntil: promo.validUntil ? promo.validUntil.toISOString().slice(0, 10) : null,
    minSpend: promo.minSpend,
    maxRedemptions: promo.maxRedemptions,
    maxPerCustomer: promo.maxPerCustomer,
    redemptionCount: promo.redemptionCount,
    isActive: promo.isActive,
  }
}

export default async function PromocionesPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const currency = userData.business.currency

  let promos: Promo[] = []
  let services: Awaited<ReturnType<typeof getServices>> = []

  try {
    promos = await listPromotions()
    services = await getServices()
  } catch {
    // Auth error fallback
  }

  const serviceOptions = services.map((s) => ({ id: s.id, name: s.name }))
  const now = new Date()
  const rows = promos.map((promo) => ({
    promo,
    status: derivePromoStatus(promo, now),
    scope: scopeLabel(promo),
    editPromo: toEditPromo(promo),
  }))

  return (
    <div>
      <DashboardHeader
        title="Promociones"
        subtitle="Crea y administra códigos de descuento para tus clientes."
      />
      <div className="p-5 md:p-10">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary">Tus promociones</h2>
            <p className="text-sm text-muted-foreground">Descuentos por código, vigencias y límites de uso.</p>
          </div>
          <PromotionForm mode="create" services={serviceOptions} currency={currency} />
        </div>

        {promos.length === 0 ? (
          <div className="studio-card overflow-hidden py-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                <Ticket className="size-7 text-muted-foreground" />
              </div>
              <div>
                <p className="mb-1 font-heading text-base font-semibold text-primary">No hay promociones</p>
                <p className="text-sm text-muted-foreground">
                  Crea tu primera promoción para ofrecer descuentos a tus clientes.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="hidden lg:block studio-card overflow-hidden">
              <Table fixed className={TABLE_MIN_WIDTH}>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Nombre</TableHead>
                    <TableHead className={TABLE_COL.code}>Código</TableHead>
                    <TableHead className="w-[140px]">Recompensa</TableHead>
                    <TableHead className="w-[140px]">Alcance</TableHead>
                    <TableHead className={TABLE_COL.uses}>Usos</TableHead>
                    <TableHead className="w-[160px]">Vigencia</TableHead>
                    <TableHead className={TABLE_COL.status}>Estado</TableHead>
                    <TableHead className={`${TABLE_COL.actions} text-right`}>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ promo, status, scope, editPromo }) => (
                    <TableRow key={promo.id}>
                      <TruncatedCell
                        className="font-semibold text-primary"
                        primary={promo.name}
                        secondary={promo.description}
                      />
                      <TableCell className={TABLE_COL.code}>
                        {promo.code ? (
                          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs font-semibold text-foreground">
                            {promo.code}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="w-[140px]">{formatReward(promo, currency)}</TableCell>
                      <TableCell className="w-[140px]">{scope}</TableCell>
                      <TableCell className={TABLE_COL.uses}>
                        {promo.redemptionCount} / {promo.maxRedemptions ?? '∞'}
                      </TableCell>
                      <TableCell className="w-[160px] whitespace-nowrap text-sm">{formatVigencia(promo)}</TableCell>
                      <TableCell className={TABLE_COL.status}>
                        <StatusBadge map="promo" status={status} />
                      </TableCell>
                      <TableCell className={`${TABLE_COL.actions} text-right`}>
                        <PromotionRowActions promo={editPromo} services={serviceOptions} currency={currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 lg:hidden">
              {rows.map(({ promo, status, scope, editPromo }) => (
                <TableMobileCard
                  key={promo.id}
                  title={promo.name}
                  subtitle={promo.description}
                  badge={<StatusBadge map="promo" status={status} />}
                  rows={[
                    { label: 'Código', value: promo.code ?? '—' },
                    { label: 'Recompensa', value: formatReward(promo, currency) },
                    { label: 'Alcance', value: scope },
                    { label: 'Usos', value: `${promo.redemptionCount} / ${promo.maxRedemptions ?? '∞'}` },
                    { label: 'Vigencia', value: formatVigencia(promo) },
                  ]}
                  actions={<PromotionRowActions promo={editPromo} services={serviceOptions} currency={currency} />}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
