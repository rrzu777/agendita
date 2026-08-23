'use client'

import { CircleHelp, RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useDashboardTours } from './tour-context'

type TourHelpMenuProps = {
  className?: string
  compact?: boolean
  onAcceptedStart?: () => void
}

export function TourHelpMenu({ className, compact = false, onAcceptedStart }: TourHelpMenuProps) {
  const [open, setOpen] = useState(false)
  const compactTriggerRef = useRef<HTMLButtonElement>(null)
  const { helpTours, start } = useDashboardTours()

  if (helpTours.length === 0) return null

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      data-tour-id="tour-help"
      aria-expanded={open}
      onClick={compact ? undefined : () => setOpen((current) => !current)}
      ref={compact ? compactTriggerRef : undefined}
      aria-label={compact ? 'Ayuda y recorridos' : undefined}
      className={cn(
        'w-full gap-3 text-muted-foreground hover:text-sidebar-accent-foreground',
        compact ? 'justify-center px-0' : 'justify-start',
      )}
    >
      <CircleHelp className="size-5 shrink-0" />
      <span className={compact ? 'sr-only' : undefined}>Ayuda y recorridos</span>
    </Button>
  )

  const items = (
    <div className="space-y-2" aria-label="Recorridos disponibles">
      {helpTours.map((tour) => (
        <div key={tour.key} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-primary">{tour.title}</p>
            {tour.status === 'completed' && (
              <p className="text-xs text-muted-foreground">Completado</p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setOpen(false)
              onAcceptedStart?.()
              void start(tour.key, { replay: true })
            }}
          >
            <RotateCcw className="mr-2 size-3.5" />
            Repetir recorrido
          </Button>
        </div>
      ))}
    </div>
  )

  if (compact) {
    return (
      <div className={cn('relative', className)}>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            side="right"
            align="end"
            className="w-80 p-3"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              compactTriggerRef.current?.focus()
            }}
          >
            {items}
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      {trigger}
      {open && (
        <div className="mt-2 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
          {items}
        </div>
      )}
    </div>
  )
}
