'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { deriveModalities } from '@/lib/professionals/modalities'
import {
  createProfessionalSchema,
  updateProfessionalSchema,
  reorderProfessionalsSchema,
} from '@/lib/professionals/schema'

// La pantalla necesita saber qué servicios hace cada persona para pre-marcar los
// checkboxes del formulario. Los ids alcanzan: los nombres salen de la lista de
// servicios, que se carga una sola vez.
const WITH_SERVICE_IDS = {
  services: { select: { id: true } },
} as const

export async function getProfessionals(includeInactive = false) {
  const { businessId } = await requireBusiness()
  return prisma.professional.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      businessId,
    },
    include: WITH_SERVICE_IDS,
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * Los servicios que se le pueden asignar a alguien: sólo los de este negocio.
 *
 * Devuelve las modalidades porque el formulario las necesita para pre-marcar con
 * `deriveModalities` sin pedir otra vuelta al servidor por cada click.
 */
export async function getAssignableServices() {
  const { businessId } = await requireBusiness()
  return prisma.service.findMany({
    where: { businessId, isActive: true },
    select: { id: true, name: true, modalities: true },
    orderBy: { sortOrder: 'asc' },
  })
}

/**
 * Que los servicios pedidos sean de este negocio.
 *
 * Va por ForbiddenError y no por UserError a propósito: un id ajeno no es un
 * error de forma que la dueña pueda corregir, es un intento de colgarle a alguien
 * el servicio de otro negocio.
 */
async function assertServicesOwned(businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return
  const owned = await prisma.service.count({
    where: { id: { in: serviceIds }, businessId },
  })
  if (owned !== serviceIds.length) {
    throw new ForbiddenError('Uno o más servicios no pertenecen a este negocio')
  }
}

async function _createProfessional(data: Record<string, unknown>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-professional', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = createProfessionalSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const serviceIds = parsed.data.serviceIds ?? []
  await assertServicesOwned(businessId, serviceIds)

  // Sin modalidades explícitas se derivan de los servicios asignados. Dejar el
  // default de la columna (on_site) dejaría un servicio online-only sin nadie que
  // lo pueda dar, y el negocio no se enteraría.
  let modalities = parsed.data.modalities
  if (!modalities) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds }, businessId },
      select: { modalities: true },
    })
    modalities = deriveModalities(services)
  }

  // Quien llega, llega al final. Se busca el mayor sortOrder y no se cuenta las
  // filas: con altas y bajas los sortOrder tienen huecos, y un count daría un
  // número ya usado.
  const last = await prisma.professional.findFirst({
    where: { businessId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const created = await prisma.professional.create({
    data: {
      businessId,
      name: parsed.data.name,
      bio: parsed.data.bio ?? null,
      modalities,
      sortOrder: last ? last.sortOrder + 1 : 0,
      services: { connect: serviceIds.map((id) => ({ id })) },
    },
    include: WITH_SERVICE_IDS,
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
  return created
}

export const createProfessional = action(_createProfessional)

async function _updateProfessional(professionalId: string, data: Record<string, unknown>) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('update-professional', 30, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateProfessionalSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }
  if (Object.keys(parsed.data).length === 0) {
    throw new UserError('No hay campos para actualizar')
  }

  // El businessId va DENTRO del where, no en un if posterior: es el filtro de
  // pertenencia. Un findUnique por id y después comparar deja la puerta abierta a
  // que alguien se olvide de comparar.
  const existing = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { id: true },
  })
  if (!existing) {
    throw new ForbiddenError('Profesional no encontrado')
  }

  const { serviceIds, ...fields } = parsed.data
  if (serviceIds) {
    await assertServicesOwned(businessId, serviceIds)
  }

  const updated = await prisma.professional.update({
    where: { id: professionalId },
    data: {
      ...fields,
      // `set` y no `connect`: destildar un servicio tiene que desasignarlo de
      // verdad. Con `connect` la lista sólo crecería y la dueña no podría sacar
      // a alguien de un servicio nunca más.
      ...(serviceIds ? { services: { set: serviceIds.map((id) => ({ id })) } } : {}),
    },
    include: WITH_SERVICE_IDS,
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export const updateProfessional = action(_updateProfessional)

async function _toggleProfessional(professionalId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('toggle-professional', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { isActive: true },
  })
  if (!existing) {
    throw new ForbiddenError('Profesional no encontrado')
  }

  // La baja es la vuelta atrás del multi-profesional: desactivar a toda la gente
  // devuelve el negocio a la agenda única de siempre, y las citas ya tomadas
  // quedan intactas.
  const updated = await prisma.professional.update({
    where: { id: professionalId },
    data: { isActive: !existing.isActive },
    include: WITH_SERVICE_IDS,
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
  return updated
}

export const toggleProfessional = action(_toggleProfessional)

async function _deleteProfessional(professionalId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('delete-professional', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const existing = await prisma.professional.findFirst({
    where: { id: professionalId, businessId },
    select: { id: true, _count: { select: { bookings: true } } },
  })
  if (!existing) {
    throw new ForbiddenError('Profesional no encontrado')
  }

  // Quien ya atendió no se borra. La FK de Booking es RESTRICT, así que la base
  // rechazaría el borrado igual: esto es el mensaje entendible, no el guard.
  if (existing._count.bookings > 0) {
    throw new UserError(
      'Tiene reservas a su nombre, así que no se puede borrar. Desactivá en vez de borrar: sale de la agenda y conserva sus citas.',
    )
  }

  // Sin ninguna reserva sí se borra de verdad — es el caso de "la cargué mal". El
  // cascade se lleva su horario y sus bloqueos, que no significan nada sin ella;
  // las filas con professionalId NULL (todo lo del negocio) no tienen FK que
  // cascadear y quedan intactas.
  await prisma.professional.delete({ where: { id: professionalId } })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
}

export const deleteProfessional = action(_deleteProfessional)

async function _reorderProfessionals(items: { id: string; sortOrder: number }[]) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('reorder-professionals', 10, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = reorderProfessionalsSchema.safeParse({ items })
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const ids = parsed.data.items.map(i => i.id)
  const uniqueIds = new Set(ids)
  const owned = await prisma.professional.count({ where: { id: { in: ids }, businessId } })
  if (owned !== uniqueIds.size) {
    throw new ForbiddenError('Uno o más profesionales no pertenecen a este negocio')
  }

  await prisma.$transaction(async (tx) => {
    for (const item of parsed.data.items) {
      await tx.professional.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    }
  })

  revalidatePath('/dashboard/equipo')
  await revalidateBusinessPublicPaths(businessId)
}

export const reorderProfessionals = action(_reorderProfessionals)
