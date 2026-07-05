'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { TimeInput } from '@/components/ui/time-input'
import { updateAvailabilityRule } from '@/server/actions/availability'
import { isValidTimeRange } from '@/lib/availability/time-range'

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const INVALID_RANGE_MESSAGE = 'La hora de inicio debe ser anterior a la de término'

export function AvailabilityEditor({ rules: initialRules }: { rules: { id: string; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[] }) {
  const [rules, setRules] = useState(initialRules)
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function handleToggle(id: string, isActive: boolean) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    if (isActive && !isValidTimeRange(rule.startTime, rule.endTime)) {
      setErrors(prev => ({ ...prev, [id]: INVALID_RANGE_MESSAGE }))
      return
    }
    await updateAvailabilityRule(id, { startTime: rule.startTime, endTime: rule.endTime, isActive })
    setRules(rules.map(r => r.id === id ? { ...r, isActive } : r))
  }

  async function handleTimeChange(id: string, field: 'startTime' | 'endTime', value: string) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    if (rule[field] === value) return
    const startTime = field === 'startTime' ? value : rule.startTime
    const endTime = field === 'endTime' ? value : rule.endTime
    // Reflejar el cambio localmente para que la dueña pueda seguir editando el
    // otro campo, pero solo persistir cuando el rango completo es válido.
    setRules(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    if (!isValidTimeRange(startTime, endTime)) {
      setErrors(prev => ({ ...prev, [id]: INVALID_RANGE_MESSAGE }))
      return
    }
    setErrors(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    await updateAvailabilityRule(id, { startTime, endTime, isActive: rule.isActive })
  }

  return (
    <div className="space-y-4">
      {rules.map((rule) => (
        <div key={rule.id} className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center">
          <div className="w-32 font-semibold text-primary">{DAYS[rule.dayOfWeek]}</div>
          <Switch
            checked={rule.isActive}
            onCheckedChange={(checked) => handleToggle(rule.id, checked)}
          />
          {rule.isActive ? (
            <div className="flex flex-wrap items-center gap-3">
              <TimeInput
                id={`availability-start-${rule.id}`}
                value={rule.startTime}
                onChange={(value) => handleTimeChange(rule.id, 'startTime', value)}
                ariaLabel={`${DAYS[rule.dayOfWeek]} inicio`}
                className="w-44"
              />
              <span className="text-muted-foreground">a</span>
              <TimeInput
                id={`availability-end-${rule.id}`}
                value={rule.endTime}
                onChange={(value) => handleTimeChange(rule.id, 'endTime', value)}
                ariaLabel={`${DAYS[rule.dayOfWeek]} fin`}
                className="w-44"
              />
            </div>
          ) : (
            <span className="font-semibold text-muted-foreground">Cerrado</span>
          )}
          {errors[rule.id] ? (
            <p className="text-sm text-destructive">{errors[rule.id]}</p>
          ) : null}
        </div>
      ))}
    </div>
  )
}
