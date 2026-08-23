'use client'

import { CircleHelp, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDashboardTours } from './tour-context'

type TourHelpMenuProps = {
  className?: string
  compact?: boolean
}

export function TourHelpMenu({ className, compact = false }: TourHelpMenuProps) {
  const [open, setOpen] = useState(false)
  const { helpTours, start } = useDashboardTours()

  if (helpTours.length === 0) return null

  return (
    <div className={cn('relative', className)}>
      <Button
        type="button"
        variant="ghost"
        data-tour-id="tour-help"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        aria-label={compact ? 'Ayuda y recorridos' : undefined}
        className={cn(
          'w-full gap-3 text-muted-foreground hover:text-sidebar-accent-foreground',
          compact ? 'justify-center px-0' : 'justify-start',
        )}
      >
        <CircleHelp className="size-5 shrink-0" />
        <span className={compact ? 'sr-only' : undefined}>Ayuda y recorridos</span>
      </Button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-border/60 bg-card p-3 shadow-sm" aria-label="Recorridos disponibles">
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
                  void start(tour.key, { replay: true })
                }}
              >
                <RotateCcw className="mr-2 size-3.5" />
                Repetir recorrido
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
