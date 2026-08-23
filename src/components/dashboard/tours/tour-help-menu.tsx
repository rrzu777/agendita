'use client'

import { CircleHelp, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useDashboardTours } from './tour-context'

type TourHelpMenuProps = {
  className?: string
  compact?: boolean
  onAcceptedStart?: () => void | Promise<void>
}

function waitForCompactPopoverExit(): Promise<void> {
  const selector = '[data-tour-help-popover]'
  if (!document.querySelector(selector)) return Promise.resolve()

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) return
      observer.disconnect()
      resolve()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

export function TourHelpMenu({ className, compact = false, onAcceptedStart }: TourHelpMenuProps) {
  const [open, setOpen] = useState(false)
  const compactTriggerRef = useRef<HTMLButtonElement>(null)
  const compactPopoverWasOpenRef = useRef(false)
  const { helpTours, start } = useDashboardTours()

  useEffect(() => {
    if (!compact) return
    if (open) {
      compactPopoverWasOpenRef.current = true
      return
    }
    if (!compactPopoverWasOpenRef.current) return
    compactPopoverWasOpenRef.current = false

    const selector = '[data-tour-help-popover]'
    const restoreFocus = () => compactTriggerRef.current?.focus()
    if (!document.querySelector(selector)) {
      restoreFocus()
      return
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) return
      observer.disconnect()
      restoreFocus()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [compact, open])

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
              void (async () => {
                setOpen(false)
                if (compact) {
                  await waitForCompactPopoverExit()
                  compactTriggerRef.current?.focus({ preventScroll: true })
                }
                await onAcceptedStart?.()
                if (tour.status === 'completed' || tour.status === 'dismissed') {
                  await start(tour.key, { replay: true })
                  return
                }
                await start(tour.key)
              })()
            }}
          >
            {(tour.status === 'completed' || tour.status === 'dismissed') && (
              <RotateCcw className="mr-2 size-3.5" />
            )}
            {tour.status === 'completed' || tour.status === 'dismissed'
              ? 'Repetir recorrido'
              : tour.status === 'in_progress'
                ? 'Continuar recorrido'
                : 'Iniciar recorrido'}
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
            data-tour-help-popover
            onCloseAutoFocus={(event) => {
              event.preventDefault()
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
