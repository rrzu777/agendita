'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { formatBookingDateTime } from '@/lib/booking/format-booking-datetime'
import type { BankTransferPublicInfo } from '@/lib/bank-transfer/public-info'
import { isAllowedProofType, PROOF_MAX_BYTES } from '@/lib/storage/proof'
import { createProofUploadUrl } from '@/server/actions/bank-transfer-public'

/** Datos bancarios + adjuntar comprobante + botón "Ya transferí". Cliente: sube
 *  el archivo directo a R2 (presign PUT) y pasa la key al handler de declarar.
 *  Lo usan el paso de pago del wizard y el panel de /book/confirmation. */
export function TransferDetails({
  bank,
  amount,
  deadline,
  timezone,
  declaring,
  onDeclare,
  bookingId,
  kind = 'deposit',
}: {
  bank: BankTransferPublicInfo
  amount: number
  deadline: Date | null
  timezone: string
  declaring: boolean
  onDeclare: (proof: { proofKey: string; proofContentType: string } | null) => void
  bookingId: string
  /** 'balance' = saldo restante: cambia el label del monto (sin plazo — deadline ya es null en ese caso). */
  kind?: 'deposit' | 'balance'
}) {
  const [selectedError, setSelectedError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // key + tipo se setean/limpian siempre juntos → un solo estado los mantiene en sync.
  const [uploaded, setUploaded] = useState<{ key: string; type: string } | null>(null)

  const rows: Array<[string, string]> = [
    ['Titular', bank.accountHolder],
    ['RUT', bank.rut],
    ['Banco', bank.bankName],
    ['Tipo de cuenta', bank.accountType],
    ['Número de cuenta', bank.accountNumber],
  ]
  if (bank.email) rows.push(['Email', bank.email])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setSelectedError(null)
    setUploaded(null)
    if (!file) return

    if (!isAllowedProofType(file.type)) {
      setSelectedError('Tipo de archivo no permitido')
      return
    }
    if (file.size > PROOF_MAX_BYTES) {
      setSelectedError('El archivo supera 5 MB')
      return
    }

    setUploading(true)
    try {
      const { uploadUrl, key } = await createProofUploadUrl(bookingId, kind, file.type)
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (res.ok) {
        setUploaded({ key, type: file.type })
      } else {
        setSelectedError('No pudimos subir el comprobante. Intentá de nuevo.')
      }
    } catch {
      setSelectedError('No pudimos subir el comprobante. Intentá de nuevo.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-muted/55 p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          Transferí el {kind === 'balance' ? 'saldo' : 'abono'} de <span className="font-semibold text-primary">{formatMoney(amount)}</span> a esta cuenta:
        </p>
        <div className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold text-primary">{value}</span>
            </div>
          ))}
        </div>
        {bank.instructions && (
          <p className="mt-3 rounded-lg bg-background/70 p-3 text-sm text-muted-foreground">{bank.instructions}</p>
        )}
      </div>

      {deadline && (
        <p className="text-sm text-muted-foreground">
          Tenés hasta el <span className="font-semibold text-primary">{formatBookingDateTime(deadline, timezone)}</span> para
          transferir y avisarnos. Después de eso el horario se libera.
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="transfer-proof" className="block text-sm font-semibold text-primary">
          Comprobante{bank.requireProof ? ' (obligatorio)' : ''}
        </label>
        {!bank.requireProof && (
          <p className="text-sm text-muted-foreground">Adjuntar comprobante (opcional)</p>
        )}
        <input
          id="transfer-proof"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFileChange}
          disabled={uploading || declaring}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary"
        />
        {uploading && <p className="text-sm text-muted-foreground">Subiendo comprobante…</p>}
        {uploaded && <p className="text-sm text-primary">Comprobante cargado ✓</p>}
        {selectedError && <p className="text-sm text-destructive">{selectedError}</p>}
      </div>

      <Button
        className="h-12 w-full rounded-full text-base font-semibold"
        onClick={() => onDeclare(uploaded ? { proofKey: uploaded.key, proofContentType: uploaded.type } : null)}
        disabled={declaring || uploading || (bank.requireProof && !uploaded)}
      >
        {declaring ? 'Avisando…' : 'Ya transferí'}
      </Button>
    </div>
  )
}
