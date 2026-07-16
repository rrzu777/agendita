import type { CampaignSegmentType } from './schema'

const SEGMENT_LABELS: Record<CampaignSegmentType, string> = {
  birthday_month: 'Cumpleañeras del mes',
  inactive: 'Inactivas',
  frequent: 'Frecuentes',
  pending_balance: 'Con saldo pendiente',
}

export function segmentLabel(segment: string): string {
  return SEGMENT_LABELS[segment as CampaignSegmentType] ?? segment
}
