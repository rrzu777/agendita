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
  /** Tolerancia de solape en minutos (string del input). Si no se pasa handler, el campo no se muestra. */
  overlapTolerance?: string
  onOverlapToleranceChange?: (value: string) => void
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
  overlapTolerance,
  onOverlapToleranceChange,
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

      {onOverlapToleranceChange ? (
        <div>
          <Label htmlFor="block-overlap-tolerance">Permitir que una cita invada hasta (min)</Label>
          <Input
            id="block-overlap-tolerance"
            type="number"
            min={0}
            max={240}
            step={5}
            value={overlapTolerance ?? '0'}
            onChange={(e) => onOverlapToleranceChange(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            0 = el bloqueo es estricto. Con tolerancia, una cita puede pisar los primeros o últimos minutos del bloqueo.
          </p>
        </div>
      ) : null}
    </>
  )
}
