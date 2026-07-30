import { z } from 'zod'
import { ServiceModality } from '@prisma/client'
import { sortModalities } from '@/lib/services/modality'

// Al menos una: alguien sin modalidades no puede atender nada y el funnel
// tendría que inventarle un default. El dedup es el mismo que en los servicios —
// el formulario manda checkboxes y dos clicks rápidos podrían persistir
// ['at_home','at_home'] — y se ordena para que la lista guardada no dependa del
// orden en que se tildó.
//
// Sin `.default()` a propósito: cuando no vienen, el servidor las deriva de los
// servicios asignados (`deriveModalities`). Un default acá se comería esa
// derivación y dejaría un servicio online-only sin nadie que lo pueda dar.
const modalitiesSchema = z
  .array(z.nativeEnum(ServiceModality))
  .min(1, 'Elegí al menos una modalidad')
  .transform((values) => sortModalities([...new Set(values)]))

// Vacío es válido: significa "no hace ningún servicio". Es un estado que la
// pantalla avisa (nadie puede reservar esos servicios) pero que no se prohíbe —
// dar de alta a alguien antes de decidir qué hace es un orden razonable.
const serviceIdsSchema = z
  .array(z.string().min(1))
  .transform((values) => [...new Set(values)])

const nameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre es requerido')
  .max(100, 'El nombre es demasiado largo')

const bioSchema = z
  .string()
  .trim()
  .max(500, 'La descripción es demasiado larga')
  .optional()
  .nullable()

export const createProfessionalSchema = z.object({
  name: nameSchema,
  bio: bioSchema,
  modalities: modalitiesSchema.optional(),
  serviceIds: serviceIdsSchema.optional(),
}).strip()

export const updateProfessionalSchema = z.object({
  name: nameSchema.optional(),
  bio: bioSchema,
  modalities: modalitiesSchema.optional(),
  serviceIds: serviceIdsSchema.optional(),
}).strip()
