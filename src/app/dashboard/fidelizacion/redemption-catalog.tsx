'use client'

import { useState, useTransition } from 'react'
import { upsertRedemptionOption, archiveRedemptionOption } from '@/server/actions/loyalty'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { formatMoney } from '@/lib/money'
import { useVocabulary } from '@/components/vocabulary-provider'

type Service = { id: string; name: string; price: number }
type RedemptionOption = {
  id: string
  name: string
  rewardType: string
  rewardValue: number
  maxDiscount: number | null
  pointsCost: number | null
  appliesToAll: boolean
  grantExpiryDays: number | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
  isActive: boolean
  services: { id: string; name: string }[]
}

/** Lee un campo numérico opcional del form: vacío/ausente => null. */
const optNum = (v: FormDataEntryValue | null): number | null => (v ? Number(v) : null)

function rewardSummary(o: RedemptionOption, currency: string): string {
  if (o.rewardType === 'fixed_amount') {
    return formatMoney(o.rewardValue, currency)
  }
  if (o.rewardType === 'percentage') {
    const base = `${o.rewardValue}%`
    return o.maxDiscount ? `${base} (tope ${formatMoney(o.maxDiscount, currency)})` : base
  }
  return 'Servicio gratis'
}

export function RedemptionCatalog({
  options,
  services,
}: {
  options: RedemptionOption[]
  services: Service[]
}) {
  const vocabulary = useVocabulary()
  const [isPending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<RedemptionOption | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = e.currentTarget
    const fd = new FormData(form)
    const appliesToAll = fd.get('appliesToAll') === 'on'
    const data = {
      name: String(fd.get('name') ?? ''),
      rewardType: String(fd.get('rewardType') ?? 'free_service'),
      rewardValue: Number(fd.get('rewardValue') ?? 0),
      maxDiscount: optNum(fd.get('maxDiscount')),
      pointsCost: Number(fd.get('pointsCost') ?? 0),
      appliesToAll,
      serviceIds: appliesToAll
        ? []
        : services.filter((s) => fd.get(`svc_${s.id}`) === 'on').map((s) => s.id),
      grantExpiryDays: optNum(fd.get('grantExpiryDays')),
      maxRedemptions: optNum(fd.get('maxRedemptions')),
      maxPerCustomer: optNum(fd.get('maxPerCustomer')),
      isActive: fd.get('isActive') === 'on',
    }
    start(async () => {
      try {
        const res = await upsertRedemptionOption(data, editing?.id)
        if (!res.ok) { setError(res.error); return }
        form.reset()
        setEditing(null)
      } catch {
        setError('Error')
      }
    })
  }

  function onArchive(id: string) {
    start(async () => {
      try {
        const res = await archiveRedemptionOption(id)
        if (!res.ok) { setError(res.error); return }
      } catch {
        setError('Error')
      }
    })
  }

  // Determine currency from first service price (CLP by default)
  const currency = 'CLP'

  return (
    <section className="studio-card mt-6 p-4">
      <h3 className="text-lg font-semibold text-primary">Catálogo de canje</h3>
      <p className="text-sm text-muted-foreground">
        Define qué recompensas pueden canjear tus {vocabulary.clients} con sus puntos.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {options.map((o) => (
          <li key={o.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              <span className="font-medium">{o.name}</span>{' '}
              <span className="text-muted-foreground">
                · {o.pointsCost} pts · {rewardSummary(o, currency)}
              </span>
              {!o.isActive && (
                <span className="ml-2 text-xs text-muted-foreground">(archivada)</span>
              )}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(o)}
                disabled={isPending}
              >
                Editar
              </Button>
              {o.isActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onArchive(o.id)}
                  disabled={isPending}
                >
                  Archivar
                </Button>
              )}
            </span>
          </li>
        ))}
        {options.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">Todavía no hay recompensas.</li>
        )}
      </ul>

      <form onSubmit={onSubmit} className="mt-4 grid gap-4" key={editing?.id ?? 'new'}>
        <FormField id="redemption-name" label="Nombre de la recompensa" required>
          {(a11y) => (
            <Input {...a11y} id="redemption-name" name="name" density="form" defaultValue={editing?.name} required />
          )}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField id="redemption-rewardType" label="Tipo de beneficio">
            {(a11y) => (
              <NativeSelect {...a11y} id="redemption-rewardType" name="rewardType" density="form" defaultValue={editing?.rewardType ?? 'free_service'}>
                <option value="free_service">Servicio gratis</option>
                <option value="percentage">% de descuento</option>
                <option value="fixed_amount">Monto fijo</option>
              </NativeSelect>
            )}
          </FormField>
          <FormField id="redemption-rewardValue" label="Valor del beneficio">
            {(a11y) => (
              <Input {...a11y} id="redemption-rewardValue" name="rewardValue" type="number" density="form" defaultValue={editing?.rewardValue} />
            )}
          </FormField>
          <FormField id="redemption-pointsCost" label="Costo en puntos" required>
            {(a11y) => (
              <Input {...a11y} id="redemption-pointsCost" name="pointsCost" type="number" density="form" min={1} defaultValue={editing?.pointsCost ?? undefined} required />
            )}
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FormField id="redemption-maxDiscount" label="Tope de descuento" help="Opcional.">
            {(a11y) => (
              <Input {...a11y} id="redemption-maxDiscount" name="maxDiscount" type="number" density="form" defaultValue={editing?.maxDiscount ?? undefined} />
            )}
          </FormField>
          <FormField id="redemption-grantExpiryDays" label="Vigencia" help="Opcional, en días.">
            {(a11y) => (
              <Input {...a11y} id="redemption-grantExpiryDays" name="grantExpiryDays" type="number" density="form" min={1} defaultValue={editing?.grantExpiryDays ?? undefined} />
            )}
          </FormField>
          <FormField id="redemption-maxRedemptions" label="Stock total" help="Opcional.">
            {(a11y) => (
              <Input {...a11y} id="redemption-maxRedemptions" name="maxRedemptions" type="number" density="form" min={1} defaultValue={editing?.maxRedemptions ?? undefined} />
            )}
          </FormField>
          <FormField id="redemption-maxPerCustomer" label={`Tope por ${vocabulary.client}`} help="Opcional.">
            {(a11y) => (
              <Input {...a11y} id="redemption-maxPerCustomer" name="maxPerCustomer" type="number" density="form" min={1} defaultValue={editing?.maxPerCustomer ?? undefined} />
            )}
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="appliesToAll"
            defaultChecked={editing?.appliesToAll ?? true}
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
                    defaultChecked={editing?.services.some((es) => es.id === s.id)}
                    className="size-4"
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </details>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={editing?.isActive ?? true}
            className="size-4"
          />
          Activa
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" size="form" disabled={isPending}>
            {editing ? 'Guardar cambios' : 'Agregar recompensa'}
          </Button>
          {editing && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(null)}
            >
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
