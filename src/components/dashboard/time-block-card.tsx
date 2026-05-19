'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Lock } from 'lucide-react'

export type CalendarTimeBlock = {
  id: string
  startDateTime: string
  endDateTime: string
  reason?: string | null
}

interface TimeBlockCardProps {
  timeBlock: CalendarTimeBlock
}

export function TimeBlockCard({ timeBlock }: TimeBlockCardProps) {
  const start = new Date(timeBlock.startDateTime)
  const end = new Date(timeBlock.endDateTime)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-3 md:p-4">
      <Lock className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-muted-foreground">
          {format(start, 'HH:mm', { locale: es })} - {format(end, 'HH:mm', { locale: es })}
        </div>
        {timeBlock.reason && (
          <div className="text-xs text-muted-foreground">{timeBlock.reason}</div>
        )}
      </div>
    </div>
  )
}
