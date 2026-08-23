'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SettingsFormSection } from '@/components/dashboard/settings/settings-form-section'
import { SettingsSaveBar } from '@/components/dashboard/settings/settings-save-bar'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'
import { useUnsavedChangesRegistration } from '@/components/dashboard/unsaved-changes-provider'
import { useVocabulary } from '@/components/vocabulary-provider'
import { policySettingsSchema, type PolicySettingsInput } from '@/lib/business/schema'
import { updatePolicySettings } from '@/server/actions/business-settings'

type PolicySettingsFormProps = {
  businessId: string
  initialValues: PolicySettingsInput
}

const DRAFT_VERSION = 1

export function PolicySettingsForm({ businessId, initialValues }: PolicySettingsFormProps) {
  const vocabulary = useVocabulary()
  const [baseline, setBaseline] = useState(initialValues)
  const [draftValues, setDraftValues] = useState(initialValues)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [serverError, setServerError] = useState<string | null>(null)
  const submitInFlight = useRef(false)
  const form = useForm<PolicySettingsInput>({
    resolver: zodResolver(policySettingsSchema),
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
  const cancellationReminderEnabled = useWatch({ control, name: 'cancellationReminderEnabled' })

  useEffect(() => subscribe({
    formState: { values: true },
    callback: ({ values }) => setDraftValues(values),
  }), [subscribe])

  const replaceBaseline = useCallback((values: PolicySettingsInput) => {
    reset(values)
    setBaseline(values)
    setDraftValues(values)
  }, [reset])

  const draft = useSettingsDraft({
    scope: 'policies',
    key: `${businessId}:policies`,
    version: DRAFT_VERSION,
    baseline,
    values: draftValues,
    isDirty,
    reset,
    replaceBaseline,
  })

  useUnsavedChangesRegistration({ scope: 'policies', isDirty, discard: draft.discard })

  async function onSubmit(values: PolicySettingsInput) {
    setStatus('idle')
    setServerError(null)

    try {
      const response = await updatePolicySettings(values)
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
      {draft.recovery === 'verification-failed' && (
        <p role="status" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          No pudimos verificar el borrador con el servidor. No se aplicó ni se eliminó; vuelve a intentarlo con conexión.
        </p>
      )}

      <fieldset data-tour-id="settings-policies" disabled={isSubmitting} aria-label="Campos de políticas" aria-busy={isSubmitting} className="space-y-10 disabled:opacity-70">
        <SettingsFormSection title="Cancelación y autogestión">
          <FormField
            id="policy-cutoff"
            label="Ventana de autogestión (horas)"
            error={errors.selfServiceCutoffHours?.message}
            help={<>Hasta cuántas horas antes tus {vocabulary.clients} pueden cancelar o reprogramar por su cuenta. 0 = sin límite.</>}
          >
            {(a11y) => <Input id="policy-cutoff" density="form" type="number" min={0} max={720} {...register('selfServiceCutoffHours')} {...a11y} />}
          </FormField>
          <FormField
            id="policy-cancellation-reminder"
            label="Avisar antes del límite de cancelación"
            layout="inline"
            error={errors.cancellationReminderEnabled?.message}
            help="Envía una notificación Web Push sólo para reservas futuras y vigentes con abono requerido o pagado y un límite mayor que 0. El aviso sale cuando el abono ya está pagado."
          >
            {(a11y) => <Switch id="policy-cancellation-reminder" checked={Boolean(cancellationReminderEnabled)} onCheckedChange={(value) => setValue('cancellationReminderEnabled', value, { shouldDirty: true })} {...a11y} />}
          </FormField>
        </SettingsFormSection>

        <SettingsFormSection title="Condiciones visibles al reservar">
          <FormField
            id="policy-cancellation"
            label="Condiciones adicionales"
            error={errors.cancellationPolicy?.message}
            help="Complementan la política y no deben repetir ni contradecir el límite estructurado de horas, que tiene prioridad."
          >
            {(a11y) => <Textarea id="policy-cancellation" density="form" {...register('cancellationPolicy')} rows={3} {...a11y} />}
          </FormField>
          <FormField id="policy-booking" label="Política de reserva" error={errors.bookingPolicy?.message}>
            {(a11y) => <Textarea id="policy-booking" density="form" {...register('bookingPolicy')} rows={3} {...a11y} />}
          </FormField>
          <FormField id="policy-deposit" label="Política de abono" error={errors.depositPolicy?.message}>
            {(a11y) => <Textarea id="policy-deposit" density="form" {...register('depositPolicy')} rows={3} {...a11y} />}
          </FormField>
        </SettingsFormSection>
      </fieldset>

      <SettingsSaveBar isDirty={isDirty} isSubmitting={isSubmitting} status={status} error={serverError} />
    </form>
  )
}
