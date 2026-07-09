'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { createPromotion, updatePromotion } from '@/server/actions/promotions'
import { computeDiscount } from '@/lib/promotions/evaluate'
import { formatMoney } from '@/lib/money'

type RewardType = 'percentage' | 'fixed_amount' | 'free_service'

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

const rewardOptions: { value: RewardType; label: string }[] = [
  { value: 'percentage', label: '% descuento' },
  { value: 'fixed_amount', label: 'Monto fijo' },
  { value: 'free_service', label: 'Servicio gratis' },
]

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

export function PromotionForm({
  mode,
  services,
  currency,
  promo,
}: {
  mode: 'create' | 'edit'
  services: ServiceOption[]
  currency: string
  promo?: EditPromo
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => (promo ? stateFromPromo(promo) : emptyState()))
  const [sample, setSample] = useState('20000')

  const codeLocked = mode === 'edit' && (promo?.redemptionCount ?? 0) > 0

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleService(id: string) {
    setForm((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(id)
        ? prev.serviceIds.filter((s) => s !== id)
        : [...prev.serviceIds, id],
    }))
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
        if (mode === 'edit' && promo) {
          await updatePromotion(promo.id, payload)
        } else {
          await createPromotion(payload)
        }
        setOpen(false)
        if (mode === 'create') setForm(emptyState())
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo guardar la promoción')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {mode === 'create' ? (
          <Button className="h-11 font-semibold">
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
            {mode === 'edit' ? 'Editar promoción' : 'Nueva promoción'}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label className="studio-eyebrow">Nombre</Label>
            <Input
              className="studio-input"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label className="studio-eyebrow">Descripción</Label>
            <Textarea
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-2">
            <Label className="studio-eyebrow">Tipo de recompensa</Label>
            <div className="flex gap-1 rounded-2xl border border-border bg-card p-1">
              {rewardOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('rewardType', opt.value)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                    form.rewardType === opt.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {form.rewardType !== 'free_service' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="studio-eyebrow">
                  {form.rewardType === 'percentage' ? 'Porcentaje (1–100)' : `Monto (${currency})`}
                </Label>
                <Input
                  className="studio-input"
                  type="number"
                  min={form.rewardType === 'percentage' ? 1 : 0}
                  max={form.rewardType === 'percentage' ? 100 : undefined}
                  value={form.rewardValue}
                  onChange={(e) => update('rewardValue', e.target.value)}
                  required
                />
              </div>
              {form.rewardType === 'percentage' && (
                <div className="space-y-2">
                  <Label className="studio-eyebrow">Descuento máximo</Label>
                  <Input
                    className="studio-input"
                    type="number"
                    min={1}
                    value={form.maxDiscount}
                    onChange={(e) => update('maxDiscount', e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="studio-eyebrow">Aplica a todos los servicios</Label>
                <p className="text-xs text-muted-foreground">Desactiva para elegir servicios específicos.</p>
              </div>
              <Switch
                checked={form.appliesToAll}
                onCheckedChange={(v) => update('appliesToAll', v)}
              />
            </div>

            {form.rewardType === 'free_service' && form.appliesToAll && (
              <p className="rounded-lg bg-orange-100 px-3 py-2 text-xs font-medium text-orange-800">
                Aplica servicio gratis a TODOS los servicios.
              </p>
            )}

            {!form.appliesToAll && (
              <div className="flex flex-wrap gap-2">
                {services.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay servicios activos.</p>
                ) : (
                  services.map((s) => {
                    const selected = form.serviceIds.includes(s.id)
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleService(s.id)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {s.name}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Vigente desde</Label>
              <Input
                className="studio-input"
                type="date"
                value={form.validFrom}
                onChange={(e) => update('validFrom', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Vigente hasta</Label>
              <Input
                className="studio-input"
                type="date"
                value={form.validUntil}
                onChange={(e) => update('validUntil', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Gasto mínimo</Label>
              <Input
                className="studio-input"
                type="number"
                min={0}
                value={form.minSpend}
                onChange={(e) => update('minSpend', e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Usos máximos</Label>
              <Input
                className="studio-input"
                type="number"
                min={1}
                value={form.maxRedemptions}
                onChange={(e) => update('maxRedemptions', e.target.value)}
                placeholder="∞"
              />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Máx. por cliente</Label>
              <Input
                className="studio-input"
                type="number"
                min={1}
                value={form.maxPerCustomer}
                onChange={(e) => update('maxPerCustomer', e.target.value)}
                placeholder="∞"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="studio-eyebrow">Código</Label>
            <Input
              className="studio-input uppercase"
              value={form.code}
              onChange={(e) => update('code', e.target.value.toUpperCase())}
              placeholder="Ej: VERANO20"
              maxLength={40}
              disabled={codeLocked}
            />
            {codeLocked && (
              <p className="text-xs text-muted-foreground">El código se bloquea tras el primer canje.</p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <Label className="studio-eyebrow">Vista previa</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Precio</span>
                <Input
                  className="studio-input h-9 w-28"
                  type="number"
                  min={0}
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                />
              </div>
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full font-semibold" disabled={isPending}>
            {isPending ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Crear promoción'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
