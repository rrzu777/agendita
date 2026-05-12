'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { updateAvailabilityRule } from '@/server/actions/availability'

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function AvailabilityEditor({ rules: initialRules }: { rules: any[] }) {
  const [rules, setRules] = useState(initialRules)

  async function handleToggle(id: string, isActive: boolean) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    await updateAvailabilityRule(id, { startTime: rule.startTime, endTime: rule.endTime, isActive })
    setRules(rules.map(r => r.id === id ? { ...r, isActive } : r))
  }

  async function handleTimeChange(id: string, field: 'startTime' | 'endTime', value: string) {
    const rule = rules.find(r => r.id === id)
    if (!rule) return
    await updateAvailabilityRule(id, { startTime: field === 'startTime' ? value : rule.startTime, endTime: field === 'endTime' ? value : rule.endTime, isActive: rule.isActive })
    setRules(rules.map(r => r.id === id ? { ...r, [field]: value } : r))
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
              <Input
                type="time"
                value={rule.startTime}
                onChange={(e) => handleTimeChange(rule.id, 'startTime', e.target.value)}
                className="studio-input w-32"
              />
              <span className="text-muted-foreground">a</span>
              <Input
                type="time"
                value={rule.endTime}
                onChange={(e) => handleTimeChange(rule.id, 'endTime', e.target.value)}
                className="studio-input w-32"
              />
            </div>
          ) : (
            <span className="font-semibold text-muted-foreground">Cerrado</span>
          )}
        </div>
      ))}
    </div>
  )
}
