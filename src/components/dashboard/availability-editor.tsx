'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { TimeInput } from '@/components/ui/time-input'
import { updateAvailabilityRule } from '@/server/actions/availability'
import { isValidTimeRange } from '@/lib/availability/time-range'

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const INVALID_RANGE_MESSAGE = 'La hora de inicio debe ser anterior a la de término'
const SAVE_ERROR_MESSAGE = 'No pudimos guardar los cambios. Intenta de nuevo.'

type Rule = { id: string; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }

export function AvailabilityEditor({ rules: initialRules }: { rules: Rule[] }) {
  // `saved` refleja lo persistido; `drafts` lo que la dueña está editando.
  // Los cambios de hora solo se guardan al apretar "Guardar" — así nunca se
  // publica un horario a medias mientras ajusta ambos extremos.
  const [saved, setSaved] = useState(initialRules)
  const [drafts, setDrafts] = useState(initialRules)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Record<string, 'saving' | 'saved'>>({})

  function clearError(id: string) {
    setErrors(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  async function handleToggle(id: string, isActive: boolean) {
    const rule = saved.find(r => r.id === id)
    if (!rule) return
    if (isActive && !isValidTimeRange(rule.startTime, rule.endTime)) {
      setErrors(prev => ({ ...prev, [id]: INVALID_RANGE_MESSAGE }))
      return
    }
    // Abrir/cerrar el día es una acción única: se guarda al tiro con las horas
    // ya persistidas y descarta cualquier borrador pendiente de ese día.
    clearError(id)
    setStatus(prev => ({ ...prev, [id]: 'saving' }))
    try {
      await updateAvailabilityRule(id, { startTime: rule.startTime, endTime: rule.endTime, isActive })
    } catch {
      setErrors(prev => ({ ...prev, [id]: SAVE_ERROR_MESSAGE }))
      setStatus(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    setSaved(prev => prev.map(r => r.id === id ? { ...r, isActive } : r))
    setDrafts(prev => prev.map(r => r.id === id ? { ...rule, isActive } : r))
    setStatus(prev => ({ ...prev, [id]: 'saved' }))
  }

  function handleTimeChange(id: string, field: 'startTime' | 'endTime', value: string) {
    const draft = drafts.find(r => r.id === id)
    if (!draft || draft[field] === value) return
    const next = { ...draft, [field]: value }
    setDrafts(prev => prev.map(r => r.id === id ? next : r))
    setStatus(prev => {
      const rest = { ...prev }
      delete rest[id]
      return rest
    })
    if (!isValidTimeRange(next.startTime, next.endTime)) {
      setErrors(prev => ({ ...prev, [id]: INVALID_RANGE_MESSAGE }))
    } else {
      clearError(id)
    }
  }

  async function handleSave(id: string) {
    const draft = drafts.find(r => r.id === id)
    if (!draft || !isValidTimeRange(draft.startTime, draft.endTime)) return
    setStatus(prev => ({ ...prev, [id]: 'saving' }))
    try {
      await updateAvailabilityRule(id, { startTime: draft.startTime, endTime: draft.endTime, isActive: draft.isActive })
    } catch {
      setErrors(prev => ({ ...prev, [id]: SAVE_ERROR_MESSAGE }))
      setStatus(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    clearError(id)
    setSaved(prev => prev.map(r => r.id === id ? draft : r))
    setStatus(prev => ({ ...prev, [id]: 'saved' }))
  }

  return (
    <div className="space-y-4">
      {drafts.map((draft) => {
        const savedRule = saved.find(r => r.id === draft.id)!
        const isDirty = draft.startTime !== savedRule.startTime || draft.endTime !== savedRule.endTime
        const ruleStatus = status[draft.id]
        return (
          <div key={draft.id} className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center">
            <div className="w-32 font-semibold text-primary">{DAYS[draft.dayOfWeek]}</div>
            <Switch
              checked={savedRule.isActive}
              onCheckedChange={(checked) => handleToggle(draft.id, checked)}
            />
            {savedRule.isActive ? (
              <div className="flex flex-wrap items-center gap-3">
                <TimeInput
                  id={`availability-start-${draft.id}`}
                  value={draft.startTime}
                  onChange={(value) => handleTimeChange(draft.id, 'startTime', value)}
                  ariaLabel={`${DAYS[draft.dayOfWeek]} inicio`}
                  className="w-44"
                />
                <span className="text-muted-foreground">a</span>
                <TimeInput
                  id={`availability-end-${draft.id}`}
                  value={draft.endTime}
                  onChange={(value) => handleTimeChange(draft.id, 'endTime', value)}
                  ariaLabel={`${DAYS[draft.dayOfWeek]} fin`}
                  className="w-44"
                />
                {isDirty ? (
                  <Button
                    size="sm"
                    className="rounded-full px-4"
                    disabled={ruleStatus === 'saving' || !isValidTimeRange(draft.startTime, draft.endTime)}
                    onClick={() => handleSave(draft.id)}
                  >
                    {ruleStatus === 'saving' ? 'Guardando…' : 'Guardar'}
                  </Button>
                ) : null}
              </div>
            ) : (
              <span className="font-semibold text-muted-foreground">Cerrado</span>
            )}
            {ruleStatus === 'saved' && !isDirty ? (
              <span className="text-sm font-medium text-muted-foreground" role="status">Guardado ✓</span>
            ) : null}
            {errors[draft.id] ? (
              <p className="text-sm text-destructive">{errors[draft.id]}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
