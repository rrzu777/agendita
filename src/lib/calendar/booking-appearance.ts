import {
  DEFAULT_SERVICE_COLOR,
  readableTextColor,
  deriveBorderColor,
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

type StatusKind = 'active' | 'done' | 'negative'

interface StatusMeta {
  kind: StatusKind
  dotColor: string
  icon: StatusIcon
}

const STATUS_META: Record<string, StatusMeta> = {
  pending_payment: { kind: 'active', dotColor: '#f97316', icon: 'clock' },
  confirmed: { kind: 'active', dotColor: '#22c55e', icon: 'check' },
  completed: { kind: 'done', dotColor: '#3b82f6', icon: 'check' },
  cancelled: { kind: 'negative', dotColor: '#ef4444', icon: 'x' },
  no_show: { kind: 'negative', dotColor: '#dc2626', icon: 'x' },
  expired: { kind: 'negative', dotColor: '#6b7280', icon: 'dash' },
}

const FALLBACK_META: StatusMeta = { kind: 'active', dotColor: '#6b7280', icon: 'dash' }

const OPACITY: Record<StatusKind, number> = {
  active: 1,
  done: 0.85,
  negative: 0.55,
}

export function bookingAppearance(
  pastelColor: string | undefined | null,
  status: string,
): BookingAppearance {
  const background =
    pastelColor && /^#[0-9a-fA-F]{6}$/.test(pastelColor)
      ? pastelColor
      : DEFAULT_SERVICE_COLOR
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
