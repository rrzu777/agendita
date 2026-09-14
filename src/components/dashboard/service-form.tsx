'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createService, updateService } from '@/server/actions/services'
import { formatDuration } from '@/lib/format-duration'
import { formatMoney } from '@/lib/money'
import { ServiceModality } from '@prisma/client'
import { sortModalities, toggleModalityIn } from '@/lib/services/modality'
import { ModalityCheckboxes } from './modality-checkboxes'
import { ColorPicker } from '@/components/ui/color-picker'
import { createServiceSchema } from '@/lib/services/schema'
import { Pencil, AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const PASTEL_COLORS = [
  '#FFB3BA', '#E2B3FF', '#A3D8FF', '#B3F0C8', '#FFF4B3', '#FFD4B3', '#D4B3FF', '#B3FFF4'
]

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120]
const MAX_DURATION_MINUTES = 480

function clampDurationPart(value: string, min: number, max: number): number {
  const parsed = parseInt(value)
  if (Number.isNaN(parsed)) return min
  return Math.min(Math.max(parsed, min), max)
}

function parseWholeAmount(value: FormDataEntryValue | null): number {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^\d+$/.test(raw) ? Number(raw) : Number.NaN
}

function ServicePreview({ name, description, price, durationMinutes, depositAmount, color, currency }: {
  name: string
  description: string
  price: string
  durationMinutes: number
  depositAmount: string
  color: string
  currency: string
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
        {price && <span>{formatMoney(parseInt(price), currency)}</span>}
        {durationMinutes > 0 && <span>{formatDuration(durationMinutes)}</span>}
        {depositAmount && parseInt(depositAmount) > 0 && (
          <span>Abono requerido: {formatMoney(parseInt(depositAmount), currency)}</span>
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
  currency,
}: {
  service?: { id: string; name: string; description: string | null; category?: string | null; durationMinutes: number; price: number; depositAmount: number; pastelColor: string; modalities: ServiceModality[]; isActive: boolean; sortOrder: number } | null
  onSuccess?: () => void
  triggerLabel?: string
  triggerIcon?: ReactNode
  currency: string
}) {
  const formId = useId()
  const durationHoursId = useId()
  const durationMinutesId = useId()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Un servicio existente sin modalidades sólo puede venir de datos corruptos; el
  // fallback evita un formulario que no se puede guardar (el schema exige >= 1).
  const [modalities, setModalities] = useState<ServiceModality[]>(
    service?.modalities?.length ? sortModalities(service.modalities) : [ServiceModality.on_site],
  )
  const [customHex, setCustomHex] = useState(service?.pastelColor || PASTEL_COLORS[0])

  const [previewName, setPreviewName] = useState(service?.name || '')
  const [previewDescription, setPreviewDescription] = useState(service?.description || '')
  const [previewPrice, setPreviewPrice] = useState(service?.price?.toString() || '')
  const [previewDeposit, setPreviewDeposit] = useState(service?.depositAmount?.toString() || '')

  const initialDuration = service?.durationMinutes ?? 30
  const [duration, setDuration] = useState<number>(initialDuration)
  const [durationHours, setDurationHours] = useState(Math.floor(initialDuration / 60))
  const [durationRemainderMinutes, setDurationRemainderMinutes] = useState(initialDuration % 60)
  const [showCustomDuration, setShowCustomDuration] = useState(
    service?.durationMinutes != null && !DURATION_PRESETS.includes(service.durationMinutes)
  )

  function setDurationParts(totalMinutes: number) {
    const clampedTotal = Math.min(Math.max(totalMinutes, 0), MAX_DURATION_MINUTES)
    setDuration(clampedTotal)
    setDurationHours(Math.floor(clampedTotal / 60))
    setDurationRemainderMinutes(clampedTotal % 60)
  }

  function handleHoursChange(value: string) {
    const hours = clampDurationPart(value, 0, 8)
    const minutes = hours >= 8 ? 0 : durationRemainderMinutes
    const totalMinutes = hours * 60 + minutes
    setDurationHours(hours)
    setDurationRemainderMinutes(minutes)
    setDuration(totalMinutes)
    setShowCustomDuration(!DURATION_PRESETS.includes(totalMinutes))
  }

  function handleMinutesChange(value: string) {
    const maxMinutes = durationHours >= 8 ? 0 : 59
    const minutes = clampDurationPart(value, 0, maxMinutes)
    const totalMinutes = durationHours * 60 + minutes
    setDurationRemainderMinutes(minutes)
    setDuration(totalMinutes)
    setShowCustomDuration(!DURATION_PRESETS.includes(totalMinutes))
  }

  function toggleModality(modality: ServiceModality) {
    // El piso de "al menos una" vive en toggleModalityIn: el schema lo rechazaría
    // igual, pero el error llegaría recién al guardar.
    setModalities((prev) => toggleModalityIn(prev, modality))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setLoading(true)
    setError(null)
    setFieldErrors({})

    if (!duration || duration < 15) {
      setError('La duración mínima es 15 minutos')
      setFieldErrors({ durationMinutes: 'La duración mínima es 15 minutos' })
      event.currentTarget.querySelector<HTMLInputElement>(`#${durationHoursId}`)?.focus()
      setLoading(false)
      return
    }

    if (duration > MAX_DURATION_MINUTES) {
      setError('La duración máxima es 8 horas')
      setFieldErrors({ durationMinutes: 'La duración máxima es 8 horas' })
      event.currentTarget.querySelector<HTMLInputElement>(`#${durationHoursId}`)?.focus()
      setLoading(false)
      return
    }

    const data: Record<string, unknown> = {
      name: (formData.get('name') as string).trim(),
      description: (formData.get('description') as string).trim() || null,
      category: String(formData.get('category') ?? '').trim() || null,
      durationMinutes: parseInt(formData.get('durationMinutes') as string),
      price: parseWholeAmount(formData.get('price')),
      depositAmount: parseWholeAmount(formData.get('depositAmount')),
      pastelColor: customHex,
      modalities,
      isActive: true,
    }

    if (service) data.sortOrder = service.sortOrder ?? 0
    const parsed = createServiceSchema.safeParse(data)
    if (!parsed.success) {
      const errors = parsed.error.issues.reduce<Record<string, string>>((accumulator, issue) => {
        const field = String(issue.path[0] ?? 'form')
        if (!accumulator[field]) accumulator[field] = issue.message
        return accumulator
      }, {})
      if (Number.isNaN(data.price)) errors.price = 'Ingresa un precio en pesos, sin decimales.'
      if (Number.isNaN(data.depositAmount)) errors.depositAmount = 'Ingresa un abono en pesos, sin decimales.'
      setFieldErrors(errors)
      const firstField = Object.keys(errors)[0]
      const selector = firstField === 'pastelColor' ? `#${formId}-color` : `[name="${firstField}"]`
      event.currentTarget.querySelector<HTMLElement>(selector)?.focus()
      setLoading(false)
      return
    }

    try {
      const res = service
        ? await updateService(service.id, parsed.data)
        : await createService(parsed.data)
      if (!res.ok) { setError(res.error); return }
      setOpen(false)
      onSuccess?.()
    } catch {
      setError('Error al guardar el servicio')
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
          <DialogDescription className="sr-only">
            Configura el nombre, precio, duración y color del servicio.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit} className="space-y-5">
          <FormField id={`${formId}-category`} label="Categoría (opcional)" error={fieldErrors.category} help="Agrupa los servicios en la página de reservas. Por ejemplo: Cortes, Barba o Tratamientos.">
            {(a11y) => <Input {...a11y} density="form" id={`${formId}-category`} name="category" defaultValue={service?.category ?? ''} maxLength={60} />}
          </FormField>
          <FormField id={`${formId}-name`} label="Nombre" required error={fieldErrors.name}>
            {(a11y) => (
              <Input
                {...a11y}
                id={`${formId}-name`}
                density="form"
                name="name"
                defaultValue={service?.name}
                required
                onChange={(e) => setPreviewName(e.target.value)}
              />
            )}
          </FormField>
          <FormField id={`${formId}-description`} label="Descripción" error={fieldErrors.description}>
            {(a11y) => (
              <Textarea
                {...a11y}
                id={`${formId}-description`}
                density="form"
                name="description"
                defaultValue={service?.description || ''}
                onChange={(e) => setPreviewDescription(e.target.value)}
              />
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField id={`${formId}-price`} label="Precio" required error={fieldErrors.price}>
              {(a11y) => (
                <Input
                  {...a11y}
                  id={`${formId}-price`}
                  density="form"
                  name="price"
                  type="number"
                  defaultValue={service?.price}
                  required
                  onChange={(e) => setPreviewPrice(e.target.value)}
                />
              )}
            </FormField>
            <FormField id={`${formId}-deposit`} label="Abono" required error={fieldErrors.depositAmount}>
              {(a11y) => (
                <Input
                  {...a11y}
                  id={`${formId}-deposit`}
                  density="form"
                  name="depositAmount"
                  type="number"
                  defaultValue={service?.depositAmount}
                  required
                  onChange={(e) => setPreviewDeposit(e.target.value)}
                />
              )}
            </FormField>
          </div>

          <fieldset aria-describedby={fieldErrors.durationMinutes ? `${formId}-duration-error` : undefined} className="space-y-2">
            <legend className="text-sm font-medium text-foreground">¿Cuánto dura?</legend>
            {/* Valor real que viaja en el form; los chips solo lo controlan. */}
            <input type="hidden" name="durationMinutes" value={duration} />
            <div className="flex flex-wrap gap-2">
              {DURATION_PRESETS.map((min) => {
                const active = !showCustomDuration && duration === min
                return (
                  <button
                    key={min}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setShowCustomDuration(false); setDurationParts(min) }}
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
                aria-pressed={showCustomDuration}
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
            <div className="grid grid-cols-2 gap-3 pt-1">
              <FormField id={durationHoursId} label="Horas">
                {(a11y) => (
                  <Input
                    {...a11y}
                    id={durationHoursId}
                    density="form"
                    type="number"
                    min={0}
                    max={8}
                    step={1}
                    value={durationHours}
                    onChange={(e) => handleHoursChange(e.target.value)}
                    inputMode="numeric"
                  />
                )}
              </FormField>
              <FormField id={durationMinutesId} label="Minutos">
                {(a11y) => (
                  <Input
                    {...a11y}
                    id={durationMinutesId}
                    density="form"
                    type="number"
                    min={0}
                    max={durationHours >= 8 ? 0 : 59}
                    step={5}
                    value={durationRemainderMinutes}
                    onChange={(e) => handleMinutesChange(e.target.value)}
                    inputMode="numeric"
                  />
                )}
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">
              Total: {duration > 0 ? formatDuration(duration) : '0 min'}
            </p>
            {fieldErrors.durationMinutes && <p id={`${formId}-duration-error`} role="alert" className="text-sm text-destructive">{fieldErrors.durationMinutes}</p>}
          </fieldset>
          <ModalityCheckboxes
            selected={modalities}
            onToggle={toggleModality}
            label="¿Dónde se atiende?"
            hint={
              modalities.length > 1
                ? 'Al reservar, la clienta elige una de estas.'
                : 'Con una sola modalidad no se le pregunta nada a la clienta.'
            }
          />

          <FormField id={`${formId}-color`} label="Color del servicio" required error={fieldErrors.pastelColor}>
            {(a11y) => (
              <ColorPicker
                id={`${formId}-color`}
                label="Color del servicio"
                value={customHex}
                onChange={(value) => {
                  setCustomHex(value)
                  if (HEX_COLOR_REGEX.test(value)) {
                  setFieldErrors((errors) => {
                      const remaining = { ...errors }
                      delete remaining.pastelColor
                      return remaining
                    })
                  }
                }}
                presets={PASTEL_COLORS}
                required
                error={a11y['aria-invalid']}
                describedBy={a11y['aria-describedby']}
                hideLabel
              />
            )}
          </FormField>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">Vista previa</p>
            <ServicePreview
              name={previewName}
              description={previewDescription}
              price={previewPrice}
              durationMinutes={duration}
              depositAmount={previewDeposit}
              color={customHex}
              currency={currency}
            />
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" size="form" className="w-full font-semibold" disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
