'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusiness, requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import { deriveModalities } from '@/lib/professionals/modalities'
import { createProfessionalSchema, updateProfessionalSchema } from '@/lib/professionals/schema'
import { reorderSchema } from '@/lib/reorder-schema'

export async function getProfessionals(includeInactive = false) {
  const { businessId } = await requireBusiness()
  return prisma.professional.findMany({
    where: {
      ...(includeInactive ? {} : { isActive: true }),
      businessId,
    },
    // La pantalla necesita qué servicios hace cada persona para pre-marcar los
    // checkboxes del formulario. Los ids alcanzan: los nombres salen de la lista de
    // servicios, que se carga una sola vez.
    include: { services: { select: { id: true } } },
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
 *
 * **No filtra `isActive`, y es a propósito.** Dar de baja un servicio es un
 * soft-delete, así que las asignaciones viejas sobreviven — y el formulario
 * devuelve TODOS los ids asignados, tildados o no. Si acá se exigiera que estén
 * activos, editar a cualquier persona que tenga un servicio dado de baja fallaría,
 * y guardar le borraría esa asignación en silencio.
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

  // Las dos lecturas van juntas porque no dependen una de otra. Y son DOS, no
  // tres: traer los servicios pedidos sirve al mismo tiempo para verificar que
  // sean de este negocio (comparando cuántos volvieron) y para derivarles las
  // modalidades — antes eran dos queries con el `where` idéntico.
  const [ownedServices, last] = await Promise.all([
    serviceIds.length > 0
      ? prisma.service.findMany({
          where: { id: { in: serviceIds }, businessId },
          select: { id: true, modalities: true },
        })
      : Promise.resolve([]),
    // Quien llega, llega al final. Se busca el mayor sortOrder y no se cuentan las
    // filas: con altas y bajas los sortOrder tienen huecos, y un count daría un
    // número ya usado.
    prisma.professional.findFirst({
      where: { businessId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    }),
  ])

  if (ownedServices.length !== serviceIds.length) {
    throw new ForbiddenError('Uno o más servicios no pertenecen a este negocio')
  }

  // Sin modalidades explícitas se derivan de los servicios asignados; ver el
  // docstring de deriveModalities para qué defiende y qué no.
  const modalities = parsed.data.modalities ?? deriveModalities(ownedServices)

  const created = await prisma.professional.create({
    data: {
      businessId,
      name: parsed.data.name,
      bio: parsed.data.bio ?? null,
      modalities,
      sortOrder: last ? last.sortOrder + 1 : 0,
      services: { connect: serviceIds.map((id) => ({ id })) },
    },
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

  // El conteo es de TODAS las reservas, sin filtrar por estado — canceladas y
  // vencidas incluidas. Es a propósito: tiene que espejar exactamente lo que la FK
  // permite, y la FK no mira el status. Filtrar por los estados "vivos" dejaría
  // pasar borrados que la base después rechaza con un error crudo, y `action()`
  // convierte cualquier cosa que no sea UserError en "Ocurrió un error inesperado."
  //
  // La FK es NO ACTION (no RESTRICT: ver el comentario del schema — con RESTRICT se
  // rompía el borrado en cascada de un negocio). Las dos rechazan igual este caso,
  // así que la base sigue siendo el guard de verdad y esto es sólo el mensaje
  // entendible.
  if (existing._count.bookings > 0) {
    throw new UserError(
      'Tiene reservas a su nombre —aunque estén canceladas— así que no se puede borrar. Usá la pausa: sale de la agenda y conserva sus citas.',
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

  const parsed = reorderSchema.safeParse({ items })
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
