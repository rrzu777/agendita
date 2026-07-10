'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { saveBankTransferAccount, setBankTransferEnabled } from '@/server/actions/bank-transfer-settings'

export interface BankTransferAccountView {
  accountHolder: string
  rut: string
  bankName: string
  accountType: string
  accountNumber: string
  email: string | null
  instructions: string | null
  isEnabled: boolean
  holdHours: number
  verifyHours: number | null
}

export function BankTransferForm({ account }: { account: BankTransferAccountView | null }) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [form, setForm] = useState({
    accountHolder: account?.accountHolder ?? '',
    rut: account?.rut ?? '',
    bankName: account?.bankName ?? '',
    accountType: account?.accountType ?? '',
    accountNumber: account?.accountNumber ?? '',
    email: account?.email ?? '',
    instructions: account?.instructions ?? '',
    holdHours: String(account?.holdHours ?? 24),
    // '' representa null = sin límite
    verifyHours: account && account.verifyHours == null ? '' : String(account?.verifyHours ?? 48),
  })

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)
    setServerError(null)
    setSuccessMessage(null)
    try {
      await saveBankTransferAccount({
        accountHolder: form.accountHolder,
        rut: form.rut,
        bankName: form.bankName,
        accountType: form.accountType,
        accountNumber: form.accountNumber,
        email: form.email,
        instructions: form.instructions,
        holdHours: Number(form.holdHours),
        verifyHours: form.verifyHours.trim() === '' ? null : Number(form.verifyHours),
      })
      setSuccessMessage('Datos guardados.')
      router.refresh()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggle(next: boolean) {
    setServerError(null)
    try {
      await setBankTransferEnabled(next)
      router.refresh()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Error al actualizar')
    }
  }

  const noVerifyLimit = form.verifyHours.trim() === ''

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {account && (
        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-semibold text-primary">Aceptar transferencias</p>
            <p className="text-sm text-muted-foreground">
              Tus clientas verán estos datos al reservar y podrán avisarte cuando transfieran.
            </p>
          </div>
          <Switch checked={account.isEnabled} onCheckedChange={handleToggle} />
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
        <Label htmlFor="bt-instructions">Instrucciones para la clienta (opcional)</Label>
        <Textarea id="bt-instructions" value={form.instructions} onChange={e => set('instructions', e.target.value)} rows={2} placeholder="Ej: poné tu nombre y la fecha de la reserva en el asunto" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bt-hold">Plazo para transferir (horas)</Label>
          <Input id="bt-hold" type="number" min={1} max={168} value={form.holdHours} onChange={e => set('holdHours', e.target.value)} required />
          <p className="text-xs text-muted-foreground">Cuánto tiempo se le reserva el horario a la clienta para que transfiera y te avise.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-verify">Plazo para verificar (horas)</Label>
          <Input id="bt-verify" type="number" min={1} max={720} value={form.verifyHours} onChange={e => set('verifyHours', e.target.value)} placeholder="vacío = sin límite" />
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
