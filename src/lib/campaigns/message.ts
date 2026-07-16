import type { CampaignSegmentType } from './schema'

export interface CampaignMessageVars {
  nombre: string
  codigo: string
  vencimiento: string
  negocio: string
}

/** Sustituye {nombre} {codigo} {vencimiento} {negocio}. Placeholders desconocidos
 *  quedan literales (no rompen). */
export function renderCampaignMessage(template: string, vars: CampaignMessageVars): string {
  return template.replace(/\{(nombre|codigo|vencimiento|negocio)\}/g, (_, key: keyof CampaignMessageVars) => vars[key])
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
