import { HOLD_EXPIRED_STATUS } from '@/lib/bookings/status-labels'
import {
  DEFAULT_SERVICE_COLOR,
  readableTextColor,
  deriveBorderColor,
  parseHex,
} from './color'

export type StatusIcon = 'clock' | 'check' | 'x' | 'dash'

export interface BookingAppearance {
  background: string
  textColor: string
  borderColor: string
  opacity: number
  strikeThrough: boolean
  dotColor: string
  icon: StatusIcon
}

type StatusKind = 'active' | 'done' | 'fading' | 'negative'

interface StatusMeta {
  kind: StatusKind
  dotColor: string
  icon: StatusIcon
}

const STATUS_META: Record<string, StatusMeta> = {
  pending_payment: { kind: 'active', dotColor: '#f97316', icon: 'clock' },
  pending_confirmation: { kind: 'active', dotColor: '#f59e0b', icon: 'clock' },
  confirmed: { kind: 'active', dotColor: '#22c55e', icon: 'check' },
  completed: { kind: 'done', dotColor: '#3b82f6', icon: 'check' },
  cancelled: { kind: 'negative', dotColor: '#ef4444', icon: 'x' },
  no_show: { kind: 'negative', dotColor: '#dc2626', icon: 'x' },
  expired: { kind: 'negative', dotColor: '#6b7280', icon: 'dash' },
  // Estado DERIVADO (ver HOLD_EXPIRED_STATUS): el plazo venció y el cron todavía
  // no la asentó. Mismo gris y mismo ícono que `expired`, pero `fading` y NO
  // `negative`: tachar prometería que el horario ya se puede vender, y eso sólo
  // es cierto cuando `isSweepableExpiredHold` la deja barrer. Por transferencia
  // o coordinación manual `occupiesSlot` la sigue dando por ocupada hasta que
  // pasa el cron, y la dueña que intente vender encima se come un
  // `booking_overlap`.
  [HOLD_EXPIRED_STATUS]: { kind: 'fading', dotColor: '#6b7280', icon: 'dash' },
}

const FALLBACK_META: StatusMeta = { kind: 'active', dotColor: '#6b7280', icon: 'dash' }

const OPACITY: Record<StatusKind, number> = {
  active: 1,
  done: 0.85,
  // A medio camino, y por un motivo: lo `fading` está condenado pero TODAVÍA
  // tapa su horario. Atenuar sin tachar dice "esto no va a pasar" sin decir
  // "este hueco es tuyo", que es lo único que `negative` promete de más.
  fading: 0.7,
  negative: 0.55,
}

export function bookingAppearance(
  pastelColor: string | undefined | null,
  status: string,
): BookingAppearance {
  const background =
    pastelColor && parseHex(pastelColor) !== null ? pastelColor : DEFAULT_SERVICE_COLOR
  const meta = STATUS_META[status] ?? FALLBACK_META
  return {
    background,
    textColor: readableTextColor(background),
    borderColor: deriveBorderColor(background),
    opacity: OPACITY[meta.kind],
    strikeThrough: meta.kind === 'negative',
    dotColor: meta.dotColor,
    icon: meta.icon,
  }
}
