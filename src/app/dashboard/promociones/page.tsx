import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Ticket } from 'lucide-react'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { listPromotions } from '@/server/actions/promotions'
import { getServices } from '@/server/actions/services'
import { formatMoney } from '@/lib/money'
import { PromotionForm } from './promotion-form'
import { RedemptionsButton } from './redemptions-button'
import { PromotionToggle } from './promotion-toggle'

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

const statusColors: Record<PromoStatus, string> = {
  Activa: 'bg-green-100 text-green-800',
  Programada: 'bg-blue-100 text-blue-800',
  Vencida: 'bg-muted text-muted-foreground',
  Agotada: 'bg-orange-100 text-orange-800',
  Inactiva: 'bg-muted text-muted-foreground',
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

        <div className="studio-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Nombre</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Recompensa</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Usos</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center">
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
                  </TableCell>
                </TableRow>
              ) : (
                promos.map((promo) => {
                  const status = derivePromoStatus(promo, now)
                  const scope = promo.appliesToAll
                    ? 'Todos los servicios'
                    : `${promo.services.length} servicio${promo.services.length === 1 ? '' : 's'}`
                  return (
                    <TableRow key={promo.id}>
                      <TableCell className="font-semibold text-primary">
                        {promo.name}
                        {promo.description && (
                          <div className="text-xs font-normal text-muted-foreground line-clamp-1">{promo.description}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {promo.code ? (
                          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs font-semibold text-foreground">
                            {promo.code}
                          </span>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>{formatReward(promo, currency)}</TableCell>
                      <TableCell>{scope}</TableCell>
                      <TableCell>
                        {promo.redemptionCount} / {promo.maxRedemptions ?? '∞'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatVigencia(promo)}</TableCell>
                      <TableCell>
                        <Badge className={statusColors[status]}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <PromotionForm
                            mode="edit"
                            services={serviceOptions}
                            currency={currency}
                            promo={{
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
                            }}
                          />
                          <PromotionToggle id={promo.id} isActive={promo.isActive} />
                          <RedemptionsButton
                            promotionId={promo.id}
                            promotionName={promo.name}
                            currency={currency}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
