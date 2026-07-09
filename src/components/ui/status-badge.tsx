import { Badge } from './badge'
import { cn } from '@/lib/utils'

type StatusEntry = { label: string; className: string }

const BOOKING_STATUS: Record<string, StatusEntry> = {
  pending_payment: { label: 'Pendiente de pago', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  confirmed: { label: 'Confirmada', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  completed: { label: 'Completada', className: 'bg-secondary text-secondary-foreground' },
  cancelled: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
  no_show: { label: 'No asistió', className: 'bg-destructive/10 text-destructive' },
  expired: { label: 'Expirada', className: 'bg-muted text-muted-foreground' },
}

export const STATUS_MAPS = { booking: BOOKING_STATUS } as const

export function StatusBadge({
  status,
  map = 'booking',
  label,
  className,
}: {
  status: string
  map?: keyof typeof STATUS_MAPS
  label?: string
  className?: string
}) {
  const entry = STATUS_MAPS[map][status]
  return (
    <Badge className={cn('border-transparent', entry?.className, className)}>
      {label ?? entry?.label ?? status}
    </Badge>
  )
}
