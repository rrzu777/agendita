'use client'

import { cn } from '@/lib/utils'

interface TimeInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
}

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'))

function parseTime(value: string) {
  if (!value) return { hour: '', minute: '' }

  const [hour = '00', minute = '00'] = value.split(':')
  const paddedHour = hour.padStart(2, '0')
  const paddedMinute = minute.padStart(2, '0')

  return {
    hour: HOURS.includes(paddedHour) ? paddedHour : '00',
    minute: MINUTES.includes(paddedMinute) ? paddedMinute : '00',
  }
}

export function TimeInput({ id, value, onChange, ariaLabel, disabled, className }: TimeInputProps) {
  const { hour, minute } = parseTime(value)
  const hasEmptyValue = hour === '' || minute === ''

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <select
        id={id}
        value={hour}
        onChange={(e) => onChange(`${e.target.value}:${minute || '00'}`)}
        disabled={disabled}
        aria-label={`${ariaLabel} hora`}
        className="h-10 w-20 rounded-lg border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
      >
        {hasEmptyValue && <option value="">--</option>}
        {HOURS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="text-sm font-medium text-muted-foreground">:</span>
      <select
        value={minute}
        onChange={(e) => onChange(`${hour || '00'}:${e.target.value}`)}
        disabled={disabled}
        aria-label={`${ariaLabel} minutos`}
        className="h-10 w-20 rounded-lg border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50"
      >
        {hasEmptyValue && <option value="">--</option>}
        {MINUTES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}
