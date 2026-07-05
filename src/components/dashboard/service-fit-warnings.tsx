import { AlertTriangle } from 'lucide-react'
import type { ServiceFitResult } from '@/lib/availability/service-fit'

interface ServiceFitWarningsProps {
  fits: ServiceFitResult[]
}

/**
 * Avisos destacados por cada servicio activo que no cabe en ningún día con el
 * horario y los bloqueos actuales. Presentacional y estático (server-safe).
 */
export function ServiceFitWarnings({ fits }: ServiceFitWarningsProps) {
  const misfits = fits.filter((f) => f.fitsNowhere)
  if (misfits.length === 0) return null

  return (
    <div className="space-y-3" role="alert">
      {misfits.map((fit) => (
        <div
          key={fit.serviceId}
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-semibold">
              &quot;{fit.serviceName}&quot; ({fit.durationMinutes} min)
            </span>{' '}
            no cabe en ningún día con tu horario y bloqueos actuales. Amplía un horario o ajusta tus
            bloqueos para que tus clientas puedan reservarlo.
          </p>
        </div>
      ))}
    </div>
  )
}
