'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { RewardFields, type RewardFieldsValue } from '@/components/dashboard/reward-fields'
import { createCampaign } from '@/server/actions/campaigns'
import {
  CAMPAIGN_SEGMENTS,
  DEFAULT_INACTIVE_DAYS,
  DEFAULT_FREQUENT_MIN,
  type CampaignSegmentType,
} from '@/lib/campaigns/schema'
import { defaultMessageForSegment } from '@/lib/campaigns/message'
import { segmentLabel } from './campaign-list'

export interface PromotionOption {
  id: string
  name: string
}

interface ServiceOption {
  id: string
  name: string
}

// '' -> null; números enteros para días/montos.
function toIntOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function emptyReward(): RewardFieldsValue {
  return { rewardType: 'percentage', rewardValue: '', maxDiscount: '', appliesToAll: true, serviceIds: [] }
}

export function NewCampaignDialog({
  promotions,
  services,
  currency,
}: {
  promotions: PromotionOption[]
  services: ServiceOption[]
  currency: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [segment, setSegment] = useState<CampaignSegmentType>('birthday_month')
  const [inactiveDays, setInactiveDays] = useState(String(DEFAULT_INACTIVE_DAYS))
  const [frequentMin, setFrequentMin] = useState(String(DEFAULT_FREQUENT_MIN))
  const [promoMode, setPromoMode] = useState<'catalog' | 'new'>(promotions.length > 0 ? 'catalog' : 'new')
  const [promotionId, setPromotionId] = useState(promotions[0]?.id ?? '')
  const [newPromoName, setNewPromoName] = useState('')
  const [reward, setReward] = useState<RewardFieldsValue>(emptyReward)
  const [grantExpiryDays, setGrantExpiryDays] = useState('')
  const [message, setMessage] = useState(() => defaultMessageForSegment('birthday_month'))
  // Mientras el usuario no toque el mensaje, cambiar de segmento re-siembra el default.
  const [messageTouched, setMessageTouched] = useState(false)

  function selectSegment(next: CampaignSegmentType) {
    setSegment(next)
    if (!messageTouched) setMessage(defaultMessageForSegment(next))
  }

  function handleSubmit() {
    setError(null)
    const segmentParams =
      segment === 'inactive'
        ? { inactiveDays: toIntOrNull(inactiveDays) ?? DEFAULT_INACTIVE_DAYS }
        : segment === 'frequent'
          ? { frequentMin: toIntOrNull(frequentMin) ?? DEFAULT_FREQUENT_MIN }
          : undefined

    const payload = {
      name,
      segmentType: segment,
      segmentParams,
      messageTemplate: message,
      ...(promoMode === 'catalog'
        ? { promotionId }
        : {
            newPromotion: {
              name: newPromoName,
              rewardType: reward.rewardType,
              rewardValue: reward.rewardType === 'free_service' ? 0 : toIntOrNull(reward.rewardValue) ?? 0,
              maxDiscount: reward.rewardType === 'percentage' ? toIntOrNull(reward.maxDiscount) : null,
              appliesToAll: reward.appliesToAll,
              serviceIds: reward.appliesToAll ? [] : reward.serviceIds,
              grantExpiryDays: toIntOrNull(grantExpiryDays),
            },
          }),
    }

    startTransition(async () => {
      try {
        const { campaignId } = await createCampaign(payload)
        setOpen(false)
        router.push('/dashboard/campanas/' + campaignId)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo crear la campaña')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-11 font-semibold">
          <Plus className="mr-2 size-4" />
          Nueva campaña
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-semibold tracking-tight text-primary">
            Nueva campaña
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
            <Label className="studio-eyebrow" htmlFor="campaign-name">
              Nombre
            </Label>
            <Input
              id="campaign-name"
              className="studio-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label className="studio-eyebrow">Segmento</Label>
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-1">
              {CAMPAIGN_SEGMENTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => selectSegment(s)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                    segment === s
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {segmentLabel(s)}
                </button>
              ))}
            </div>
          </div>

          {segment === 'inactive' && (
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="campaign-inactive-days">
                Sin reservas hace (días)
              </Label>
              <Input
                id="campaign-inactive-days"
                className="studio-input"
                type="number"
                min={1}
                value={inactiveDays}
                onChange={(e) => setInactiveDays(e.target.value)}
              />
            </div>
          )}

          {segment === 'frequent' && (
            <div className="space-y-2">
              <Label className="studio-eyebrow" htmlFor="campaign-frequent-min">
                Reservas mínimas
              </Label>
              <Input
                id="campaign-frequent-min"
                className="studio-input"
                type="number"
                min={1}
                value={frequentMin}
                onChange={(e) => setFrequentMin(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
            <Label className="studio-eyebrow">Promo a regalar</Label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="campaign-promo-mode"
                  checked={promoMode === 'catalog'}
                  onChange={() => setPromoMode('catalog')}
                  disabled={promotions.length === 0}
                />
                Del catálogo
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="campaign-promo-mode"
                  checked={promoMode === 'new'}
                  onChange={() => setPromoMode('new')}
                />
                Crear nueva
              </label>
            </div>

            {promoMode === 'catalog' ? (
              promotions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay promos en el catálogo. Creá una nueva.</p>
              ) : (
                <select
                  aria-label="Promo del catálogo"
                  value={promotionId}
                  onChange={(e) => setPromotionId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {promotions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="studio-eyebrow" htmlFor="campaign-promo-name">
                    Nombre de la promo
                  </Label>
                  <Input
                    id="campaign-promo-name"
                    className="studio-input"
                    value={newPromoName}
                    onChange={(e) => setNewPromoName(e.target.value)}
                    required={promoMode === 'new'}
                    maxLength={60}
                  />
                </div>
                <RewardFields value={reward} onChange={setReward} services={services} currency={currency} />
                <div className="space-y-2">
                  <Label className="studio-eyebrow" htmlFor="campaign-grant-expiry">
                    Vence en X días
                  </Label>
                  <Input
                    id="campaign-grant-expiry"
                    className="studio-input"
                    type="number"
                    min={1}
                    value={grantExpiryDays}
                    onChange={(e) => setGrantExpiryDays(e.target.value)}
                    placeholder="Opcional"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="studio-eyebrow" htmlFor="campaign-message">
              Mensaje
            </Label>
            <Textarea
              id="campaign-message"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value)
                setMessageTouched(true)
              }}
              rows={4}
              maxLength={1000}
              required
            />
            <p className="text-xs text-muted-foreground">
              Podés usar {'{nombre}'} {'{codigo}'} {'{vencimiento}'} {'{negocio}'} y se reemplazan al enviar.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-12 w-full font-semibold" disabled={isPending}>
            {isPending ? 'Creando…' : 'Crear campaña'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
