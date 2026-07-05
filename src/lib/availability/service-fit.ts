import { addDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { generateSlots, type AvailabilityRuleLike, type TimeBlockLike } from './slots'

/**
 * Días de la semana simulada. Los consumidores que cargan bloqueos efectivos
 * deben cubrir [now, now + SERVICE_FIT_WINDOW_DAYS + 1) — la simulación corre
 * sobre los días now+1..now+SERVICE_FIT_WINDOW_DAYS.
 */
export const SERVICE_FIT_WINDOW_DAYS = 7

export interface ServiceFitServiceLike {
  id: string
  name: string
  durationMinutes: number
  isActive: boolean
}

export interface ServiceFitResult {
  serviceId: string
  serviceName: string
  durationMinutes: number
  /** Días locales yyyy-MM-dd de la semana simulada con ≥1 slot posible. */
  daysWithSlots: string[]
  /** true si el servicio no cabe en ningún día de la semana simulada. */
  fitsNowhere: boolean
}

/**
 * Simula una semana representativa (los 7 días siguientes a `now`, todos en el
 * futuro para que ningún corte de "ya pasó" contamine el resultado) con
 * `generateSlots` — sin reservas y sin lead time — y devuelve, por servicio
 * activo, en qué días cabe al menos un slot. Un servicio con `fitsNowhere`
 * es imposible de reservar con el horario y los bloqueos actuales, y la dueña
 * debería enterarse antes de que lo hagan sus clientas.
 *
 * `effectiveBlocks` debe cubrir la ventana simulada (now+1 .. now+7 días).
 */
export function computeServiceFit(
  services: ServiceFitServiceLike[],
  rules: AvailabilityRuleLike[],
  effectiveBlocks: TimeBlockLike[],
  timezone: string,
  now: Date = new Date(),
): ServiceFitResult[] {
  const days = Array.from({ length: SERVICE_FIT_WINDOW_DAYS }, (_, i) => addDays(now, i + 1))

  return services
    .filter((s) => s.isActive)
    .map((service) => {
      const daysWithSlots = days
        .filter(
          (day) =>
            generateSlots(day, service.durationMinutes, rules, effectiveBlocks, [], {
              timezone,
              now,
              leadTimeMinutes: 0,
            }).length > 0,
        )
        .map((day) => formatInTimeZone(day, timezone, 'yyyy-MM-dd'))

      return {
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        daysWithSlots,
        fitsNowhere: daysWithSlots.length === 0,
      }
    })
}
