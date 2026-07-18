import { Badge } from './badge'
import { cn } from '@/lib/utils'
import { bookingStatusLabels } from '@/lib/bookings/status-labels'

type StatusEntry = { label: string; className: string }

// Labels desde la fuente compartida; acá solo se agregan colores.
const BOOKING_STATUS: Record<string, StatusEntry> = {
  pending_payment: { label: bookingStatusLabels.pending_payment, className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  confirmed: { label: bookingStatusLabels.confirmed, className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  completed: { label: bookingStatusLabels.completed, className: 'bg-secondary text-secondary-foreground' },
  cancelled: { label: bookingStatusLabels.cancelled, className: 'bg-muted text-muted-foreground' },
  no_show: { label: bookingStatusLabels.no_show, className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  expired: { label: bookingStatusLabels.expired, className: 'bg-muted text-muted-foreground' },
}

const SERVICE_STATUS: Record<string, StatusEntry> = {
  active: { label: 'Activo', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  inactive: { label: 'Inactivo', className: 'bg-muted text-muted-foreground' },
}

const REVIEW_STATUS: Record<string, StatusEntry> = {
  pending: { label: 'Pendiente', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  approved: { label: 'Aprobada', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  hidden: { label: 'Oculta', className: 'bg-muted text-muted-foreground' },
}

const PAYMENT_STATUS: Record<string, StatusEntry> = {
  pending: { label: 'Pendiente', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  approved: { label: 'Aprobado', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  rejected: { label: 'Rechazado', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  failed: { label: 'Fallido', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
  refunded: { label: 'Reembolsado', className: 'bg-muted text-muted-foreground' },
}

// OJO: las keys de promo son los strings capitalizados que devuelve
// `derivePromoStatus()` en promociones/page.tsx (tipo PromoStatus), NO lowercase.
// La tabla pasa `status={derivePromoStatus(promo, now)}` directo.
const PROMO_STATUS: Record<string, StatusEntry> = {
  Activa: { label: 'Activa', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  Programada: { label: 'Programada', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  Vencida: { label: 'Vencida', className: 'bg-muted text-muted-foreground' },
  Agotada: { label: 'Agotada', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  Inactiva: { label: 'Inactiva', className: 'bg-muted text-muted-foreground' },
}

// OJO: expense conserva el color rojo actual del ledger (red-100/red-800), NO destructive.
const DIRECTION_STATUS: Record<string, StatusEntry> = {
  income: { label: 'Ingreso', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  expense: { label: 'Gasto', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  neutral: { label: 'Neutral', className: 'bg-muted text-muted-foreground' },
}

// Mismos 5 estados y labels que `getSubscriptionStatusLabel` en
// src/lib/subscriptions/enforcement.ts (esa función sigue siendo la fuente
// canónica de las labels; este mapa solo agrega color para celdas de tabla).
// Reemplaza el bucketing de 3 colores de admin/page.tsx. El badge decorativo
// de arriba en billing/page.tsx ya usa getSubscriptionStatusLabel directo
// (server component); acá no se puede importar enforcement.ts (server-only).
const SUBSCRIPTION_STATUS: Record<string, StatusEntry> = {
  trialing: { label: 'En prueba', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  active: { label: 'Activo', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  past_due: { label: 'Pago pendiente', className: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  suspended: { label: 'Suspendido', className: 'bg-destructive/10 text-destructive dark:bg-destructive/20' },
  cancelled: { label: 'Cancelado', className: 'bg-muted text-muted-foreground' },
}

const REDEMPTION_STATUS: Record<string, StatusEntry> = {
  applied: { label: 'Aplicado', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  released: { label: 'Liberado', className: 'bg-muted text-muted-foreground' },
}

// Estado de una destinataria de campaña: derivado de (grantStatus, sentAt) en
// campanas/[id]/recipient-list.tsx. 'pending' = aún no enviado.
const CAMPAIGN_RECIPIENT_STATUS: Record<string, StatusEntry> = {
  redeemed: { label: 'Canjeado ✓', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  sent: { label: 'Enviado ✓', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  pending: { label: '—', className: 'bg-muted text-muted-foreground' },
}

export const STATUS_MAPS = {
  booking: BOOKING_STATUS,
  service: SERVICE_STATUS,
  review: REVIEW_STATUS,
  payment: PAYMENT_STATUS,
  promo: PROMO_STATUS,
  direction: DIRECTION_STATUS,
  subscription: SUBSCRIPTION_STATUS,
  redemption: REDEMPTION_STATUS,
  campaignRecipient: CAMPAIGN_RECIPIENT_STATUS,
} as const

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
