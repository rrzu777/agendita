'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'

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
  const confirmationTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    name: string
    description: string
    action: () => Promise<unknown>
  } | null>(null)

  function execute(
    trigger: HTMLButtonElement,
    name: string,
    confirmation: string,
    action: () => Promise<unknown>,
  ) {
    confirmationTriggerRef.current = trigger
    setPendingAction({ name, description: confirmation, action })
  }

  async function runConfirmedAction() {
    if (!pendingAction) return
    setBusy(pendingAction.name)
    setMessage(null)
    try {
      await pendingAction.action()
      setMessage('Acción completada')
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Error inesperado')
    } finally {
      setBusy(null)
      setPendingAction(null)
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
          <Label htmlFor="billing-plan">Plan mensual <span aria-hidden="true">*</span></Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="billing-plan" className="min-h-11" aria-required="true"><SelectValue placeholder="Selecciona un plan" /></SelectTrigger>
            <SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name} · ${plan.priceMonthly.toLocaleString('es-CL')}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="billing-trial" label="Días de prueba" required>
            {(a11y) => <Input {...a11y} id="billing-trial" className="min-h-11" type="number" min={0} max={365} value={trialDays} onChange={(event) => setTrialDays(event.target.value)} required />}
          </FormField>
          <FormField id="billing-grace" label="Días de gracia" required>
            {(a11y) => <Input {...a11y} id="billing-grace" className="min-h-11" type="number" min={0} max={30} value={graceDays} onChange={(event) => setGraceDays(event.target.value)} required />}
          </FormField>
        </div>
        <Label className="min-h-11 justify-between rounded-md border p-3">Habilitar rollout de cobro <Switch checked={billingEnabled} onCheckedChange={setBillingEnabled} /></Label>
        <Button className="min-h-11 w-full" disabled={busy !== null || !planId} onClick={(event) => execute(
          event.currentTarget,
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
        <FormField id="complimentary-until" label="Vigencia de la exención" required>
          {(a11y) => <Input {...a11y} id="complimentary-until" className="min-h-11" type="date" value={complimentaryUntil} onChange={(event) => setComplimentaryUntil(event.target.value)} required />}
        </FormField>
        <FormField id="complimentary-reason" label="Motivo" required>
          {(a11y) => <Input {...a11y} id="complimentary-reason" className="min-h-11" value={complimentaryReason} onChange={(event) => setComplimentaryReason(event.target.value)} required />}
        </FormField>
        <Button variant="outline" className="min-h-11 w-full" disabled={busy !== null || !complimentaryUntil || !complimentaryReason.trim()} onClick={(event) => execute(
          event.currentTarget,
          'exempt', '¿Asignar o extender esta exención? No se solicitará tarjeta ni se generará un cobro.',
          async () => {
            const { adminSetComplimentaryPeriod } = await import('@/server/actions/admin')
            return adminSetComplimentaryPeriod(businessId, complimentaryUntil, complimentaryReason)
          },
        )}>{busy === 'exempt' ? 'Guardando…' : 'Asignar o extender exención'}</Button>
        {subscription.complimentaryUntil && <>
          <FormField id="complimentary-clear-reason" label="Motivo para retirar" required>
            {(a11y) => <Input {...a11y} id="complimentary-clear-reason" className="min-h-11" value={clearReason} onChange={(event) => setClearReason(event.target.value)} required />}
          </FormField>
          <Button variant="destructive" className="min-h-11 w-full" disabled={busy !== null || !clearReason.trim()} onClick={(event) => execute(
            event.currentTarget,
            'clear', '¿Retirar la exención? Esto no cobrará ni creará un checkout automáticamente.',
            async () => {
              const { adminClearComplimentaryPeriod } = await import('@/server/actions/admin')
              return adminClearComplimentaryPeriod(businessId, clearReason)
            },
          )}>{busy === 'clear' ? 'Retirando…' : 'Retirar exención'}</Button>
        </>}
      </div>

      <Button variant="outline" className="min-h-11 w-full" disabled={busy !== null || !subscription.environment} onClick={(event) => execute(
        event.currentTarget,
        'reconcile', '¿Consultar Mercado Pago y aplicar únicamente el estado autoritativo?',
        async () => {
          const { adminReconcileSubscription } = await import('@/server/actions/admin')
          return adminReconcileSubscription(businessId)
        },
      )}>{busy === 'reconcile' ? 'Reconciliando…' : 'Reconciliar con proveedor'}</Button>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && busy === null) setPendingAction(null) }}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            confirmationTriggerRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirmar acción administrativa</DialogTitle>
            <DialogDescription>{pendingAction?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy !== null}>Volver</Button></DialogClose>
            <Button variant={pendingAction?.name === 'clear' ? 'destructive' : 'default'} disabled={busy !== null || !pendingAction} onClick={runConfirmedAction}>
              {busy !== null ? 'Procesando…' : 'Confirmar acción'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
