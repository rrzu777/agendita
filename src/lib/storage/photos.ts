// Consts + helpers puros de las fotos de la ficha. Sin deps de red ni de Prisma:
// los importan el server action, la ruta que las sirve y el componente cliente.
// Espejo de proof.ts, con dos diferencias deliberadas:
//   1. SOLO imágenes. Un comprobante puede ser un PDF; una foto del trabajo, no.
//   2. La key NO es determinística: una ficha tiene muchas fotos, así que lleva
//      un token aleatorio que genera el SERVIDOR. Nunca se arma con texto que
//      mandó el cliente — ver assertOwnPhotoKey.

import { z } from 'zod'

export const PHOTO_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type PhotoContentType = (typeof PHOTO_ALLOWED_TYPES)[number]

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024

/** El tope en texto, para no repetir "5 MB" a mano en cada mensaje. */
export const PHOTO_MAX_LABEL = `${PHOTO_MAX_BYTES / (1024 * 1024)} MB`

/** Tope por ficha. Es una cuota de storage, no un límite de producto: 60 fotos
 *  cubren años de visitas y frenan que un bug de reintentos llene el bucket. */
export const PHOTO_MAX_PER_CUSTOMER = 60

export const PHOTO_CAPTION_MAX = 120

export function isAllowedPhotoType(t: string): t is PhotoContentType {
  return (PHOTO_ALLOWED_TYPES as readonly string[]).includes(t)
}

/** Prefijo del que cuelgan TODAS las fotos de una ficha. Termina en `/`. */
export function customerPhotoPrefix(businessId: string, customerId: string): string {
  return `photos/${businessId}/${customerId}/`
}

export function customerPhotoKey(businessId: string, customerId: string, token: string): string {
  return `${customerPhotoPrefix(businessId, customerId)}${token}`
}

/** El token que genera el servidor: un UUID v4 tal cual lo devuelve
 *  `crypto.randomUUID()`. Se valida al volver del cliente. */
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * ¿Esta key es de esta ficha y la emitimos nosotros?
 *
 * El cliente sube directo a R2 con una URL prefirmada y después nos devuelve la
 * key para que la guardemos. Sin este chequeo podría mandarnos la key de OTRO
 * negocio y quedársela colgada de su propia ficha. Exigimos el prefijo exacto y
 * que lo que sigue sea un token nuestro y nada más (ni `../`, ni subcarpetas).
 */
export function isOwnCustomerPhotoKey(key: string, businessId: string, customerId: string): boolean {
  const prefix = customerPhotoPrefix(businessId, customerId)
  if (!key.startsWith(prefix)) return false
  return TOKEN_RE.test(key.slice(prefix.length))
}

export const photoCaptionSchema = z
  .string()
  .trim()
  .max(PHOTO_CAPTION_MAX, `La nota no puede pasar de ${PHOTO_CAPTION_MAX} caracteres`)

/**
 * A qué se cuelga una foto. Es un union y no `{ customerId?, bookingId? }`
 * porque con ambos opcionales `{}` compila, y entonces "falta el target" hay que
 * atajarlo en runtime en cada camino. Así el compilador lo caza.
 *
 * Con `bookingId` solo alcanza: el servidor saca la ficha de la reserva y no le
 * cree al cliente. Es lo que usa el drawer de la agenda, que no conoce el id de
 * la clienta.
 */
export type PhotoTarget = { customerId: string; bookingId?: string } | { bookingId: string }

export const attachCustomerPhotoSchema = z
  .object({
    customerId: z.string().min(1).optional(),
    bookingId: z.string().min(1).optional(),
    key: z.string().min(1),
    contentType: z
      .string()
      .refine(isAllowedPhotoType, 'Solo se pueden subir imágenes (JPG, PNG o WebP)'),
    caption: photoCaptionSchema.optional(),
  })
  .refine((v) => Boolean(v.customerId || v.bookingId), {
    message: 'Falta la ficha o la reserva',
  })

export type AttachCustomerPhotoInput = z.input<typeof attachCustomerPhotoSchema>

/** Lo que viaja al cliente. Nunca incluye la key: el objeto es privado y la
 *  única forma de verlo es la ruta, que re-verifica quién pide. */
export interface CustomerPhotoItem {
  id: string
  bookingId: string | null
  caption: string | null
  /** ISO — cruza el borde server→client. */
  createdAt: string
  url: string
}

export function customerPhotoUrl(photoId: string): string {
  return `/dashboard/photos/${photoId}`
}
