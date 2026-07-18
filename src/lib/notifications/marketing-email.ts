import { getAppUrl } from '@/lib/business/urls'

/** URL de la página pública de baja (self-service, reusa setMarketingOptOutByToken). */
export function marketingUnsubscribeUrl(token: string): string {
  return getAppUrl(`/baja/${token}`)
}

/** URL del route handler POST para el one-click de List-Unsubscribe (RFC 8058). */
export function marketingUnsubscribeApiUrl(token: string): string {
  return getAppUrl(`/api/baja/${token}`)
}

/** Headers de baja: Gmail/Yahoo los exigen para bulk marketing y habilitan el
 *  botón "Cancelar suscripción" nativo del cliente de correo. */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${marketingUnsubscribeApiUrl(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export function unsubscribeFooterHtml(token: string): string {
  const url = marketingUnsubscribeUrl(token)
  return `<p style="font-size:12px;color:#999;margin-top:8px">¿No quieres recibir promociones? <a href="${url}" style="color:#999">Darme de baja</a></p>`
}

export function unsubscribeFooterText(token: string): string {
  return `¿No quieres recibir promociones? Date de baja: ${marketingUnsubscribeUrl(token)}`
}
