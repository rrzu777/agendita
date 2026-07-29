'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireBusiness } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { checkRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { resolveStorage, type StorageDeps } from '@/lib/storage/r2'
import {
  attachCustomerPhotoSchema,
  customerPhotoKey,
  customerPhotoUrl,
  isAllowedPhotoType,
  isOwnCustomerPhotoKey,
  photoCaptionSchema,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_LABEL,
  PHOTO_MAX_PER_CUSTOMER,
  type AttachCustomerPhotoInput,
  type CustomerPhotoItem,
  type PhotoTarget,
} from '@/lib/storage/photos'

// NOTE: módulo 'use server' — SOLO funciones async exportadas (consts, schemas y
// tipos viven en src/lib/storage/photos.ts).
//
// Las fotos se suben DIRECTO del navegador a R2 con una URL prefirmada; el
// servidor nunca ve los bytes. Por eso el flujo son dos pasos: primero se pide
// la URL (createCustomerPhotoUploadUrl) y después se confirma lo subido
// (attachCustomerPhoto), que es donde se verifica de verdad qué quedó en el
// bucket — tamaño y tipo reales vía HEAD, no lo que dijo el cliente.

const NOT_AN_IMAGE = 'Solo se pueden subir imágenes (JPG, PNG o WebP).'
const NO_STORAGE = 'La subida de fotos no está disponible.'

interface ResolvedTarget {
  customerId: string
  bookingId: string | null
  /** Cuántas fotos tiene ya la ficha. Viene en la MISMA query que resuelve el
   *  target: separarlo costaba un round-trip por foto subida. */
  photoCount: number
}

/**
 * Ficha (y reserva, si vino) sobre la que se opera, verificando que sean DE ESTE
 * negocio. Es el único lugar donde vive esa autorización: lo usan tanto la
 * lectura como la escritura, así que una reserva ajena responde igual por los
 * dos caminos.
 *
 * Acepta la forma laxa (los dos opcionales) porque también la llama el attach,
 * que viene de un `safeParse` y no de un union. Los callers públicos usan
 * `PhotoTarget`, que sí exige al menos uno en tiempo de compilación.
 */
async function resolveTarget(
  businessId: string,
  target: { customerId?: string; bookingId?: string },
): Promise<ResolvedTarget> {
  const { customerId } = target

  if (target.bookingId) {
    const booking = await prisma.booking.findFirst({
      where: { id: target.bookingId, businessId },
      select: {
        id: true,
        customerId: true,
        customer: { select: { _count: { select: { photos: true } } } },
      },
    })
    if (!booking) throw new UserError('Reserva no encontrada')
    if (customerId && customerId !== booking.customerId) {
      throw new UserError('Esa reserva no es de esta ficha')
    }
    return {
      customerId: booking.customerId,
      bookingId: booking.id,
      photoCount: booking.customer._count.photos,
    }
  }

  // Guard obligatorio: Prisma IGNORA un `id: undefined` en el where, así que sin
  // esto un target vacío devolvería una ficha cualquiera del negocio.
  if (!customerId) throw new UserError('Falta la ficha')

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true, _count: { select: { photos: true } } },
  })
  if (!customer) throw new UserError('Ficha no encontrada')
  return { customerId: customer.id, bookingId: null, photoCount: customer._count.photos }
}

function assertQuota(photoCount: number) {
  if (photoCount >= PHOTO_MAX_PER_CUSTOMER) {
    throw new UserError(
      `Esta ficha llegó a ${PHOTO_MAX_PER_CUSTOMER} fotos. Borrá alguna para subir otra.`,
    )
  }
}

function toItem(photo: {
  id: string
  bookingId: string | null
  caption: string | null
  createdAt: Date
}): CustomerPhotoItem {
  return {
    id: photo.id,
    bookingId: photo.bookingId,
    caption: photo.caption,
    createdAt: photo.createdAt.toISOString(),
    url: customerPhotoUrl(photo.id),
  }
}

const PHOTO_SELECT = { id: true, bookingId: true, caption: true, createdAt: true } as const

/** Mina una URL PUT prefirmada. El token de la key lo genera ACÁ el servidor:
 *  si lo eligiera el cliente podría pisar la foto de otra ficha. */
async function _createCustomerPhotoUploadUrl(
  target: PhotoTarget,
  contentType: string,
  deps: StorageDeps = {},
): Promise<{ uploadUrl: string; key: string }> {
  const { businessId } = await requireBusiness()

  const limit = await checkRateLimit('photo-upload-url')
  if (!limit.success) throw new UserError('Demasiadas fotos seguidas. Probá de nuevo en un minuto.')

  if (!isAllowedPhotoType(contentType)) throw new UserError(NOT_AN_IMAGE)

  const storage = resolveStorage(deps.storage)
  if (!storage) throw new UserError(NO_STORAGE)

  const { customerId, photoCount } = await resolveTarget(businessId, target)
  assertQuota(photoCount)

  const key = customerPhotoKey(businessId, customerId, crypto.randomUUID())
  const uploadUrl = await storage.presignUpload(key, contentType)
  return { uploadUrl, key }
}

export const createCustomerPhotoUploadUrl = action(_createCustomerPhotoUploadUrl)

/** Confirma una foto ya subida a R2 y la guarda en la ficha. */
async function _attachCustomerPhoto(
  input: AttachCustomerPhotoInput,
  deps: StorageDeps = {},
): Promise<CustomerPhotoItem> {
  const { businessId } = await requireBusiness()

  const parsed = attachCustomerPhotoSchema.safeParse(input)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  }
  const data = parsed.data

  const storage = resolveStorage(deps.storage)
  if (!storage) throw new UserError(NO_STORAGE)

  const { customerId, bookingId, photoCount } = await resolveTarget(businessId, data)

  // La key la emitimos nosotros hace un rato; que vuelva del cliente no la hace
  // confiable. Sin esto, alguien podría colgarse la foto de otro negocio.
  if (!isOwnCustomerPhotoKey(data.key, businessId, customerId)) {
    throw new UserError('Foto inválida.')
  }

  // Lo que dijo el cliente sobre tamaño y tipo no cuenta: preguntamos al bucket.
  const meta = await storage.head(data.key)
  if (!meta) throw new UserError('No encontramos la foto subida. Probá de nuevo.')
  if (meta.contentLength > PHOTO_MAX_BYTES) {
    throw new UserError(`La foto supera el tamaño máximo (${PHOTO_MAX_LABEL}).`)
  }
  if (meta.contentType && !isAllowedPhotoType(meta.contentType)) {
    throw new UserError(NOT_AN_IMAGE)
  }

  // Este conteo es de hace dos round-trips, pero la cuota igual es aproximada:
  // sin un constraint en la base, dos pestañas subiendo a la vez pueden pasarse
  // por una. Es un límite de storage, no una regla de negocio.
  assertQuota(photoCount)

  try {
    const photo = await prisma.customerPhoto.create({
      data: {
        businessId,
        customerId,
        bookingId,
        key: data.key,
        // El tipo REAL del objeto, no el que declaró el cliente: es el que la
        // ruta le va a forzar al navegador al servirla.
        contentType: meta.contentType ?? data.contentType,
        caption: data.caption || null,
      },
      select: PHOTO_SELECT,
    })
    revalidatePath(`/dashboard/customers/${customerId}`)
    return toItem(photo)
  } catch (e) {
    // `key` es único: un doble submit del mismo attach cae acá. No hay tx de por
    // medio, así que atajarlo después del insert es seguro.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new UserError('Esa foto ya está guardada.')
    }
    throw e
  }
}

export const attachCustomerPhoto = action(_attachCustomerPhoto)

/** Las fotos de una ficha, o las de una reserva puntual. Pasa por el mismo
 *  `resolveTarget` que la escritura para que la autorización sea una sola. */
async function _getPhotos(target: PhotoTarget): Promise<CustomerPhotoItem[]> {
  const { businessId } = await requireBusiness()
  const { customerId, bookingId } = await resolveTarget(businessId, target)

  const photos = await prisma.customerPhoto.findMany({
    where: bookingId ? { bookingId, businessId } : { customerId, businessId },
    select: PHOTO_SELECT,
    orderBy: { createdAt: 'desc' },
    take: PHOTO_MAX_PER_CUSTOMER,
  })
  return photos.map(toItem)
}

export const getPhotos = action(_getPhotos)

async function _updateCustomerPhotoCaption(
  photoId: string,
  caption: string,
): Promise<CustomerPhotoItem> {
  const { businessId } = await requireBusiness()

  const parsed = photoCaptionSchema.safeParse(caption)
  if (!parsed.success) {
    throw new UserError(parsed.error.issues.map((i) => i.message).join(', '))
  }

  const existing = await prisma.customerPhoto.findFirst({
    where: { id: photoId, businessId },
    select: { id: true, customerId: true },
  })
  if (!existing) throw new UserError('Foto no encontrada')

  const photo = await prisma.customerPhoto.update({
    where: { id: existing.id },
    data: { caption: parsed.data || null },
    select: PHOTO_SELECT,
  })
  revalidatePath(`/dashboard/customers/${existing.customerId}`)
  return toItem(photo)
}

export const updateCustomerPhotoCaption = action(_updateCustomerPhotoCaption)

async function _deleteCustomerPhoto(
  photoId: string,
  deps: StorageDeps = {},
): Promise<{ id: string }> {
  const { businessId } = await requireBusiness()

  const existing = await prisma.customerPhoto.findFirst({
    where: { id: photoId, businessId },
    select: { id: true, key: true, customerId: true },
  })
  if (!existing) throw new UserError('Foto no encontrada')

  await prisma.customerPhoto.delete({ where: { id: existing.id } })

  // El objeto se borra DESPUÉS y sin bloquear: si R2 falla, la foto ya no se ve
  // en ningún lado y lo único que queda es un objeto huérfano en el bucket.
  // Al revés (borrar primero el objeto) un fallo dejaría la fila apuntando a
  // nada, que es peor: la ficha mostraría una foto rota.
  const storage = resolveStorage(deps.storage)
  if (storage) {
    try {
      await storage.remove(existing.key)
    } catch (e) {
      logger.warn('photo.remove.failed', 'no se pudo borrar la foto del bucket', {
        metadata: { key: existing.key, error: e instanceof Error ? e.message : String(e) },
      })
    }
  }

  revalidatePath(`/dashboard/customers/${existing.customerId}`)
  return { id: existing.id }
}

export const deleteCustomerPhoto = action(_deleteCustomerPhoto)
