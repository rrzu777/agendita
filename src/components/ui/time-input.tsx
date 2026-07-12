'use client'

import { type MouseEvent, useState } from 'react'
import { ChevronDown, Clock3 } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
const QUICK_MINUTES = ['00', '15', '30', '45']

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
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const { hour, minute } = parseTime(value)
  const selectedHour = hour || '00'
  const selectedMinute = minute || '00'
  const displayValue = hour && minute ? `${hour}:${minute}` : '--:--'

  const [draftTime, setDraftTime] = useState({ hour: selectedHour, minute: selectedMinute })

  function handlePopoverOpenChange(open: boolean) {
    if (open) setDraftTime({ hour: selectedHour, minute: selectedMinute })
    setIsPopoverOpen(open)
  }

  function handleSheetOpenChange(open: boolean) {
    if (open) setDraftTime({ hour: selectedHour, minute: selectedMinute })
    setIsSheetOpen(open)
  }

  function applyDraftTime() {
    onChange(`${draftTime.hour}:${draftTime.minute}`)
    setIsPopoverOpen(false)
    setIsSheetOpen(false)
  }

  function openMobileSheet(event: MouseEvent<HTMLButtonElement>) {
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
      event.preventDefault()
      handleSheetOpenChange(true)
    }
  }

  return (
    <div className={cn('inline-flex', className)}>
      <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger
          id={id}
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={openMobileSheet}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-10 min-w-[8.5rem] justify-between gap-3 px-3 text-left'
          )}
        >
          <span className="inline-flex items-center gap-2">
            <Clock3 className="size-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium tabular-nums">{displayValue}</span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-4 p-4">
          <TimePanel
            selectedHour={draftTime.hour}
            selectedMinute={draftTime.minute}
            minuteOptions={getMinuteOptions(draftTime.minute)}
            onSelectHour={(nextHour) => setDraftTime((current) => ({ ...current, hour: nextHour }))}
            onSelectMinute={(nextMinute) => setDraftTime((current) => ({ ...current, minute: nextMinute }))}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => setIsPopoverOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={applyDraftTime}>
              Aplicar
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Sheet open={isSheetOpen} onOpenChange={handleSheetOpenChange}>
        <SheetContent side="bottom" className="z-[70] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]" showCloseButton={false}>
          <SheetHeader className="border-b">
            <SheetTitle>{ariaLabel}</SheetTitle>
            <SheetDescription>Selecciona hora y minutos</SheetDescription>
          </SheetHeader>
          <div className="px-4 py-5">
            <div className="mb-5 rounded-lg bg-muted/50 px-4 py-5 text-center font-mono text-4xl font-semibold tabular-nums">
              {draftTime.hour}:{draftTime.minute}
            </div>
            <TimePanel
              selectedHour={draftTime.hour}
              selectedMinute={draftTime.minute}
              minuteOptions={getMinuteOptions(draftTime.minute)}
              onSelectHour={(nextHour) => setDraftTime((current) => ({ ...current, hour: nextHour }))}
              onSelectMinute={(nextMinute) => setDraftTime((current) => ({ ...current, minute: nextMinute }))}
              relaxed
            />
          </div>
          <SheetFooter className="grid grid-cols-2 border-t">
            <Button type="button" variant="outline" onClick={() => setIsSheetOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={applyDraftTime}>
              Aplicar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TimePanel({
  selectedHour,
  selectedMinute,
  minuteOptions,
  onSelectHour,
  onSelectMinute,
  relaxed = false,
}: {
  selectedHour: string
  selectedMinute: string
  minuteOptions: string[]
  onSelectHour: (hour: string) => void
  onSelectMinute: (minute: string) => void
  relaxed?: boolean
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Hora</div>
        <div className={cn('grid grid-cols-6 gap-1.5', relaxed && 'gap-2')}>
          {HOURS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === selectedHour ? 'default' : 'ghost'}
              size={relaxed ? 'default' : 'sm'}
              aria-pressed={option === selectedHour}
              onClick={() => onSelectHour(option)}
              className="font-mono tabular-nums"
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Minutos</div>
        <div className={cn('grid grid-cols-4 gap-2', minuteOptions.length > 4 && 'grid-cols-5')}>
          {minuteOptions.map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === selectedMinute ? 'default' : 'outline'}
              size={relaxed ? 'lg' : 'default'}
              aria-pressed={option === selectedMinute}
              onClick={() => onSelectMinute(option)}
              className="font-mono tabular-nums"
            >
              {option}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

function getMinuteOptions(selectedMinute: string) {
  return Array.from(new Set([...QUICK_MINUTES, selectedMinute])).sort((a, b) => Number(a) - Number(b))
}
