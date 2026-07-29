import type { CampaignSegmentType } from './schema'
import { interpolate, type Vocabulary } from '@/lib/vocabulary'

// Los `{token}` los resuelve el léxico del rubro (ver src/lib/vocabulary).
const SEGMENT_LABELS: Record<CampaignSegmentType, string> = {
  birthday_month: '{birthdaySegment}',
  inactive: '{InactiveSegment}',
  frequent: 'Frecuentes',
  pending_balance: 'Con saldo pendiente',
}

export function segmentLabel(segment: string, vocabulary: Vocabulary): string {
  const label = SEGMENT_LABELS[segment as CampaignSegmentType]
  return label ? interpolate(label, vocabulary) : segment
}
