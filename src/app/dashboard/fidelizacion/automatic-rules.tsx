'use client'

import { useState, useTransition } from 'react'
import { upsertAutomaticRule, archiveAutomaticRule } from '@/server/actions/loyalty'
import { kindLabels } from '@/lib/loyalty/presets'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { formatMoney } from '@/lib/money'
import { useVocabulary } from '@/components/vocabulary-provider'
import type { Vocabulary } from '@/lib/vocabulary'

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

// Sólo las descripciones viven acá; los nombres salen de kindLabels() para no
// tener dos catálogos del mismo enum que puedan divergir en silencio.
const DESCRIPTIONS = (v: Vocabulary): Record<Kind, string> => ({
  birthday: `Premia a tus ${v.clients} en su cumpleaños.`,
  first_visit: `Premia la primera visita de ${v.aClient}.`,
  review: 'Premia cuando dejan una reseña.',
  anniversary: `Premia al cumplir un año como ${v.client}.`,
  winback: `Premia a ${v.clients} que volvieron tras estar ${v.inactive}.`,
  referral: `Premia cuando ${v.aClient} refiere a alguien nuevo.`,
})

const KIND_ORDER: Kind[] = ['birthday', 'first_visit', 'review', 'anniversary', 'winback', 'referral']

function kindsFor(v: Vocabulary): { kind: Kind; label: string; description: string }[] {
  const labels = kindLabels(v)
  const descriptions = DESCRIPTIONS(v)
  return KIND_ORDER.map((kind) => ({
    kind,
    // "Aniversario (1 año)" sólo en el editor: acá el label es el título de una
    // tarjeta con formulario y el plazo orienta; en el resumen del preset es un
    // ítem de lista y sobra.
    label: kind === 'anniversary' ? `${labels[kind]} (1 año)` : labels[kind],
    description: descriptions[kind],
  }))
}

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
  const vocabulary = useVocabulary()
  const kinds = kindsFor(vocabulary)

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
        {kinds.map(({ kind, label, description }) => (
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
  const vocabulary = useVocabulary()
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
        const res = await upsertAutomaticRule(data, rule?.id)
        if (!res.ok) { setError(res.error); return }
        setSaved(true)
      } catch {
        setError('Error')
      }
    })
  }

  function onArchive() {
    if (!rule) return
    start(async () => {
      try {
        const res = await archiveAutomaticRule(rule.id)
        if (!res.ok) { setError(res.error); return }
        setSaved(false)
      } catch {
        setError('Error')
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
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Tipo de recompensa</legend>
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
        </fieldset>

        {rewardKind === 'points' ? (
          <div className="max-w-xs">
            <FormField id={`${kind}-rewardPoints`} label="Puntos a entregar">
              {(a11y) => (
                <Input
                  {...a11y}
                  id={`${kind}-rewardPoints`}
                  name="rewardPoints"
                  type="number"
                  density="form"
                  min={1}
                  placeholder={`Cantidad de ${pointsLabel}`}
                  defaultValue={rule?.rewardPoints ?? undefined}
                />
              )}
            </FormField>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <FormField id={`${kind}-rewardType`} label="Tipo de beneficio">
                {(a11y) => (
                  <NativeSelect
                    {...a11y}
                    id={`${kind}-rewardType`}
                    name="rewardType"
                    density="form"
                    defaultValue={rule?.rewardType ?? 'percentage'}
                  >
                    <option value="percentage">% de descuento</option>
                    <option value="fixed_amount">Monto fijo</option>
                    <option value="free_service">Servicio gratis</option>
                  </NativeSelect>
                )}
              </FormField>
              <FormField id={`${kind}-rewardValue`} label="Valor del beneficio">
                {(a11y) => (
                  <Input
                    {...a11y}
                    id={`${kind}-rewardValue`}
                    name="rewardValue"
                    type="number"
                    density="form"
                    defaultValue={rule?.rewardValue}
                  />
                )}
              </FormField>
              <FormField id={`${kind}-maxDiscount`} label={`Tope de descuento (${currency})`}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    id={`${kind}-maxDiscount`}
                    name="maxDiscount"
                    type="number"
                    density="form"
                    defaultValue={rule?.maxDiscount ?? undefined}
                  />
                )}
              </FormField>
              <FormField id={`${kind}-grantExpiryDays`} label="Vigencia de la recompensa" help="Opcional, en días.">
                {(a11y) => (
                  <Input
                    {...a11y}
                    id={`${kind}-grantExpiryDays`}
                    name="grantExpiryDays"
                    type="number"
                    density="form"
                    min={1}
                    defaultValue={rule?.grantExpiryDays ?? undefined}
                  />
                )}
              </FormField>
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
          <div className="max-w-xs">
            <FormField
              id={`${kind}-windowDays`}
              label={kind === 'birthday' ? 'Ventana de cumpleaños' : 'Ventana de aniversario'}
              help="Cantidad de días antes y después de la fecha."
            >
              {(a11y) => (
                <Input
                  {...a11y}
                  id={`${kind}-windowDays`}
                  name="windowDays"
                  type="number"
                  density="form"
                  min={0}
                  max={60}
                  defaultValue={cond.windowDays ?? undefined}
                />
              )}
            </FormField>
          </div>
        )}
        {kind === 'winback' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${kind}-inactivityDays`} label="Días de inactividad">
              {(a11y) => (
                <Input {...a11y} id={`${kind}-inactivityDays`} name="inactivityDays" type="number" density="form" min={1} defaultValue={cond.inactivityDays ?? undefined} />
              )}
            </FormField>
            <FormField id={`${kind}-cooldownDays`} label="Días de espera" help="Opcional.">
              {(a11y) => (
                <Input {...a11y} id={`${kind}-cooldownDays`} name="cooldownDays" type="number" density="form" min={0} defaultValue={cond.cooldownDays ?? undefined} />
              )}
            </FormField>
          </div>
        )}
        {kind === 'referral' && (
          <div className="max-w-sm">
            <FormField id={`${kind}-beneficiary`} label="Quién recibe la recompensa">
              {(a11y) => (
                <NativeSelect {...a11y} id={`${kind}-beneficiary`} name="beneficiary" density="form" defaultValue={cond.beneficiary ?? 'both'}>
                  <option value="both">{vocabulary.bothParties} ({vocabulary.referrerNoun} y {vocabulary.referredNoun})</option>
                  <option value="referrer">Solo {vocabulary.referrer}</option>
                  <option value="referred">Solo {vocabulary.referredPerson}</option>
                </NativeSelect>
              )}
            </FormField>
          </div>
        )}

        {/* Comunes */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id={`${kind}-priority`} label="Prioridad" help="Mayor número, mayor prioridad.">
            {(a11y) => (
              <Input {...a11y} id={`${kind}-priority`} name="priority" type="number" density="form" min={0} max={1000} defaultValue={rule?.priority ?? 0} />
            )}
          </FormField>
          <FormField id={`${kind}-maxPerCustomer`} label={`Tope por ${vocabulary.client}`} help="Opcional.">
            {(a11y) => (
              <Input {...a11y} id={`${kind}-maxPerCustomer`} name="maxPerCustomer" type="number" density="form" min={1} defaultValue={rule?.maxPerCustomer ?? undefined} />
            )}
          </FormField>
        </div>
      </div>

      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {saved && <p aria-live="polite" className="mt-2 text-sm text-green-600">Guardado.</p>}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="form" disabled={isPending}>
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
