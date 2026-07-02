'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Repeat, Trash2 } from 'lucide-react'
import { deleteTimeBlockSeries } from '@/server/actions/time-blocks'

const DAY_LABELS: Record<number, string> = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' }

export interface RecurringSeriesItem {
  id: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  reason?: string | null
  until: string | null
}

function DeleteSeriesButton({ seriesId }: { seriesId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-destructive hover:text-destructive/80"
      disabled={isPending}
      onClick={() => startTransition(async () => { try { await deleteTimeBlockSeries(seriesId); router.refresh() } catch { /* noop */ } })}
    >
      <Trash2 className="size-3" />
    </Button>
  )
}

export function RecurringBlockList({ series }: { series: RecurringSeriesItem[] }) {
  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">No tienes bloqueos recurrentes.</p>
  }
  return (
    <div className="space-y-3">
      {series.map((s) => {
        const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => s.daysOfWeek.includes(d)).map((d) => DAY_LABELS[d]).join(', ')
        return (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-3 md:p-4">
            <Repeat className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-muted-foreground">{s.startTime} - {s.endTime} · {days}</div>
              <div className="text-xs text-muted-foreground">
                {s.reason ? `${s.reason} · ` : ''}{s.until ? 'hasta fecha límite' : 'indefinido'}
              </div>
            </div>
            <DeleteSeriesButton seriesId={s.id} />
          </div>
        )
      })}
    </div>
  )
}
