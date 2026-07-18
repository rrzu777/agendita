import { isWhatsappablePhone } from './phone'
import { isEmailable } from './email'

export type CampaignChannel = 'whatsapp' | 'email' | 'none'

/** Canal de contacto de campaña para una clienta: WhatsApp si el teléfono es
 *  whatsappeable (preferido), si no email si es válido, si no ninguno. Única fuente
 *  de la política "WhatsApp gana a email" — la usan los segmentos (¿contactable?) y
 *  el detalle de campaña (¿qué botón?), para que no derive entre superficies. */
export function campaignChannel(customer: { phone: string; email: string | null }): CampaignChannel {
  if (isWhatsappablePhone(customer.phone)) return 'whatsapp'
  if (isEmailable(customer.email)) return 'email'
  return 'none'
}
