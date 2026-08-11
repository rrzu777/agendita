import { cancellationWarningText } from '@/lib/bookings/cancellation-policy'

function LegalAcceptanceLabel() {
  return (
    <span>
      Acepto la{' '}
      <a href="/refund-policy" target="_blank" className="font-semibold text-primary underline">
        política de cancelación y reembolso
      </a>{' '}
      del negocio, la{' '}
      <a href="/privacy" target="_blank" className="font-semibold text-primary underline">
        Política de Privacidad
      </a>{' '}
      y los{' '}
      <a href="/terms" target="_blank" className="font-semibold text-primary underline">
        Términos y Condiciones
      </a>{' '}
      de Agendita
    </span>
  )
}

function BusinessCancellationPolicy({ policy }: { policy?: string | null }) {
  if (!policy) return null

  return (
    <div className="mb-4 rounded-xl border border-border/70 bg-muted/40 p-4 text-sm text-muted-foreground">
      <p className="font-semibold text-primary">Condiciones adicionales</p>
      <p className="mt-1 whitespace-pre-line">{policy}</p>
    </div>
  )
}

export function BookingLegalAcceptance({
  policy,
  cutoffHours,
  hasDeposit,
  accepted,
  onAcceptedChange,
  inputId = 'accept-terms',
}: {
  policy?: string | null
  cutoffHours: number
  hasDeposit: boolean
  accepted: boolean
  onAcceptedChange: (accepted: boolean) => void
  inputId?: string
}) {
  const warning = hasDeposit ? cancellationWarningText(cutoffHours) : null

  return (
    <>
      {warning && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Importante sobre tu abono</p>
          <p className="mt-1">{warning}</p>
        </div>
      )}
      <BusinessCancellationPolicy policy={policy} />

      <div className="mb-4 flex items-start gap-3">
        <input
          type="checkbox"
          id={inputId}
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
          className="mt-0.5 size-4 rounded border-border accent-primary"
        />
        <label htmlFor={inputId} className="text-sm text-muted-foreground">
          <LegalAcceptanceLabel />
        </label>
      </div>
    </>
  )
}
