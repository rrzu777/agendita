'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { RewardFields } from '@/components/dashboard/reward-fields'
import { createPromotion, updatePromotion } from '@/server/actions/promotions'
import { computeDiscount } from '@/lib/promotions/evaluate'
import { formatMoney } from '@/lib/money'
import type { RewardType } from '@/lib/rewards/schema'

interface ServiceOption {
  id: string
  name: string
}

export interface EditPromo {
  id: string
  name: string
  description: string | null
  code: string | null
  rewardType: RewardType
  rewardValue: number
  maxDiscount: number | null
  appliesToAll: boolean
  serviceIds: string[]
  validFrom: string | null
  validUntil: string | null
  minSpend: number | null
  maxRedemptions: number | null
  maxPerCustomer: number | null
  redemptionCount: number
  isActive: boolean
}

interface FormState {
  name: string
  description: string
  code: string
  rewardType: RewardType
  rewardValue: string
  maxDiscount: string
  appliesToAll: boolean
  serviceIds: string[]
  validFrom: string
  validUntil: string
  minSpend: string
  maxRedemptions: string
  maxPerCustomer: string
}

function emptyState(): FormState {
  return {
    name: '',
    description: '',
    code: '',
    rewardType: 'percentage',
    rewardValue: '',
    maxDiscount: '',
    appliesToAll: true,
    serviceIds: [],
    validFrom: '',
    validUntil: '',
    minSpend: '',
    maxRedemptions: '',
    maxPerCustomer: '',
  }
}

function stateFromPromo(p: EditPromo): FormState {
  return {
    name: p.name,
    description: p.description ?? '',
    code: p.code ?? '',
    rewardType: p.rewardType,
    rewardValue: p.rewardType === 'free_service' ? '' : String(p.rewardValue),
    maxDiscount: p.maxDiscount != null ? String(p.maxDiscount) : '',
    appliesToAll: p.appliesToAll,
    serviceIds: p.serviceIds,
    validFrom: p.validFrom ?? '',
    validUntil: p.validUntil ?? '',
    minSpend: p.minSpend != null ? String(p.minSpend) : '',
    maxRedemptions: p.maxRedemptions != null ? String(p.maxRedemptions) : '',
    maxPerCustomer: p.maxPerCustomer != null ? String(p.maxPerCustomer) : '',
  }
}

// '' -> null; números enteros para los campos de plata/límites.
function toIntOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * Crear o editar. El modo se DERIVA de la promoción: sin promoción, es nueva.
 *
 * Antes eran dos props independientes —`mode: 'create' | 'edit'` y
 * `promo?: EditPromo`—, o sea que `mode="edit"` sin `promo` compilaba. En ese
 * estado el diálogo decía "Editar promoción" y el botón "Guardar cambios", pero
 * el submit caía en el `: createPromotion(payload)` del ternario: la dueña
 * apretaba Editar, no veía ningún error, y se creaba una promoción DUPLICADA.
 *
 * La cura no es correlacionar las dos props: es que la segunda no exista. Un
 * solo dato no se puede contradecir consigo mismo. Es lo que ya hacen
 * `professional-form` y `service-form`.
 */
export function PromotionForm({
  services,
  currency,
  promo: editing = null,
}: {
  services: ServiceOption[]
  currency: string
  /** La promoción que se edita; ausente = una nueva. */
  promo?: EditPromo | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => (editing ? stateFromPromo(editing) : emptyState()))
  const [sample, setSample] = useState('20000')

  const codeLocked = editing !== null && editing.redemptionCount > 0

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Vista previa en vivo: usa el mismo computeDiscount que aplica el server.
  const preview = useMemo(() => {
    const price = Math.max(0, toIntOrNull(sample) ?? 0)
    const rewardValue = form.rewardType === 'free_service' ? 0 : toIntOrNull(form.rewardValue) ?? 0
    const discount = computeDiscount(
      {
        isActive: true,
        validFrom: null,
        validUntil: null,
        maxRedemptions: null,
        maxPerCustomer: null,
        minSpend: null,
        appliesToAll: form.appliesToAll,
        serviceIds: form.serviceIds,
        rewardType: form.rewardType,
        rewardValue,
        maxDiscount: toIntOrNull(form.maxDiscount),
        redemptionCount: 0,
      },
      price,
    )
    return { price, discount, final: price - discount }
  }, [sample, form.rewardType, form.rewardValue, form.maxDiscount, form.appliesToAll, form.serviceIds])

  function handleSubmit() {
    setError(null)
    const payload = {
      name: form.name,
      description: form.description.trim() || null,
      code: form.code.trim() || null,
      rewardType: form.rewardType,
      rewardValue: form.rewardType === 'free_service' ? 0 : toIntOrNull(form.rewardValue) ?? 0,
      maxDiscount: form.rewardType === 'percentage' ? toIntOrNull(form.maxDiscount) : null,
      appliesToAll: form.appliesToAll,
      serviceIds: form.appliesToAll ? [] : form.serviceIds,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
      minSpend: toIntOrNull(form.minSpend),
      maxRedemptions: toIntOrNull(form.maxRedemptions),
      maxPerCustomer: toIntOrNull(form.maxPerCustomer),
    }

    startTransition(async () => {
      try {
        const res = editing
          ? await updatePromotion(editing.id, payload)
          : await createPromotion(payload)
        if (!res.ok) { setError(res.error); return }
        setOpen(false)
        if (!editing) setForm(emptyState())
        router.refresh()
      } catch {
        setError('No se pudo guardar la promoción')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {!editing ? (
          <Button size="form" className="font-semibold">
            <Plus className="mr-2 size-4" />
            Nueva promoción
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline">
            <Pencil className="mr-1 size-4" />
            Editar
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-semibold tracking-tight text-primary">
            {editing ? 'Editar promoción' : 'Nueva promoción'}
          </DialogTitle>
          <DialogDescription>Define el beneficio, vigencia y límites de uso.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
          className="space-y-5"
        >
          <FormField id="promotion-name" label="Nombre" required>
            {(a11y) => <Input id="promotion-name" value={form.name} onChange={(e) => update('name', e.target.value)} required maxLength={100} density="form" {...a11y} />}
          </FormField>

          <FormField id="promotion-description" label="Descripción" help="Opcional">
            {(a11y) => <Textarea id="promotion-description" value={form.description} onChange={(e) => update('description', e.target.value)} rows={2} maxLength={500} density="form" {...a11y} />}
          </FormField>

          <RewardFields
            value={{
              rewardType: form.rewardType,
              rewardValue: form.rewardValue,
              maxDiscount: form.maxDiscount,
              appliesToAll: form.appliesToAll,
              serviceIds: form.serviceIds,
            }}
            onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
            services={services}
            currency={currency}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="promotion-valid-from" label="Vigente desde">
              {(a11y) => <Input id="promotion-valid-from" type="date" value={form.validFrom} onChange={(e) => update('validFrom', e.target.value)} density="form" {...a11y} />}
            </FormField>
            <FormField id="promotion-valid-until" label="Vigente hasta">
              {(a11y) => <Input id="promotion-valid-until" type="date" value={form.validUntil} onChange={(e) => update('validUntil', e.target.value)} density="form" {...a11y} />}
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="promotion-min-spend" label="Gasto mínimo" help="Opcional">
              {(a11y) => <Input id="promotion-min-spend" type="number" min={0} value={form.minSpend} onChange={(e) => update('minSpend', e.target.value)} density="form" {...a11y} />}
            </FormField>
            <FormField id="promotion-max-redemptions" label="Usos máximos" help="Sin límite si se deja vacío">
              {(a11y) => <Input id="promotion-max-redemptions" type="number" min={1} value={form.maxRedemptions} onChange={(e) => update('maxRedemptions', e.target.value)} density="form" {...a11y} />}
            </FormField>
            <FormField id="promotion-max-customer" label="Máx. por cliente" help="Sin límite si se deja vacío">
              {(a11y) => <Input id="promotion-max-customer" type="number" min={1} value={form.maxPerCustomer} onChange={(e) => update('maxPerCustomer', e.target.value)} density="form" {...a11y} />}
            </FormField>
          </div>

          <FormField id="promotion-code" label="Código" help={codeLocked ? 'El código se bloquea tras el primer canje.' : 'Opcional, por ejemplo VERANO20'}>
            {(a11y) => <Input id="promotion-code" className="uppercase" value={form.code} onChange={(e) => update('code', e.target.value.toUpperCase())} maxLength={40} disabled={codeLocked} density="form" {...a11y} />}
          </FormField>

          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="studio-eyebrow">Vista previa</span>
              <FormField id="promotion-preview-price" label="Precio" layout="inline">
                {(a11y) => <Input id="promotion-preview-price" className="w-28" type="number" min={0} value={sample} onChange={(e) => setSample(e.target.value)} density="compact" {...a11y} />}
              </FormField>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {form.rewardType === 'free_service' ? (
                <span className="font-semibold text-primary">Precio final: Gratis</span>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    Descuento: <span className="font-semibold text-primary">{formatMoney(preview.discount, currency)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Precio final: <span className="font-semibold text-primary">{formatMoney(preview.final, currency)}</span>
                  </span>
                </>
              )}
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button type="submit" size="touch" className="w-full font-semibold" disabled={isPending}>
            {isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear promoción'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
