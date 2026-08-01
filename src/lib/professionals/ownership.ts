import type { Prisma, PrismaClient, ServiceModality } from '@prisma/client'
import { ForbiddenError } from '@/lib/auth/server'
import { UserError } from '@/lib/actions/result'
import { normalizeProfessionalId } from '@/lib/availability/scope'

type Db = PrismaClient | Prisma.TransactionClient

/** Lo único que ve la clienta cuando la persona que pidió no sirve, sea porque no
 *  existe, porque se dio de baja o porque no hace ese servicio. Un solo mensaje: los
 *  motivos internos no son asunto de quien reserva. */
export const PROFESSIONAL_UNAVAILABLE_MESSAGE = 'Esa persona no está disponible para reservar'

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
 * **Normaliza adentro, y eso no es prolijidad: es el guard.** El id llega como
 * argumento de una server action, o sea del navegador, y un `undefined` en el `where`
 * hace que Prisma **borre la clave `id`** — la query pasa a ser "cualquier persona
 * activa de este negocio" y **el chequeo da true**. De ahí en adelante ese mismo
 * `undefined` sigue viaje hasta el `where` del `deleteMany` o el `updateMany`, donde
 * significa "todas las filas del negocio". Mientras normalizar sea un renglón que cada
 * caller tiene que acordarse de escribir, el próximo caller se lo va a olvidar.
 *
 * **Exige `isActive`** a propósito y en todas las superficies por igual: alguien en
 * pausa está fuera de la agenda, así que darle horario o bloqueos es escribir en el
 * vacío. Que la regla sea una sola evita la pregunta "¿en cuál de las pantallas vale?"
 * — con la contra de que tampoco se le puede soltar el horario propio a alguien en
 * pausa. Se revisa cuando exista la pantalla que muestra a la gente pausada.
 */
export async function isProfessionalOfBusiness(
  client: Db,
  businessId: string,
  professionalId: string | null,
): Promise<boolean> {
  const id = normalizeProfessionalId(professionalId)
  if (id === null) return false
  const found = await client.professional.findFirst({
    where: { id, businessId, isActive: true },
    select: { id: true },
  })
  return found !== null
}

/**
 * La forma canónica para el panel: normaliza, valida y **devuelve el id normalizado**,
 * que es el único que se puede meter en un `where`. Tira `ForbiddenError` con todo lo
 * demás, incluido `null` — las pantallas por persona necesitan una persona.
 *
 * Devolver el valor y no un booleano es lo que hace que el caller no pueda seguir
 * usando el argumento crudo por descuido.
 *
 * El mensaje dice "persona" y no "profesional" porque el sustantivo de oficio es por
 * rubro (ver `lib/vocabulary`) y este texto no tiene el negocio a mano.
 */
export async function assertProfessionalOfBusiness(
  client: Db,
  businessId: string,
  professionalId: string | null,
): Promise<string> {
  const id = normalizeProfessionalId(professionalId)
  if (id === null || !(await isProfessionalOfBusiness(client, businessId, id))) {
    throw new ForbiddenError('Persona no encontrada')
  }
  return id
}

/**
 * La variante para todo lo que puede ser **del salón o de una persona**: horario
 * semanal y bloqueos. Acá `null` **sí** es válido —es el salón, que existe en todos los
 * negocios— y por eso devuelve `string | null` en vez de tirar.
 *
 * Es la misma pregunta en las dos superficies y por eso es una sola función: el día que
 * cambie qué cuenta como dueño válido (gente en pausa, por ejemplo), tiene que cambiar
 * para el horario y para los bloqueos a la vez o quedan pantallas que aceptan lo que la
 * otra rechaza.
 *
 * **Ojo: misma validación, distinto significado río abajo.** Con el mismo id, los
 * bloqueos son una UNIÓN —los del salón **más** los suyos, `blockScopeFor`— y el horario
 * es un O EXCLUSIVO —el suyo **o** el del salón, nunca los dos, `resolveRuleScope`—.
 * Esta función dice si el dueño es válido; qué se hace con él lo decide cada dominio.
 */
export async function assertOwnerScope(
  client: Db,
  businessId: string,
  professionalId: string | null,
): Promise<string | null> {
  const id = normalizeProfessionalId(professionalId)
  return id === null ? null : assertProfessionalOfBusiness(client, businessId, id)
}

/**
 * El guard del funnel PÚBLICO: ¿esta persona puede tomar ESTA reserva?
 *
 * Es la contraparte servidor de `professionalChoice` (`lib/professionals/eligible.ts`),
 * que decide lo mismo en el navegador para armar la lista. Las dos existen porque
 * responden a preguntas distintas: aquella arma una pantalla, ésta autoriza una
 * escritura. El id llega de un formulario público, así que lo que se muestre allá no
 * limita nada de lo que puede llegar acá.
 *
 * Tres condiciones, y las tres en el mismo `where` para que sea una sola consulta:
 * que sea de este negocio y siga atendiendo (lo mismo que `isProfessionalOfBusiness`),
 * que haga el servicio, y que atienda en esa modalidad. La última es la que se olvida:
 * un servicio se puede pedir a domicilio sin que todo el equipo viaje.
 *
 * **La modalidad es la RESUELTA por `resolveBookingDraft`, no la pedida.** El servidor
 * pisa la modalidad cuando el servicio tiene una sola, así que validar contra la que
 * mandó el navegador dejaría pasar a alguien que no atiende donde la reserva va a
 * decir que se atiende. Por eso el parámetro no es opcional: un `undefined` acá borra
 * la clave del `where` y el chequeo pasa a ser "en cualquier lado".
 */
export async function assertProfessionalOffersService(
  client: Db,
  businessId: string,
  professionalId: string,
  serviceId: string,
  modality: ServiceModality,
): Promise<string> {
  const id = normalizeProfessionalId(professionalId)
  if (id === null) throw new UserError(PROFESSIONAL_UNAVAILABLE_MESSAGE)

  const found = await client.professional.findFirst({
    where: {
      id,
      businessId,
      isActive: true,
      services: { some: { id: serviceId } },
      modalities: { has: modality },
    },
    select: { id: true },
  })
  if (!found) throw new UserError(PROFESSIONAL_UNAVAILABLE_MESSAGE)
  return id
}
