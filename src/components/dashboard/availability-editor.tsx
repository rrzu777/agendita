'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { TimeInput } from '@/components/ui/time-input'
import { setWeeklyScheduleDay, resetProfessionalSchedule } from '@/server/actions/availability'
import { isValidTimeRange } from '@/lib/availability/time-range'
import type { ScheduleDay } from '@/lib/availability/weekly-schedule'

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

/**
 * Reemplaza un día en la semana. La identidad es `dayOfWeek` y no un id de fila: cuando
 * una persona hereda no hay fila propia todavía. Acá para que esa regla esté escrita una
 * sola vez — estaba en cuatro `map` idénticos, y este PR tuvo que editar los cuatro.
 */
function withDay(days: ScheduleDay[], day: ScheduleDay): ScheduleDay[] {
  return days.map((d) => (d.dayOfWeek === day.dayOfWeek ? day : d))
}
const INVALID_RANGE_MESSAGE = 'La hora de inicio debe ser anterior a la de término'
const SAVE_ERROR_MESSAGE = 'No pudimos guardar los cambios. Intenta de nuevo.'

interface AvailabilityEditorProps {
  days: ScheduleDay[]
  /** `null` = el horario del salón. Un id = el de esa persona. */
  professionalId: string | null
  /** Sólo puede ser `true` con una persona seleccionada: el salón no hereda de nadie. */
  inherited: boolean
  /** Para los textos. El sustantivo de oficio no entra acá: lo elige la pantalla. */
  professionalName: string | null
}

export function AvailabilityEditor({
  days: initialDays,
  professionalId,
  inherited,
  professionalName,
}: AvailabilityEditorProps) {
  // `saved` refleja lo persistido; `drafts` lo que la dueña está editando.
  // Los cambios de hora solo se guardan al apretar "Guardar" — así nunca se
  // publica un horario a medias mientras ajusta ambos extremos.
  const [saved, setSaved] = useState(initialDays)
  const [drafts, setDrafts] = useState(initialDays)
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<Record<number, 'saving' | 'saved'>>({})
  // Deja de heredar en cuanto se guarda un día, y hay que reflejarlo sin recargar: el
  // aviso "sigue el horario del salón" mintiendo después del primer guardado es
  // exactamente la confusión que el aviso existe para evitar.
  const [owns, setOwns] = useState(professionalId !== null && !inherited)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  function clearError(day: number) {
    setErrors(prev => {
      const next = { ...prev }
      delete next[day]
      return next
    })
  }

  function clearStatus(day: number) {
    setStatus(prev => {
      const next = { ...prev }
      delete next[day]
      return next
    })
  }

  async function persist(day: ScheduleDay): Promise<boolean> {
    setStatus(prev => ({ ...prev, [day.dayOfWeek]: 'saving' }))
    try {
      const res = await setWeeklyScheduleDay(professionalId, day)
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [day.dayOfWeek]: res.error }))
        clearStatus(day.dayOfWeek)
        return false
      }
    } catch {
      setErrors(prev => ({ ...prev, [day.dayOfWeek]: SAVE_ERROR_MESSAGE }))
      clearStatus(day.dayOfWeek)
      return false
    }
    // El guardado materializó la semana entera de esta persona (ver `setWeekday`), así
    // que a partir de acá tiene horario propio aunque sólo se haya tocado un día.
    if (professionalId !== null) setOwns(true)
    return true
  }

  async function handleToggle(dayOfWeek: number, isActive: boolean) {
    const day = saved.find(d => d.dayOfWeek === dayOfWeek)
    if (!day) return
    if (isActive && !isValidTimeRange(day.startTime, day.endTime)) {
      setErrors(prev => ({ ...prev, [dayOfWeek]: INVALID_RANGE_MESSAGE }))
      return
    }
    // Abrir/cerrar el día es una acción única: se guarda al tiro con las horas
    // ya persistidas y descarta cualquier borrador pendiente de ese día.
    clearError(dayOfWeek)
    const next = { ...day, isActive }
    if (!(await persist(next))) return
    setSaved(prev => withDay(prev, next))
    setDrafts(prev => withDay(prev, next))
    setStatus(prev => ({ ...prev, [dayOfWeek]: 'saved' }))
  }

  function handleTimeChange(dayOfWeek: number, field: 'startTime' | 'endTime', value: string) {
    const draft = drafts.find(d => d.dayOfWeek === dayOfWeek)
    if (!draft || draft[field] === value) return
    const next = { ...draft, [field]: value }
    setDrafts(prev => withDay(prev, next))
    clearStatus(dayOfWeek)
    if (!isValidTimeRange(next.startTime, next.endTime)) {
      setErrors(prev => ({ ...prev, [dayOfWeek]: INVALID_RANGE_MESSAGE }))
    } else {
      clearError(dayOfWeek)
    }
  }

  async function handleSave(dayOfWeek: number) {
    const draft = drafts.find(d => d.dayOfWeek === dayOfWeek)
    if (!draft || !isValidTimeRange(draft.startTime, draft.endTime)) return
    if (!(await persist(draft))) return
    clearError(dayOfWeek)
    setSaved(prev => withDay(prev, draft))
    setStatus(prev => ({ ...prev, [dayOfWeek]: 'saved' }))
  }

  async function handleReset() {
    if (professionalId === null) return
    setResetting(true)
    setResetError(null)
    try {
      const res = await resetProfessionalSchedule(professionalId)
      if (!res.ok) {
        setResetError(res.error)
        return
      }
      // El horario que vuelve es el DEL SALÓN, y hay que pintarlo: si la pantalla se
      // quedara con las horas propias que se acaban de borrar, mostraría un horario que
      // ya no existe en ningún lado.
      setSaved(res.data.days)
      setDrafts(res.data.days)
      setErrors({})
      setStatus({})
      setOwns(false)
      // Sin `router.refresh()`: la action ya llama `revalidatePath`, y como el `key` del
      // editor no cambia, un re-render del servidor NO reinicializa este `useState`. El
      // repintado sale entero de las tres líneas de arriba; el refresh era una vuelta
      // completa al servidor cuyo resultado este componente descarta.
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Un solo condicional anidado y no dos hermanos: heredar y tener horario propio
          son las dos ramas de la MISMA pregunta, y como dos `if` sueltos nada impide que
          un día se muestren los dos avisos —o ninguno— sin que falle nada. */}
      {professionalId === null ? null : owns ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Tiene horario propio: los cambios del horario del salón ya no le llegan.
          </p>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Button variant="outline" size="sm" className="rounded-full" disabled={resetting} onClick={handleReset}>
              {resetting ? 'Soltando…' : 'Volver al horario del salón'}
            </Button>
            {/* Adentro de esta rama: es el error de ese botón, y afuera podía quedar
                colgado sin nada arriba que explicara de dónde salió. */}
            {resetError ? <p className="text-sm text-destructive">{resetError}</p> : null}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground" role="status">
          Sigue el horario del salón. Si cambiás un día,{' '}
          {professionalName ?? 'esta persona'} pasa a tener horario propio y los días que
          no toques quedan como están hoy.
        </div>
      )}

      {drafts.map((draft) => {
        const savedDay = saved.find(d => d.dayOfWeek === draft.dayOfWeek)!
        const isDirty = draft.startTime !== savedDay.startTime || draft.endTime !== savedDay.endTime
        const dayStatus = status[draft.dayOfWeek]
        return (
          <div key={draft.dayOfWeek} className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center">
            <div className="w-32 font-semibold text-primary">{DAYS[draft.dayOfWeek]}</div>
            <Switch
              checked={savedDay.isActive}
              onCheckedChange={(checked) => handleToggle(draft.dayOfWeek, checked)}
            />
            {savedDay.isActive ? (
              <div className="flex flex-wrap items-center gap-3">
                <TimeInput
                  id={`availability-start-${draft.dayOfWeek}`}
                  value={draft.startTime}
                  onChange={(value) => handleTimeChange(draft.dayOfWeek, 'startTime', value)}
                  ariaLabel={`${DAYS[draft.dayOfWeek]} inicio`}
                  className="w-44"
                />
                <span className="text-muted-foreground">a</span>
                <TimeInput
                  id={`availability-end-${draft.dayOfWeek}`}
                  value={draft.endTime}
                  onChange={(value) => handleTimeChange(draft.dayOfWeek, 'endTime', value)}
                  ariaLabel={`${DAYS[draft.dayOfWeek]} fin`}
                  className="w-44"
                />
                {isDirty ? (
                  <Button
                    size="sm"
                    className="rounded-full px-4"
                    disabled={dayStatus === 'saving' || !isValidTimeRange(draft.startTime, draft.endTime)}
                    onClick={() => handleSave(draft.dayOfWeek)}
                  >
                    {dayStatus === 'saving' ? 'Guardando…' : 'Guardar'}
                  </Button>
                ) : null}
              </div>
            ) : (
              <span className="font-semibold text-muted-foreground">Cerrado</span>
            )}
            {dayStatus === 'saved' && !isDirty ? (
              <span className="text-sm font-medium text-muted-foreground" role="status">Guardado ✓</span>
            ) : null}
            {errors[draft.dayOfWeek] ? (
              <p className="text-sm text-destructive">{errors[draft.dayOfWeek]}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
