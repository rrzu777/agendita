import type { CampaignSegmentType } from './schema'
import type { Vocabulary } from '@/lib/vocabulary'

// Función y no tabla de `{token}` como en los presets de fidelización: acá dos de
// los cuatro valores son SÓLO un token, así que el rodeo por string + regex no
// compra nada y encima lo saca del alcance de tsc — un token mal escrito llegaría
// a pantalla. Los presets sí lo necesitan: sus frases mezclan varios tokens.
const SEGMENT_LABELS: Record<CampaignSegmentType, (v: Vocabulary) => string> = {
  birthday_month: (v) => v.birthdaySegment,
  inactive: (v) => v.InactiveSegment,
  frequent: () => 'Frecuentes',
  pending_balance: () => 'Con saldo pendiente',
}

export function segmentLabel(segment: string, vocabulary: Vocabulary): string {
  const label = SEGMENT_LABELS[segment as CampaignSegmentType]
  return label ? label(vocabulary) : segment
}
