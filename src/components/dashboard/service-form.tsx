'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createService, updateService } from '@/server/actions/services'
import { Pencil, AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const PASTEL_COLORS = [
  '#FFB3BA', '#E2B3FF', '#A3D8FF', '#B3F0C8', '#FFF4B3', '#FFD4B3', '#D4B3FF', '#B3FFF4'
]

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120]

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

function ServicePreview({ name, description, price, durationMinutes, depositAmount, color }: {
  name: string
  description: string
  price: string
  durationMinutes: string
  depositAmount: string
  color: string
}) {
  const validColor = HEX_COLOR_REGEX.test(color) ? color : '#E5E7EB'
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center gap-3">
        <div
          className="size-8 rounded-full shrink-0 border border-border"
          style={{ backgroundColor: validColor }}
        />
        <div className="min-w-0">
          <div className="font-semibold text-primary text-sm truncate">{name || 'Nombre del servicio'}</div>
          {description && (
            <div className="text-xs text-muted-foreground line-clamp-2">{description}</div>
          )}
        </div>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        {price && <span>${parseInt(price).toLocaleString('es-CL')}</span>}
        {durationMinutes && <span>{durationMinutes} min</span>}
        {depositAmount && parseInt(depositAmount) > 0 && (
          <span>Abono requerido: ${parseInt(depositAmount).toLocaleString('es-CL')}</span>
        )}
      </div>
    </div>
  )
}

export function ServiceForm({
  service,
  onSuccess,
  triggerLabel,
  triggerIcon,
}: {
  service?: { id: string; name: string; description: string | null; durationMinutes: number; price: number; depositAmount: number; pastelColor: string; isActive: boolean; sortOrder: number } | null
  onSuccess?: () => void
  triggerLabel?: string
  triggerIcon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedColor, setSelectedColor] = useState(service?.pastelColor || PASTEL_COLORS[0])
  const [customHex, setCustomHex] = useState(service?.pastelColor || '')

  const [previewName, setPreviewName] = useState(service?.name || '')
  const [previewDescription, setPreviewDescription] = useState(service?.description || '')
  const [previewPrice, setPreviewPrice] = useState(service?.price?.toString() || '')
  const [previewDeposit, setPreviewDeposit] = useState(service?.depositAmount?.toString() || '')

  const initialDuration = service?.durationMinutes ?? 30
  const [duration, setDuration] = useState<number>(initialDuration)
  const [showCustomDuration, setShowCustomDuration] = useState(
    service?.durationMinutes != null && !DURATION_PRESETS.includes(service.durationMinutes)
  )
  const previewDuration = duration > 0 ? duration.toString() : ''

  function handleHexChange(value: string) {
    setCustomHex(value)
    if (HEX_COLOR_REGEX.test(value)) {
      setSelectedColor(value)
    }
  }

  function handleColorPick(color: string) {
    setSelectedColor(color)
    setCustomHex(color)
  }

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)

    if (!duration || duration < 1) {
      setError('Indica cuánto dura el servicio')
      setLoading(false)
      return
    }

    const data: Record<string, unknown> = {
      name: (formData.get('name') as string).trim(),
      description: (formData.get('description') as string).trim() || null,
      durationMinutes: parseInt(formData.get('durationMinutes') as string),
      price: parseInt(formData.get('price') as string),
      depositAmount: parseInt(formData.get('depositAmount') as string),
      pastelColor: selectedColor,
      isActive: true,
    }

    if (service) {
      data.sortOrder = service.sortOrder ?? 0
    }

    try {
      if (service) {
        await updateService(service.id, data)
      } else {
        await createService(data)
      }
      setOpen(false)
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el servicio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null) }}>
      <DialogTrigger asChild>
        <Button variant={service ? 'outline' : 'default'} size={service ? "sm" : "default"} className="font-semibold">
          {service ? <Pencil className="mr-2 size-4" /> : triggerIcon}
          {service ? 'Editar' : triggerLabel || 'Nuevo servicio'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading font-semibold tracking-tight text-primary">{service ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="studio-eyebrow">Nombre</Label>
            <Input
              className="studio-input"
              name="name"
              defaultValue={service?.name}
              required
              onChange={(e) => setPreviewName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="studio-eyebrow">Descripción</Label>
            <Textarea
              className="min-h-24 rounded-lg border-border bg-card text-base focus-visible:border-primary focus-visible:ring-primary/20"
              name="description"
              defaultValue={service?.description || ''}
              onChange={(e) => setPreviewDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="studio-eyebrow">Precio</Label>
              <Input
                className="studio-input"
                name="price"
                type="number"
                defaultValue={service?.price}
                required
                onChange={(e) => setPreviewPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="studio-eyebrow">Abono</Label>
              <Input
                className="studio-input"
                name="depositAmount"
                type="number"
                defaultValue={service?.depositAmount}
                required
                onChange={(e) => setPreviewDeposit(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="studio-eyebrow">¿Cuánto dura?</Label>
            {/* Valor real que viaja en el form; los chips solo lo controlan. */}
            <input type="hidden" name="durationMinutes" value={duration} />
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((min) => {
                const active = !showCustomDuration && duration === min
                return (
                  <button
                    key={min}
                    type="button"
                    onClick={() => { setShowCustomDuration(false); setDuration(min) }}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:border-primary/50'
                    }`}
                  >
                    {formatDuration(min)}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setShowCustomDuration(true)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  showCustomDuration
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/50'
                }`}
              >
                Otro
              </button>
            </div>
            {showCustomDuration && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  className="studio-input w-28"
                  type="number"
                  min={1}
                  step={5}
                  value={duration || ''}
                  onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                  placeholder="Minutos"
                  autoFocus
                />
                <span className="text-sm text-muted-foreground">minutos</span>
              </div>
            )}
          </div>
          <div>
            <Label className="studio-eyebrow">Color</Label>
            <div className="flex gap-2 mt-2">
              {PASTEL_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleColorPick(color)}
                  className={`size-8 rounded-full border-2 transition ${selectedColor === color ? 'scale-110 border-primary' : 'border-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">o ingresa:</span>
              <Input
                className="studio-input w-28 font-mono text-sm"
                placeholder="#RRGGBB"
                value={customHex}
                onChange={(e) => handleHexChange(e.target.value)}
                maxLength={7}
              />
              {HEX_COLOR_REGEX.test(customHex) && (
                <div className="size-6 rounded-full border border-border shrink-0" style={{ backgroundColor: customHex }} />
              )}
            </div>
          </div>

          <div>
            <Label className="studio-eyebrow mb-2 block">Vista previa</Label>
            <ServicePreview
              name={previewName}
              description={previewDescription}
              price={previewPrice}
              durationMinutes={previewDuration}
              depositAmount={previewDeposit}
              color={selectedColor}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="h-12 w-full font-semibold" disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
