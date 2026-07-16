import type { CampaignSegmentType } from './schema'

export const CAMPAIGN_PLACEHOLDERS = ['nombre', 'codigo', 'vencimiento', 'negocio'] as const

export type CampaignMessageVars = Record<(typeof CAMPAIGN_PLACEHOLDERS)[number], string>

// Regex con flag g y estado interno: seguro porque .replace lo resetea en cada uso.
const PLACEHOLDER_RE = new RegExp(`\\{(${CAMPAIGN_PLACEHOLDERS.join('|')})\\}`, 'g')

/** Sustituye {nombre} {codigo} {vencimiento} {negocio}. Placeholders desconocidos
 *  quedan literales (no rompen). */
export function renderCampaignMessage(template: string, vars: CampaignMessageVars): string {
  return template.replace(PLACEHOLDER_RE, (_, key: keyof CampaignMessageVars) => vars[key])
}

const DEFAULTS: Record<CampaignSegmentType, string> = {
  birthday_month:
    '¡Feliz cumple, {nombre}! 🎉 En {negocio} te regalamos un beneficio: usa el código {codigo} (vence {vencimiento}) en tu próxima reserva.',
  inactive:
    'Hola {nombre}, ¡te extrañamos en {negocio}! 💛 Vuelve con este beneficio: código {codigo}, válido hasta {vencimiento}.',
  frequent:
    '¡Gracias por elegirnos siempre, {nombre}! 🌟 En {negocio} te dejamos un beneficio: código {codigo} (vence {vencimiento}).',
  pending_balance:
    'Hola {nombre}, te recordamos tu saldo pendiente en {negocio}. Además te dejamos un beneficio: código {codigo}, válido hasta {vencimiento}.',
}

export function defaultMessageForSegment(segment: CampaignSegmentType): string {
  return DEFAULTS[segment]
}
