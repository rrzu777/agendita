'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="start-time">Hora inicio</Label>
          <Input
            id="start-time"
            type="time"
            value={startTime}
            onChange={(e) => onStartTimeChange(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="end-time">Hora fin</Label>
          <Input
            id="end-time"
            type="time"
            value={endTime}
            onChange={(e) => onEndTimeChange(e.target.value)}
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
