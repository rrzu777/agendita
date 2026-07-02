'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { SeriesEndMode } from '@/lib/calendar/expand-series'

const DAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

interface RecurrenceFieldsProps {
  recurring: boolean
  onRecurringChange: (value: boolean) => void
  daysOfWeek: number[]
  onDaysOfWeekChange: (value: number[]) => void
  endMode: SeriesEndMode
  onEndModeChange: (value: SeriesEndMode) => void
  weeks: number
  onWeeksChange: (value: number) => void
}

export function RecurrenceFields({
  recurring, onRecurringChange,
  daysOfWeek, onDaysOfWeekChange,
  endMode, onEndModeChange,
  weeks, onWeeksChange,
}: RecurrenceFieldsProps) {
  function toggleDay(day: number) {
    onDaysOfWeekChange(daysOfWeek.includes(day) ? daysOfWeek.filter((d) => d !== day) : [...daysOfWeek, day])
  }

  return (
    <div className="rounded-xl border border-muted-foreground/30 bg-muted/30 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="recurring"
          checked={recurring}
          onChange={(e) => onRecurringChange(e.target.checked)}
          className="size-3.5 rounded border-muted-foreground/50 accent-primary"
        />
        <label htmlFor="recurring" className="text-sm font-medium">Repetir</label>
      </div>

      {recurring && (
        <>
          <div>
            <Label>Días de la semana</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={daysOfWeek.includes(d.value)}
                  className={
                    'rounded-lg border px-2.5 py-1 text-xs ' +
                    (daysOfWeek.includes(d.value)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/30 text-muted-foreground')
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="end-mode">Repetir durante</Label>
            <div className="mt-1 space-y-1.5 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="end-mode" checked={endMode === 'forever'} onChange={() => onEndModeChange('forever')} className="accent-primary" />
                Para siempre
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="end-mode" checked={endMode === 'month'} onChange={() => onEndModeChange('month')} className="accent-primary" />
                1 mes
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="end-mode" checked={endMode === 'weeks'} onChange={() => onEndModeChange('weeks')} className="accent-primary" />
                <span className="flex items-center gap-1.5">
                  <Input id="end-weeks" type="number" min={1} max={52} value={weeks} onChange={(e) => onWeeksChange(Number(e.target.value))} className="h-7 w-16" onFocus={() => onEndModeChange('weeks')} />
                  semanas
                </span>
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
