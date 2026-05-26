'use client'

import { formatInTimeZone } from 'date-fns-tz'
import { es } from 'date-fns/locale'
import { Lock } from 'lucide-react'
import { DeleteBlockButton } from './block-time-modal'

export type CalendarTimeBlock = {
  id: string
  startDateTime: string
  endDateTime: string
  reason?: string | null
}

interface TimeBlockCardProps {
  timeBlock: CalendarTimeBlock
  timezone: string
}

export function TimeBlockCard({ timeBlock, timezone }: TimeBlockCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-3 md:p-4">
      <Lock className="size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-muted-foreground">
          {formatInTimeZone(new Date(timeBlock.startDateTime), timezone, 'HH:mm', { locale: es })}
          {' - '}
          {formatInTimeZone(new Date(timeBlock.endDateTime), timezone, 'HH:mm', { locale: es })}
        </div>
        {timeBlock.reason && (
          <div className="text-xs text-muted-foreground">{timeBlock.reason}</div>
        )}
      </div>
      <DeleteBlockButton blockId={timeBlock.id} />
    </div>
  )
}
