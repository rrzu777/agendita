import { AlertTriangle } from 'lucide-react'
import type { Vocabulary } from '@/lib/vocabulary'
import type { ServiceFitResult } from '@/lib/availability/service-fit'

interface ServiceFitWarningsProps {
  fits: ServiceFitResult[]
  vocabulary: Vocabulary
  /**
   * De quién es la semana que se simuló, o `null` si es la del negocio. Sin esto el
   * aviso dice "tu horario" arriba del horario de otra persona, que es la lectura
   * exactamente equivocada: manda a ampliar el horario del negocio cuando lo que hay
   * que tocar es el suyo.
   */
  scopeName?: string | null
}

/**
 * Avisos destacados por cada servicio activo que no cabe en ningún día con el
 * horario y los bloqueos actuales. Presentacional y estático (server-safe).
 */
export function ServiceFitWarnings({ fits, vocabulary, scopeName = null }: ServiceFitWarningsProps) {
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
            {scopeName === null
              ? ' no cabe en ningún día con tu horario y bloqueos actuales. Amplía un horario o ajusta tus bloqueos'
              : ` no cabe en ningún día con el horario y los bloqueos de ${scopeName}. Amplía su horario o ajusta sus bloqueos`}
            {' '}para que tus {vocabulary.clients} puedan reservarlo.
          </p>
        </div>
      ))}
    </div>
  )
}
