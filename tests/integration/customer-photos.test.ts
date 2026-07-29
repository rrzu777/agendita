import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import { requireTestDatabase } from './setup'
import { unwrap, expectActionError } from './helpers/action-result'
import { customerPhotoKey, PHOTO_MAX_PER_CUSTOMER } from '@/lib/storage/photos'
import { fakeObjectStorage } from '../helpers/fake-object-storage'

requireTestDatabase()

// Este archivo existe sobre todo por la MIGRACIÓN: `CustomerPhoto` es una tabla
// nueva con tres FKs, una de ellas ON DELETE SET NULL escrita a mano en el .sql.
// Un unit test con Prisma mockeado no toca nada de eso. Acá se ejercita contra
// un Postgres real; auth, rate limit y revalidate se mockean (mismo precedente
// que packages-actions.test.ts) y el bucket se inyecta falso vía `deps.storage`
// para que CI nunca hable con R2.
const BIZ = 'photo-biz-1'
const OTHER_BIZ = 'photo-biz-2'
const USER = 'photo-user-1'

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: BIZ, user: { id: USER } }),
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER } }),
  ForbiddenError,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true, remaining: 60, resetAt: 0 }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const storage = fakeObjectStorage({
  head: vi.fn().mockResolvedValue({ contentLength: 1000, contentType: 'image/jpeg' }),
})

describe('fotos de la ficha', () => {
  let prisma: PrismaClient
  let customerId: string
  let bookingId: string

  async function seedBusiness(id: string, slug: string, userId: string, email: string) {
    const u = await prisma.user.create({ data: { id: userId, email, name: 'Owner' } })
    await prisma.business.create({
      data: {
        id, name: slug, slug, subdomain: slug.replace(/-/g, ''), ownerUserId: u.id,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago',
        bookingWindowDays: 90,
      },
    })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await seedBusiness(BIZ, 'photo-biz', USER, 'photo@t.test')
    await seedBusiness(OTHER_BIZ, 'photo-biz-other', 'photo-user-2', 'photo2@t.test')
    await prisma.businessUser.create({
      data: { id: 'photo-bu-1', businessId: BIZ, userId: USER, role: 'owner' },
    })
  })

  afterAll(async () => {
    for (const businessId of [BIZ, OTHER_BIZ]) {
      await prisma.customerPhoto.deleteMany({ where: { businessId } })
      await prisma.booking.deleteMany({ where: { businessId } })
      await prisma.service.deleteMany({ where: { businessId } })
      await prisma.customer.deleteMany({ where: { businessId } })
      await prisma.businessUser.deleteMany({ where: { businessId } })
      await prisma.business.deleteMany({ where: { id: businessId } })
    }
    await prisma.user.deleteMany({ where: { id: { in: [USER, 'photo-user-2'] } } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    storage.presignUpload.mockResolvedValue('https://signed/put')
    storage.head.mockResolvedValue({ contentLength: 1000, contentType: 'image/jpeg' })

    await prisma.customerPhoto.deleteMany({ where: { businessId: { in: [BIZ, OTHER_BIZ] } } })
    await prisma.booking.deleteMany({ where: { businessId: BIZ } })
    await prisma.service.deleteMany({ where: { businessId: BIZ } })
    await prisma.customer.deleteMany({ where: { businessId: { in: [BIZ, OTHER_BIZ] } } })

    const customer = await prisma.customer.create({
      data: { businessId: BIZ, name: 'Ana', phone: '+56911112222' },
    })
    customerId = customer.id

    const service = await prisma.service.create({
      data: {
        businessId: BIZ, name: 'Corte', durationMinutes: 30, price: 10000,
        depositAmount: 0, pastelColor: '#FFD700',
      },
    })
    const booking = await prisma.booking.create({
      data: {
        businessId: BIZ, serviceId: service.id, customerId,
        startDateTime: new Date('2026-08-01T14:00:00Z'),
        endDateTime: new Date('2026-08-01T14:30:00Z'),
        status: 'completed', totalPrice: 10000, depositRequired: 0, depositPaid: 0,
        remainingBalance: 0, discountAmount: 0, finalAmount: 10000,
        paymentStatus: 'fully_paid',
      },
    })
    bookingId = booking.id
  })

  it('presigna una key colgada de la ficha', async () => {
    const { createCustomerPhotoUploadUrl } = await import('@/server/actions/customer-photos')
    const res = await unwrap(
      createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
    )
    expect(res.uploadUrl).toBe('https://signed/put')
    expect(res.key.startsWith(`photos/${BIZ}/${customerId}/`)).toBe(true)
    expect(storage.presignUpload).toHaveBeenCalledWith(res.key, 'image/jpeg')
  })

  it('rechaza un archivo que no es imagen', async () => {
    const { createCustomerPhotoUploadUrl } = await import('@/server/actions/customer-photos')
    await expectActionError(
      createCustomerPhotoUploadUrl({ customerId }, 'application/pdf', { storage }),
      'Solo se pueden subir imágenes',
    )
  })

  it('guarda la foto y la devuelve en la ficha', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
    )
    const saved = await unwrap(
      actions.attachCustomerPhoto(
        { customerId, key, contentType: 'image/jpeg', caption: 'Antes' },
        { storage },
      ),
    )
    expect(saved.caption).toBe('Antes')
    expect(saved.url).toBe(`/dashboard/photos/${saved.id}`)

    const listed = await unwrap(actions.getPhotos({ customerId }))
    expect(listed.map((p) => p.id)).toEqual([saved.id])
  })

  it('colgada de una reserva, saca la ficha de la reserva', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ bookingId }, 'image/jpeg', { storage }),
    )
    const saved = await unwrap(
      actions.attachCustomerPhoto({ bookingId, key, contentType: 'image/jpeg' }, { storage }),
    )
    expect(saved.bookingId).toBe(bookingId)

    const row = await prisma.customerPhoto.findUnique({ where: { id: saved.id } })
    expect(row?.customerId).toBe(customerId)

    const byBooking = await unwrap(actions.getPhotos({ bookingId }))
    expect(byBooking.map((p) => p.id)).toEqual([saved.id])
  })

  it('rechaza una key que no es de esta ficha', async () => {
    const { attachCustomerPhoto } = await import('@/server/actions/customer-photos')
    const foreign = customerPhotoKey(OTHER_BIZ, 'otra-ficha', crypto.randomUUID())
    await expectActionError(
      attachCustomerPhoto({ customerId, key: foreign, contentType: 'image/jpeg' }, { storage }),
      'Foto inválida',
    )
    expect(await prisma.customerPhoto.count({ where: { businessId: BIZ } })).toBe(0)
  })

  it('no deja tocar la ficha de otro negocio', async () => {
    const other = await prisma.customer.create({
      data: { businessId: OTHER_BIZ, name: 'Ajena', phone: '+56999998888' },
    })
    const { createCustomerPhotoUploadUrl } = await import('@/server/actions/customer-photos')
    await expectActionError(
      createCustomerPhotoUploadUrl({ customerId: other.id }, 'image/jpeg', { storage }),
      'Ficha no encontrada',
    )
  })

  it('leer una reserva ajena falla igual que escribirla', async () => {
    // La lectura pasa por el mismo resolveTarget que la escritura: antes
    // devolvía [] y el drawer decía "sin fotos" para una reserva de otro negocio.
    const other = await prisma.customer.create({
      data: { businessId: OTHER_BIZ, name: 'Ajena', phone: '+56977776666' },
    })
    const { getPhotos } = await import('@/server/actions/customer-photos')
    await expectActionError(getPhotos({ customerId: other.id }), 'Ficha no encontrada')
  })

  it('un target vacío no engancha una ficha cualquiera del negocio', async () => {
    // Prisma IGNORA `id: undefined` en el where: sin el guard explícito, esto
    // habría resuelto a la primera ficha del negocio.
    const { attachCustomerPhoto } = await import('@/server/actions/customer-photos')
    await expectActionError(
      attachCustomerPhoto(
        { key: customerPhotoKey(BIZ, customerId, crypto.randomUUID()), contentType: 'image/jpeg' },
        { storage },
      ),
      'Falta la ficha o la reserva',
    )
  })

  it('cree al bucket y no al cliente sobre el tamaño', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
    )
    storage.head.mockResolvedValue({ contentLength: 20 * 1024 * 1024, contentType: 'image/jpeg' })
    await expectActionError(
      actions.attachCustomerPhoto({ customerId, key, contentType: 'image/jpeg' }, { storage }),
      'supera el tamaño máximo',
    )
    expect(await prisma.customerPhoto.count({ where: { customerId } })).toBe(0)
  })

  it('corta al llegar al tope por ficha', async () => {
    await prisma.customerPhoto.createMany({
      data: Array.from({ length: PHOTO_MAX_PER_CUSTOMER }, () => ({
        businessId: BIZ,
        customerId,
        key: customerPhotoKey(BIZ, customerId, crypto.randomUUID()),
        contentType: 'image/jpeg',
      })),
    })
    const { createCustomerPhotoUploadUrl } = await import('@/server/actions/customer-photos')
    await expectActionError(
      createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
      `llegó a ${PHOTO_MAX_PER_CUSTOMER} fotos`,
    )
  })

  it('borrar la foto saca la fila y el objeto del bucket', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
    )
    const saved = await unwrap(
      actions.attachCustomerPhoto({ customerId, key, contentType: 'image/jpeg' }, { storage }),
    )

    await unwrap(actions.deleteCustomerPhoto(saved.id, { storage }))
    expect(storage.remove).toHaveBeenCalledWith(key)
    expect(await prisma.customerPhoto.count({ where: { id: saved.id } })).toBe(0)
  })

  it('si R2 falla al borrar, la foto igual desaparece de la ficha', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
    )
    const saved = await unwrap(
      actions.attachCustomerPhoto({ customerId, key, contentType: 'image/jpeg' }, { storage }),
    )
    storage.remove.mockRejectedValueOnce(new Error('R2 caído'))

    await unwrap(actions.deleteCustomerPhoto(saved.id, { storage }))
    expect(await prisma.customerPhoto.count({ where: { id: saved.id } })).toBe(0)
  })

  it('borrar la reserva NO se lleva la foto: queda en la ficha sin cita', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ bookingId }, 'image/jpeg', { storage }),
    )
    const saved = await unwrap(
      actions.attachCustomerPhoto({ bookingId, key, contentType: 'image/jpeg' }, { storage }),
    )

    await prisma.booking.delete({ where: { id: bookingId } })

    const row = await prisma.customerPhoto.findUnique({ where: { id: saved.id } })
    expect(row).not.toBeNull()
    expect(row?.bookingId).toBeNull()
    expect(row?.customerId).toBe(customerId)
  })

  it('la nota se edita y se borra', async () => {
    const actions = await import('@/server/actions/customer-photos')
    const { key } = await unwrap(
      actions.createCustomerPhotoUploadUrl({ customerId }, 'image/jpeg', { storage }),
    )
    const saved = await unwrap(
      actions.attachCustomerPhoto(
        { customerId, key, contentType: 'image/jpeg', caption: 'Antes' },
        { storage },
      ),
    )

    const renamed = await unwrap(actions.updateCustomerPhotoCaption(saved.id, '  Después  '))
    expect(renamed.caption).toBe('Después')

    const cleared = await unwrap(actions.updateCustomerPhotoCaption(saved.id, '   '))
    expect(cleared.caption).toBeNull()
  })
})
