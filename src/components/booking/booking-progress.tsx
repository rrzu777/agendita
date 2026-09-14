import { Check } from 'lucide-react'
import type { StepKey } from '@/lib/bookings/wizard-steps'

const stages = [
  { key: 'service', label: 'Servicios' },
  { key: 'professional', label: 'Profesional' },
  { key: 'availability', label: 'Fecha y hora' },
  { key: 'customer', label: 'Tus datos' },
  { key: 'payment', label: 'Pago y políticas' },
  { key: 'confirmation', label: 'Confirmación' },
] as const

type ProfessionalMode = 'pending' | 'choice' | 'automatic'

function stageIndex(step: StepKey) {
  if (step === 'date' || step === 'time') return 2
  return Math.max(0, stages.findIndex((stage) => stage.key === step))
}

export function BookingProgress({
  currentStep,
  professionalMode,
}: {
  currentStep: StepKey
  professionalMode: ProfessionalMode
}) {
  const current = stageIndex(currentStep)

  return (
    <nav aria-label="Progreso de la reserva" className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-4">
        <p className="text-sm font-semibold text-primary">Paso {current + 1} de 6</p>
        <p className="text-right text-sm text-muted-foreground">{stages[current].label}</p>
      </div>
      <ol className="grid grid-cols-6 gap-1.5 sm:gap-2">
        {stages.map((stage, index) => {
          const complete = index < current
          const automatic = stage.key === 'professional' && professionalMode === 'automatic'
          const active = index === current
          return (
            <li
              key={stage.key}
              aria-current={active ? 'step' : undefined}
              className="min-w-0"
            >
              <div className={`mb-1 h-1 rounded-full ${complete || active ? 'bg-primary' : 'bg-secondary'}`} />
              <div className="flex min-h-11 items-start gap-1.5 py-1">
                <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? 'bg-primary text-primary-foreground' : active ? 'border border-primary text-primary' : 'border border-border text-muted-foreground'}`}>
                  {complete ? <Check className="size-3" aria-hidden="true" /> : index + 1}
                </span>
                <span className={`sr-only min-w-0 text-xs leading-4 sm:not-sr-only ${active ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                  {stage.label}
                  {stage.key === 'professional' && (
                    <span className="block text-xs leading-4">
                      {automatic ? 'Asignado automáticamente' : 'Opcional'}
                    </span>
                  )}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
