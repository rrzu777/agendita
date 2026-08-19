'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { saveBankTransferAccount, setBankTransferEnabled, setRequireTransferProof } from '@/server/actions/bank-transfer-settings'
import { HOLD_HOURS_MAX, VERIFY_HOURS_MAX } from '@/lib/bank-transfer/schema'
import { useVocabulary } from '@/components/vocabulary-provider'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'
import { useUnsavedChangesRegistration } from '@/components/dashboard/unsaved-changes-provider'
import {
  toBankTransferFormValues,
  type BankTransferFormValues,
  type BankTransferSettingsRecord,
} from '@/lib/business/settings-form-values'

const DRAFT_VERSION = 1

function sameFormValues(left: BankTransferFormValues, right: BankTransferFormValues) {
  return (Object.keys(left) as Array<keyof BankTransferFormValues>)
    .every((key) => left[key] === right[key])
}

export type BankTransferAccountSettings = BankTransferSettingsRecord & {
  isEnabled: boolean
}

export function BankTransferForm({
  businessId,
  account,
  requireProof,
  proofUploadAvailable,
}: {
  businessId: string
  account: BankTransferAccountSettings | null
  requireProof: boolean
  proofUploadAvailable: boolean
}) {
  const vocabulary = useVocabulary()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const submitInFlight = useRef(false)
  const initialValues = useMemo(() => toBankTransferFormValues(account), [account])
  const [baseline, setBaseline] = useState(initialValues)
  const [form, setForm] = useState(initialValues)
  const formRef = useRef(initialValues)
  const isDirty = Object.keys(baseline).some((key) => form[key as keyof BankTransferFormValues] !== baseline[key as keyof BankTransferFormValues])
  const reset = useCallback((values: BankTransferFormValues) => {
    formRef.current = values
    setForm(values)
  }, [])
  const replaceBaseline = useCallback((values: BankTransferFormValues) => {
    reset(values)
    setBaseline(values)
  }, [reset])
  const draft = useSettingsDraft({
    scope: 'payments-bank',
    key: `settings:${businessId}:payments-bank:v1`,
    version: DRAFT_VERSION,
    baseline,
    values: form,
    isDirty,
    reset,
    replaceBaseline,
  })

  useUnsavedChangesRegistration({ scope: 'payments-bank', isDirty, discard: draft.discard })

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((previous) => {
      const next = { ...previous, [key]: value }
      formRef.current = next
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitInFlight.current) return
    submitInFlight.current = true
    setIsSubmitting(true)
    setServerError(null)
    setSuccessMessage(null)
    const submittedValues = { ...form }
    try {
      const res = await saveBankTransferAccount({
        ...submittedValues,
        holdHours: Number(submittedValues.holdHours),
        verifyHours: submittedValues.verifyHours.trim() === '' ? null : Number(submittedValues.verifyHours),
      })
      if (!res.ok) { setServerError(res.error); return }
      const persistedValues = res.data
      const formStillMatchesSubmission = sameFormValues(formRef.current, submittedValues)
      setBaseline(persistedValues)
      if (formStillMatchesSubmission) {
        formRef.current = persistedValues
        setForm(persistedValues)
        draft.clearDraft()
      }
      setSuccessMessage('Datos guardados.')
      router.refresh()
    } catch {
      setServerError('Error al guardar')
    } finally {
      submitInFlight.current = false
      setIsSubmitting(false)
    }
  }

  async function handleToggle(next: boolean) {
    setServerError(null)
    try {
      const res = await setBankTransferEnabled(next)
      if (!res.ok) { setServerError(res.error); return }
      router.refresh()
    } catch {
      setServerError('Error al actualizar')
    }
  }

  async function handleProofToggle(next: boolean) {
    setServerError(null)
    try {
      const res = await setRequireTransferProof(next)
      if (!res.ok) { setServerError(res.error); return }
      router.refresh()
    } catch {
      setServerError('Error al actualizar')
    }
  }

  const noVerifyLimit = form.verifyHours.trim() === ''

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
      {account && (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-semibold text-primary">Aceptar transferencias</p>
            <p className="text-sm text-muted-foreground">
              Tus {vocabulary.clients} verán estos datos al reservar y podrán avisarte cuando transfieran.
            </p>
          </div>
          <Switch checked={account.isEnabled} onCheckedChange={handleToggle} />
        </div>
      )}

      {account && proofUploadAvailable && (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-semibold text-primary">Exigir comprobante al declarar transferencia</p>
            <p className="text-sm text-muted-foreground">
              Tus {vocabulary.clients} deberán adjuntar el comprobante de la transferencia para poder avisarte.
            </p>
          </div>
          <Switch checked={requireProof} onCheckedChange={handleProofToggle} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bt-holder">Titular</Label>
          <Input id="bt-holder" value={form.accountHolder} onChange={e => set('accountHolder', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-rut">RUT</Label>
          <Input id="bt-rut" value={form.rut} onChange={e => set('rut', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-bank">Banco</Label>
          <Input id="bt-bank" value={form.bankName} onChange={e => set('bankName', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-type">Tipo de cuenta</Label>
          <Input id="bt-type" value={form.accountType} onChange={e => set('accountType', e.target.value)} placeholder="corriente, vista, ahorro…" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-number">Número de cuenta</Label>
          <Input id="bt-number" value={form.accountNumber} onChange={e => set('accountNumber', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-email">Email para avisos (opcional)</Label>
          <Input id="bt-email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bt-instructions">Instrucciones para {vocabulary.theClient} (opcional)</Label>
        <Textarea id="bt-instructions" value={form.instructions} onChange={e => set('instructions', e.target.value)} rows={2} placeholder="Ej: poné tu nombre y la fecha de la reserva en el asunto" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bt-hold">Plazo para transferir (horas)</Label>
          <Input id="bt-hold" type="number" min={1} max={HOLD_HOURS_MAX} value={form.holdHours} onChange={e => set('holdHours', e.target.value)} required />
          <p className="text-xs text-muted-foreground">Cuánto tiempo se le reserva el horario a {vocabulary.theClient} para que transfiera y te avise.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-verify">Plazo para verificar (horas)</Label>
          <Input id="bt-verify" type="number" min={1} max={VERIFY_HOURS_MAX} value={form.verifyHours} onChange={e => set('verifyHours', e.target.value)} placeholder="vacío = sin límite" />
          {noVerifyLimit ? (
            <p className="text-xs text-orange-600">Vacío = sin límite: el horario queda retenido hasta que verifiques o rechaces la transferencia.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Cuánto tiempo tenés para verificar una transferencia declarada antes de que la reserva expire sola.</p>
          )}
        </div>
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {successMessage && <p className="text-sm text-green-600">{successMessage}</p>}

      <Button type="submit" disabled={isSubmitting} className="h-11">
        {isSubmitting ? 'Guardando…' : 'Guardar datos bancarios'}
      </Button>
    </form>
  )
}
