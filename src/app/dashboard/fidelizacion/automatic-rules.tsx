'use client'

import { useState, useTransition } from 'react'
import { upsertAutomaticRule, archiveAutomaticRule } from '@/server/actions/loyalty'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'

type Service = { id: string; name: string; price: number }

/** Cada regla viene del server como una Promotion automatic (con sus services y
 *  el JSON `conditions`). El `kind` y los parámetros por kind viven en conditions. */
type Conditions = {
  kind?: string
  windowDays?: number
  inactivityDays?: number
  cooldownDays?: number
  beneficiary?: 'both' | 'referrer' | 'referred'
}

type Rule = {
  id: string
  isActive: boolean
  priority: number
  rewardType: string | null
  rewardValue: number
  rewardPoints: number | null
  maxDiscount: number | null
  appliesToAll: boolean
  grantExpiryDays: number | null
  maxPerCustomer: number | null
  conditions: unknown
  services: { id: string; name: string }[]
}

type Kind = 'birthday' | 'first_visit' | 'review' | 'anniversary' | 'winback' | 'referral'

const KINDS: { kind: Kind; label: string; description: string }[] = [
  { kind: 'birthday', label: 'Cumpleaños', description: 'Premia a tus clientas en su cumpleaños.' },
  { kind: 'first_visit', label: 'Primera visita', description: 'Premia la primera visita de una clienta.' },
  { kind: 'review', label: 'Reseña', description: 'Premia cuando dejan una reseña.' },
  { kind: 'anniversary', label: 'Aniversario (1 año)', description: 'Premia al cumplir un año como clienta.' },
  { kind: 'winback', label: 'Reactivar inactivas', description: 'Premia a clientas que volvieron tras estar inactivas.' },
  { kind: 'referral', label: 'Referidas', description: 'Premia cuando una clienta refiere a alguien nuevo.' },
]

/** Lee un campo numérico opcional del form: vacío/ausente => null. */
const optNum = (v: FormDataEntryValue | null): number | null => (v ? Number(v) : null)

function conditionsOf(rule: Rule): Conditions {
  return (rule.conditions as Conditions) ?? {}
}

/** Deriva la rama de recompensa de una regla persistida: con rewardPoints => puntos. */
function rewardKindOf(rule: Rule): 'points' | 'grant' {
  return rule.rewardPoints != null ? 'points' : 'grant'
}

export function AutomaticRules({
  rules,
  services,
  pointsLabel,
  currency,
}: {
  rules: Rule[]
  services: Service[]
  pointsLabel: string
  currency: string
}) {
  const byKind = new Map<string, Rule>()
  for (const r of rules) {
    const k = conditionsOf(r).kind
    if (k && !byKind.has(k)) byKind.set(k, r)
  }

  return (
    <section className="studio-card mt-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Reglas automáticas</h3>
      <p className="text-sm text-muted-foreground">
        Recompensas que se entregan solas cuando se cumple una condición.
      </p>

      <div className="mt-4 grid gap-4">
        {KINDS.map(({ kind, label, description }) => (
          <RuleCard
            key={kind}
            kind={kind}
            label={label}
            description={description}
            rule={byKind.get(kind) ?? null}
            services={services}
            pointsLabel={pointsLabel}
            currency={currency}
          />
        ))}
      </div>
    </section>
  )
}

function RuleCard({
  kind,
  label,
  description,
  rule,
  services,
  pointsLabel,
  currency,
}: {
  kind: Kind
  label: string
  description: string
  rule: Rule | null
  services: Service[]
  pointsLabel: string
  currency: string
}) {
  const [isPending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const cond = rule ? conditionsOf(rule) : {}
  const [rewardKind, setRewardKind] = useState<'points' | 'grant'>(
    rule ? rewardKindOf(rule) : 'points',
  )

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const form = e.currentTarget
    const fd = new FormData(form)
    const appliesToAll = fd.get('appliesToAll') === 'on'
    const data = {
      kind,
      isActive: fd.get('isActive') === 'on',
      priority: Number(fd.get('priority') ?? 0),
      rewardKind,
      rewardPoints: optNum(fd.get('rewardPoints')),
      rewardType: String(fd.get('rewardType') ?? 'percentage'),
      rewardValue: Number(fd.get('rewardValue') ?? 0),
      maxDiscount: optNum(fd.get('maxDiscount')),
      appliesToAll,
      serviceIds: appliesToAll
        ? []
        : services.filter((s) => fd.get(`svc_${s.id}`) === 'on').map((s) => s.id),
      grantExpiryDays: optNum(fd.get('grantExpiryDays')),
      maxPerCustomer: optNum(fd.get('maxPerCustomer')),
      windowDays: optNum(fd.get('windowDays')) ?? 0,
      inactivityDays: optNum(fd.get('inactivityDays')) ?? 0,
      cooldownDays: optNum(fd.get('cooldownDays')) ?? 0,
      beneficiary: String(fd.get('beneficiary') ?? 'both'),
    }
    start(async () => {
      try {
        await upsertAutomaticRule(data, rule?.id)
        setSaved(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  function onArchive() {
    if (!rule) return
    start(async () => {
      try {
        await archiveAutomaticRule(rule.id)
        setSaved(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-border p-4"
      key={rule?.id ?? `new-${kind}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="font-medium text-foreground">{label}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={rule?.isActive ?? false}
            className="size-4"
          />
          Activar
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        {/* Selector de recompensa */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`rewardKind-${kind}`}
              checked={rewardKind === 'points'}
              onChange={() => setRewardKind('points')}
              className="size-4"
            />
            {pointsLabel}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`rewardKind-${kind}`}
              checked={rewardKind === 'grant'}
              onChange={() => setRewardKind('grant')}
              className="size-4"
            />
            Recompensa
          </label>
        </div>

        {rewardKind === 'points' ? (
          <Input
            name="rewardPoints"
            type="number"
            min={1}
            placeholder={`Cantidad de ${pointsLabel}`}
            defaultValue={rule?.rewardPoints ?? undefined}
            className="w-48"
          />
        ) : (
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <select
                name="rewardType"
                defaultValue={rule?.rewardType ?? 'percentage'}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                <option value="percentage">% de descuento</option>
                <option value="fixed_amount">Monto fijo</option>
                <option value="free_service">Servicio gratis</option>
              </select>
              <Input
                name="rewardValue"
                type="number"
                placeholder="Valor"
                defaultValue={rule?.rewardValue}
                className="w-28"
              />
              <Input
                name="maxDiscount"
                type="number"
                placeholder={`Tope desc. (${currency})`}
                defaultValue={rule?.maxDiscount ?? undefined}
                className="w-40"
              />
              <Input
                name="grantExpiryDays"
                type="number"
                min={1}
                placeholder="Días vencimiento (opc.)"
                defaultValue={rule?.grantExpiryDays ?? undefined}
                className="w-44"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="appliesToAll"
                defaultChecked={rule?.appliesToAll ?? true}
                className="size-4"
              />
              Aplica a todos los servicios
            </label>
            {services.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Servicios específicos
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {services.map((s) => (
                    <label key={s.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`svc_${s.id}`}
                        defaultChecked={rule?.services.some((es) => es.id === s.id)}
                        className="size-4"
                      />
                      {s.name} · {formatMoney(s.price, currency)}
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Parámetros por kind */}
        {(kind === 'birthday' || kind === 'anniversary') && (
          <Input
            name="windowDays"
            type="number"
            min={0}
            max={60}
            placeholder="Ventana ± días"
            defaultValue={cond.windowDays ?? undefined}
            className="w-44"
          />
        )}
        {kind === 'winback' && (
          <div className="flex flex-wrap gap-2">
            <Input
              name="inactivityDays"
              type="number"
              min={1}
              placeholder="Días de inactividad"
              defaultValue={cond.inactivityDays ?? undefined}
              className="w-44"
            />
            <Input
              name="cooldownDays"
              type="number"
              min={0}
              placeholder="Días de espera (opc.)"
              defaultValue={cond.cooldownDays ?? undefined}
              className="w-44"
            />
          </div>
        )}
        {kind === 'referral' && (
          <select
            name="beneficiary"
            defaultValue={cond.beneficiary ?? 'both'}
            className="w-56 rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="both">Ambas (referidora y referida)</option>
            <option value="referrer">Solo la referidora</option>
            <option value="referred">Solo la referida</option>
          </select>
        )}

        {/* Comunes */}
        <div className="flex flex-wrap gap-2">
          <Input
            name="priority"
            type="number"
            min={0}
            max={1000}
            placeholder="Prioridad"
            defaultValue={rule?.priority ?? 0}
            className="w-32"
          />
          <Input
            name="maxPerCustomer"
            type="number"
            min={1}
            placeholder="Tope por clienta (opc.)"
            defaultValue={rule?.maxPerCustomer ?? undefined}
            className="w-48"
          />
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {saved && <p className="mt-2 text-sm text-green-600">Guardado.</p>}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {rule ? 'Guardar cambios' : 'Crear regla'}
        </Button>
        {rule?.isActive && (
          <Button type="button" size="sm" variant="ghost" onClick={onArchive} disabled={isPending}>
            Desactivar
          </Button>
        )}
      </div>
    </form>
  )
}
