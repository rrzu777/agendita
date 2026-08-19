'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { GuardedLink, useUnsavedChangesRegistration } from '@/components/dashboard/unsaved-changes-provider'
import { SettingsFormSection } from '@/components/dashboard/settings/settings-form-section'
import { SettingsSaveBar } from '@/components/dashboard/settings/settings-save-bar'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'
import { useVocabulary } from '@/components/vocabulary-provider'
import { reservationSettingsSchema, type ReservationSettingsInput } from '@/lib/business/schema'
import { updateReservationSettings } from '@/server/actions/business-settings'

type ReservationSettingsFormProps = {
  businessId: string
  initialValues: ReservationSettingsInput
}

const DRAFT_VERSION = 1

const TIMEZONES = [
  { value: 'America/Santiago', label: 'América/Santiago (Chile)' },
  { value: 'America/Buenos_Aires', label: 'América/Buenos Aires (Argentina)' },
  { value: 'America/Lima', label: 'América/Lima (Perú)' },
  { value: 'America/Mexico_City', label: 'América/México (México)' },
  { value: 'America/Bogota', label: 'América/Bogotá (Colombia)' },
]

const SLOT_STEP_OPTIONS = [
  { value: '15', label: 'Cada 15 minutos' },
  { value: '30', label: 'Cada 30 minutos' },
  { value: '45', label: 'Cada 45 minutos' },
  { value: '60', label: 'Cada 1 hora' },
  { value: 'service', label: 'Según la duración del servicio' },
] as const

export function ReservationSettingsForm({ businessId, initialValues }: ReservationSettingsFormProps) {
  const vocabulary = useVocabulary()
  const [baseline, setBaseline] = useState(initialValues)
  const [draftValues, setDraftValues] = useState(initialValues)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [serverError, setServerError] = useState<string | null>(null)
  const submitInFlight = useRef(false)
  const form = useForm<ReservationSettingsInput>({
    resolver: zodResolver(reservationSettingsSchema),
    defaultValues: initialValues,
  })
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    subscribe,
    formState: { errors, isDirty, isSubmitting },
  } = form
  const [timezone, slotStepMinutes, requireBookingApproval] = useWatch({
    control,
    name: ['timezone', 'slotStepMinutes', 'requireBookingApproval'],
  })

  useEffect(() => subscribe({
    formState: { values: true },
    callback: ({ values }) => setDraftValues(values),
  }), [subscribe])

  const draft = useSettingsDraft({
    key: `${businessId}:reservations`,
    version: DRAFT_VERSION,
    baseline,
    values: draftValues,
    isDirty,
    reset,
  })

  useUnsavedChangesRegistration({ scope: 'reservations', isDirty, discard: draft.discard })

  async function onSubmit(values: ReservationSettingsInput) {
    setStatus('idle')
    setServerError(null)

    try {
      const response = await updateReservationSettings(values)
      if (!response.ok) {
        setServerError(response.error)
        setStatus('error')
        return
      }

      reset(response.data)
      setBaseline(response.data)
      setDraftValues(response.data)
      draft.clearDraft()
      setStatus('saved')
    } catch {
      setServerError('No se pudieron guardar los cambios. Intenta nuevamente.')
      setStatus('error')
    } finally {
      submitInFlight.current = false
    }
  }

  function onInvalidSubmit() {
    submitInFlight.current = false
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    if (submitInFlight.current) {
      event.preventDefault()
      return
    }

    submitInFlight.current = true
    void handleSubmit(onSubmit, onInvalidSubmit)(event).catch(() => {
      submitInFlight.current = false
    })
  }

  return (
    <form onSubmit={submitForm} className="min-w-0 space-y-10">
      {draft.recovery === 'restored' && (
        <p role="status" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Recuperamos un borrador local para que puedas continuar editando.
        </p>
      )}
      {draft.recovery === 'conflict' && (
        <p role="status" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          Hay un borrador local de una versión anterior y no se aplicó para evitar sobrescribir cambios recientes.
        </p>
      )}

      <fieldset disabled={isSubmitting} aria-label="Campos de reservas" aria-busy={isSubmitting} className="space-y-10 disabled:opacity-70">
        <SettingsFormSection title="Agenda" description="Cómo se ofrecen y retienen los horarios de reserva.">
          <FieldError controlId="reservation-timezone" error={errors.timezone?.message}>
            {(describedBy) => <><Label htmlFor="reservation-timezone">Zona horaria</Label><Select value={timezone} onValueChange={(value) => setValue('timezone', value, { shouldDirty: true })}><SelectTrigger id="reservation-timezone" aria-invalid={Boolean(errors.timezone)} aria-describedby={describedBy}><SelectValue /></SelectTrigger><SelectContent>{TIMEZONES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></>}
          </FieldError>
          <FieldError
            controlId="reservation-slot-step"
            error={errors.slotStepMinutes?.message}
            help={<>Cada cuánto se ofrecen horas de inicio en tu página de reservas. &quot;Según la duración del servicio&quot; deja las citas pegadas una tras otra (sin huecos), pero da menos opciones de hora a tus {vocabulary.clients}.</>}
          >
            {(describedBy) => <><Label htmlFor="reservation-slot-step">Ofrecer horas de reserva</Label><Select value={slotStepMinutes} onValueChange={(value) => setValue('slotStepMinutes', value as ReservationSettingsInput['slotStepMinutes'], { shouldDirty: true })}><SelectTrigger id="reservation-slot-step" aria-invalid={Boolean(errors.slotStepMinutes)} aria-describedby={describedBy}><SelectValue /></SelectTrigger><SelectContent>{SLOT_STEP_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></>}
          </FieldError>
          <FieldError
            controlId="reservation-manual-hold"
            error={errors.manualHoldHours?.message}
            help={<>Si no tenés pago online ni transferencia configurados, cuántas horas se guarda el horario de cada ciclo de reserva mientras coordinás el abono. Pasado el plazo, la reserva expira sola. A quien reserve le prometemos este plazo o su cita, lo que pase antes. <GuardedLink href="/dashboard/settings/payments" prefetch={false} className="underline underline-offset-4">Configurar pagos</GuardedLink></>}
          >
            {(describedBy) => <><Label htmlFor="reservation-manual-hold">Reserva sin pago online (horas)</Label><Input id="reservation-manual-hold" type="number" min={1} max={720} {...register('manualHoldHours')} aria-invalid={Boolean(errors.manualHoldHours)} aria-describedby={describedBy} /></>}
          </FieldError>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Moneda: CLP</p>
            <p>La moneda no se puede cambiar en este momento.</p>
          </div>
        </SettingsFormSection>

        <SettingsFormSection title="Confirmación" description="Elige si quieres revisar cada solicitud antes de confirmarla.">
          <FieldError
            controlId="reservation-approval"
            error={errors.requireBookingApproval?.message}
            help="Las reservas llegan como solicitudes y vos las aceptás o las rechazás. El horario queda tomado mientras tanto, y si no respondés en 24 horas se libera solo. No aplica a los servicios con abono: ahí el pago ya hace de filtro."
          >
            {(describedBy) => <div className="flex items-center justify-between gap-4"><Label htmlFor="reservation-approval">Confirmar cada reserva a mano</Label><Switch id="reservation-approval" checked={Boolean(requireBookingApproval)} onCheckedChange={(value) => setValue('requireBookingApproval', value, { shouldDirty: true })} aria-invalid={Boolean(errors.requireBookingApproval)} aria-describedby={describedBy} /></div>}
          </FieldError>
        </SettingsFormSection>

        <SettingsFormSection title="Atención online" description="Una sala fija para los servicios que atiendes por videollamada.">
          <FieldError
            controlId="reservation-meeting-url"
            error={errors.defaultMeetingUrl?.message}
            help="Tu link fijo de Zoom o Meet. Se copia a cada reserva online cuando la toman, así que si lo cambiás, las citas ya avisadas conservan el que se mandó."
          >
            {(describedBy) => <><Label htmlFor="reservation-meeting-url">Sala de videollamada</Label><Input id="reservation-meeting-url" type="url" placeholder="https://meet.google.com/abc-defg-hij" {...register('defaultMeetingUrl')} aria-invalid={Boolean(errors.defaultMeetingUrl)} aria-describedby={describedBy} /></>}
          </FieldError>
        </SettingsFormSection>
      </fieldset>

      <SettingsSaveBar isDirty={isDirty} isSubmitting={isSubmitting} status={status} error={serverError} />
    </form>
  )
}

function FieldError({
  children,
  controlId,
  error,
  help,
}: {
  children: (describedBy?: string) => React.ReactNode
  controlId: string
  error?: string
  help?: React.ReactNode
}) {
  const helpId = help ? `${controlId}-help` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-2">
      {children(describedBy)}
      {help && <p id={helpId} className="text-xs text-muted-foreground">{help}</p>}
      {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
