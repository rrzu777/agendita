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
        <div key={rule.id} className="flex items-center gap-4 bg-white p-4 rounded-lg border">
          <div className="w-28 font-medium">{DAYS[rule.dayOfWeek]}</div>
          <Switch
            checked={rule.isActive}
            onCheckedChange={(checked) => handleToggle(rule.id, checked)}
          />
          {rule.isActive ? (
            <>
              <Input
                type="time"
                value={rule.startTime}
                onChange={(e) => handleTimeChange(rule.id, 'startTime', e.target.value)}
                className="w-32"
              />
              <span className="text-gray-500">a</span>
              <Input
                type="time"
                value={rule.endTime}
                onChange={(e) => handleTimeChange(rule.id, 'endTime', e.target.value)}
                className="w-32"
              />
            </>
          ) : (
            <span className="text-gray-400">Cerrado</span>
          )}
        </div>
      ))}
    </div>
  )
}
