'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export interface RewardFieldsValue {
  rewardType: 'percentage' | 'fixed_amount' | 'free_service'
  rewardValue: string
  maxDiscount: string
  appliesToAll: boolean
  serviceIds: string[]
}

const rewardOptions: { value: RewardFieldsValue['rewardType']; label: string }[] = [
  { value: 'percentage', label: '% descuento' },
  { value: 'fixed_amount', label: 'Monto fijo' },
  { value: 'free_service', label: 'Servicio gratis' },
]

export function RewardFields({
  value,
  onChange,
  services,
  currency,
}: {
  value: RewardFieldsValue
  onChange: (next: RewardFieldsValue) => void
  services: { id: string; name: string }[]
  currency: string
}) {
  const update = (patch: Partial<RewardFieldsValue>) => onChange({ ...value, ...patch })

  const toggleService = (id: string) =>
    update({
      serviceIds: value.serviceIds.includes(id)
        ? value.serviceIds.filter((s) => s !== id)
        : [...value.serviceIds, id],
    })

  return (
    <>
      <div className="space-y-2">
        <Label className="studio-eyebrow">Tipo de recompensa</Label>
        <div className="flex gap-1 rounded-2xl border border-border bg-card p-1">
          {rewardOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ rewardType: opt.value })}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                value.rewardType === opt.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {value.rewardType !== 'free_service' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="studio-eyebrow" htmlFor="reward-value">
              {value.rewardType === 'percentage' ? 'Porcentaje (1–100)' : `Monto (${currency})`}
            </Label>
            <Input
              id="reward-value"
              className="studio-input"
              type="number"
              min={value.rewardType === 'percentage' ? 1 : 0}
              max={value.rewardType === 'percentage' ? 100 : undefined}
              value={value.rewardValue}
              onChange={(e) => update({ rewardValue: e.target.value })}
              required
            />
          </div>
          {value.rewardType === 'percentage' && (
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="reward-max-discount">
                Descuento máximo
              </Label>
              <Input
                id="reward-max-discount"
                className="studio-input"
                type="number"
                min={1}
                value={value.maxDiscount}
                onChange={(e) => update({ maxDiscount: e.target.value })}
                placeholder="Opcional"
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="studio-eyebrow" htmlFor="reward-applies-to-all">
              Aplica a todos los servicios
            </Label>
            <p className="text-xs text-muted-foreground">Desactiva para elegir servicios específicos.</p>
          </div>
          <Switch
            id="reward-applies-to-all"
            checked={value.appliesToAll}
            onCheckedChange={(v) => update({ appliesToAll: v })}
          />
        </div>

        {value.rewardType === 'free_service' && value.appliesToAll && (
          <p className="rounded-lg bg-orange-100 px-3 py-2 text-xs font-medium text-orange-800">
            Aplica servicio gratis a TODOS los servicios.
          </p>
        )}

        {!value.appliesToAll && (
          <div className="flex flex-wrap gap-2">
            {services.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay servicios activos.</p>
            ) : (
              services.map((s) => {
                const selected = value.serviceIds.includes(s.id)
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
    </>
  )
}
