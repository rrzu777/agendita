'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TimeInput } from '@/components/ui/time-input'

interface BlockFormFieldsProps {
  date: string
  onDateChange: (value: string) => void
  startTime: string
  onStartTimeChange: (value: string) => void
  endTime: string
  onEndTimeChange: (value: string) => void
  reason: string
  onReasonChange: (value: string) => void
}

export function BlockFormFields({
  date,
  onDateChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  reason,
  onReasonChange,
}: BlockFormFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor="block-date">Fecha</Label>
        <Input
          id="block-date"
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="start-time">Hora inicio</Label>
          <TimeInput
            id="start-time"
            value={startTime}
            onChange={onStartTimeChange}
            ariaLabel="Hora inicio"
          />
        </div>
        <div>
          <Label htmlFor="end-time">Hora fin</Label>
          <TimeInput
            id="end-time"
            value={endTime}
            onChange={onEndTimeChange}
            ariaLabel="Hora fin"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="block-reason">Motivo (opcional)</Label>
        <Input
          id="block-reason"
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Ej: Almuerzo, reunión..."
          maxLength={255}
        />
      </div>
    </>
  )
}
