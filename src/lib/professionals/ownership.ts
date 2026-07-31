import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

/**
 * ¿Ese id es de alguien de ESTE negocio que además sigue atendiendo?
 *
 * `normalizeProfessionalId` (`lib/availability/scope.ts`) defiende la **forma** del
 * dato; esto defiende la **procedencia**. Son dos chequeos distintos y hacen falta los
 * dos: un id con forma válida pero de otro salón no da error en ninguna query — cae
 * por la herencia de horario al horario de este negocio y devuelve una respuesta
 * plausible—, así que el problema aparece recién cuando algo se guarda a nombre de
 * alguien que no existe acá.
 *
 * **Exige `isActive`** a propósito y en todas las superficies por igual: alguien en
 * pausa está fuera de la agenda, así que darle horario o bloqueos es escribir en el
 * vacío. Que la regla sea una sola evita la pregunta "¿en cuál de las pantallas vale?".
 */
export async function isProfessionalOfBusiness(
  client: Db,
  businessId: string,
  professionalId: string,
): Promise<boolean> {
  const found = await client.professional.findFirst({
    where: { id: professionalId, businessId, isActive: true },
    select: { id: true },
  })
  return found !== null
}
