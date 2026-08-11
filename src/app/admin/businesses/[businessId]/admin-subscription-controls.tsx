'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

type SubscriptionSummary = {
  status: string
  environment: string | null
  trialDays: number
  trialEndAt: string | null
  graceDays: number
  pastDueAt: string | null
  graceEndsAt: string | null
  complimentaryUntil: string | null
  complimentaryReason: string | null
  nextBillingAt: string | null
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string
  lastReconciledAt: string | null
  billingEnabled: boolean
  planId: string
}

interface Props {
  businessId: string
  timezone: string
  plans: Array<{ id: string; name: string; priceMonthly: number }>
  subscription: SubscriptionSummary | null
}

function dateLabel(value: string | null, timezone: string) {
  return value
    ? new Date(value).toLocaleString('es-CL', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })
    : '—'
}

export function AdminSubscriptionControls({ businessId, timezone, plans, subscription }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [planId, setPlanId] = useState(subscription?.planId ?? plans[0]?.id ?? '')
  const [trialDays, setTrialDays] = useState(String(subscription?.trialDays ?? 30))
  const [graceDays, setGraceDays] = useState(String(subscription?.graceDays ?? 7))
  const [billingEnabled, setBillingEnabled] = useState(subscription?.billingEnabled ?? false)
  const [complimentaryUntil, setComplimentaryUntil] = useState('')
  const [complimentaryReason, setComplimentaryReason] = useState('')
  const [clearReason, setClearReason] = useState('')

  async function execute(name: string, confirmation: string, action: () => Promise<unknown>) {
    if (!window.confirm(confirmation)) return
    setBusy(name)
    setMessage(null)
    try {
      await action()
      setMessage('Acción completada')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Error inesperado')
    } finally {
      setBusy(null)
    }
  }

  if (!subscription) {
    return <p className="text-sm text-muted-foreground">Este negocio no tiene una suscripción configurable.</p>
  }

  return (
    <div className="space-y-6">
      {message && <p role="status" className="rounded-md bg-muted p-3 text-sm">{message}</p>}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Estado local</dt><dd className="font-medium">{subscription.status}</dd></div>
        <div><dt className="text-muted-foreground">Ambiente</dt><dd className="font-medium">{subscription.environment ?? 'Manual / sin conectar'}</dd></div>
        <div><dt className="text-muted-foreground">Fin de trial</dt><dd>{dateLabel(subscription.trialEndAt, timezone)}</dd></div>
        <div><dt className="text-muted-foreground">Exención</dt><dd>{dateLabel(subscription.complimentaryUntil, timezone)}</dd></div>
        <div><dt className="text-muted-foreground">Mora / fin de gracia</dt><dd>{dateLabel(subscription.pastDueAt, timezone)} / {dateLabel(subscription.graceEndsAt, timezone)}</dd></div>
        <div><dt className="text-muted-foreground">Próximo cobro</dt><dd>{dateLabel(subscription.nextBillingAt, timezone)}</dd></div>
        <div><dt className="text-muted-foreground">Cancelación</dt><dd>{subscription.cancelAtPeriodEnd ? `Al cierre (${dateLabel(subscription.currentPeriodEnd, timezone)})` : 'No solicitada'}</dd></div>
        <div><dt className="text-muted-foreground">Última reconciliación</dt><dd>{dateLabel(subscription.lastReconciledAt, timezone)}</dd></div>
      </dl>

      <div className="space-y-3 border-t pt-4">
        <p className="font-semibold">Configuración de facturación</p>
        <div className="space-y-2">
          <Label>Plan mensual</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger><SelectValue placeholder="Selecciona un plan" /></SelectTrigger>
            <SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name} · ${plan.priceMonthly.toLocaleString('es-CL')}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label htmlFor="billing-trial">Días de trial</Label><Input id="billing-trial" type="number" min={0} max={365} value={trialDays} onChange={(event) => setTrialDays(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="billing-grace">Días de gracia</Label><Input id="billing-grace" type="number" min={0} max={30} value={graceDays} onChange={(event) => setGraceDays(event.target.value)} /></div>
        </div>
        <Label className="justify-between rounded-md border p-3">Habilitar rollout de cobro <Switch checked={billingEnabled} onCheckedChange={setBillingEnabled} /></Label>
        <Button className="w-full" disabled={busy !== null || !planId} onClick={() => execute(
          'configure',
          `¿Guardar esta configuración${billingEnabled ? ' y habilitar el rollout' : ''}? Esto no realizará un cobro.`,
          async () => {
            const { adminConfigureBilling } = await import('@/server/actions/admin')
            return adminConfigureBilling(businessId, { planId, trialDays: Number(trialDays), graceDays: Number(graceDays), billingEnabled })
          },
        )}>{busy === 'configure' ? 'Guardando…' : 'Guardar configuración'}</Button>
      </div>

      <div className="space-y-3 border-t pt-4">
        <p className="font-semibold">Exención family & friends</p>
        {subscription.complimentaryReason && <p className="text-sm text-muted-foreground">Motivo actual: {subscription.complimentaryReason}</p>}
        <Input type="date" value={complimentaryUntil} onChange={(event) => setComplimentaryUntil(event.target.value)} />
        <Input placeholder="Motivo obligatorio" value={complimentaryReason} onChange={(event) => setComplimentaryReason(event.target.value)} />
        <Button variant="outline" className="w-full" disabled={busy !== null || !complimentaryUntil || !complimentaryReason.trim()} onClick={() => execute(
          'exempt', '¿Asignar o extender esta exención? No se solicitará tarjeta ni se generará un cobro.',
          async () => {
            const { adminSetComplimentaryPeriod } = await import('@/server/actions/admin')
            return adminSetComplimentaryPeriod(businessId, new Date(`${complimentaryUntil}T23:59:59.999Z`), complimentaryReason)
          },
        )}>{busy === 'exempt' ? 'Guardando…' : 'Asignar o extender exención'}</Button>
        {subscription.complimentaryUntil && <>
          <Input placeholder="Motivo para retirar" value={clearReason} onChange={(event) => setClearReason(event.target.value)} />
          <Button variant="destructive" className="w-full" disabled={busy !== null || !clearReason.trim()} onClick={() => execute(
            'clear', '¿Retirar la exención? Esto no cobrará ni creará un checkout automáticamente.',
            async () => {
              const { adminClearComplimentaryPeriod } = await import('@/server/actions/admin')
              return adminClearComplimentaryPeriod(businessId, clearReason)
            },
          )}>{busy === 'clear' ? 'Retirando…' : 'Retirar exención'}</Button>
        </>}
      </div>

      <Button variant="outline" className="w-full" disabled={busy !== null || !subscription.environment} onClick={() => execute(
        'reconcile', '¿Consultar Mercado Pago y aplicar únicamente el estado autoritativo?',
        async () => {
          const { adminReconcileSubscription } = await import('@/server/actions/admin')
          return adminReconcileSubscription(businessId)
        },
      )}>{busy === 'reconcile' ? 'Reconciliando…' : 'Reconciliar con proveedor'}</Button>
    </div>
  )
}
