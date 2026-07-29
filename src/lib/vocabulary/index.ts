import type { BusinessCategory } from '@prisma/client'

/**
 * Vocabulario de cara al usuario que cambia según el rubro del negocio.
 *
 * POR QUÉ FRASES Y NO PALABRAS SUELTAS: en castellano el género arrastra
 * artículos, adjetivos y participios — los verbos no. Guardar sólo el sustantivo
 * y pegarlo en el call site produce "el clienta" y "clientes inactivas". Cada
 * entrada de acá ya trae la concordancia resuelta, escrita a mano, en las dos
 * formas. Nada de trucos tipo `inactiv${v.o}s`: ilegibles, y se rompen con el
 * primer adjetivo irregular.
 *
 * POR QUÉ NO ES UN i18n COMPLETO: la enorme mayoría de las frases del producto
 * tienen un solo sustantivo genérico y ninguna otra marca de género, así que
 * alcanza con interpolar `clients` y la frase queda bien. Sólo las que arrastran
 * concordancia más allá del sustantivo viven enteras acá.
 */
export interface Vocabulary {
  /** "clienta" | "cliente" */
  client: string
  /** "clientas" | "clientes" */
  clients: string
  /** "Clienta" | "Cliente" — encabezado de tabla y etiqueta de email */
  Client: string
  /** "la clienta" | "el cliente" */
  theClient: string
  /** "La clienta" | "El cliente" — arranque de oración */
  TheClient: string
  /** "una clienta" | "un cliente" */
  aClient: string
  /** "Esta clienta" | "Este cliente" */
  thisClient: string
  /** "clientas inactivas" | "clientes inactivos" */
  inactiveClients: string
  /** "Reactivar inactivas" | "Reactivar inactivos" — label de la regla automática */
  reactivateInactiveLabel: string
  /** "Referidas" | "Referidos" — label de la regla automática */
  referralsLabel: string
  /** Preset de referidos: arrastra concordancia en dos puntos ("una clienta" + "ambas"). */
  referralPresetLine: string
}

const FEMININE: Vocabulary = {
  client: 'clienta',
  clients: 'clientas',
  Client: 'Clienta',
  theClient: 'la clienta',
  TheClient: 'La clienta',
  aClient: 'una clienta',
  thisClient: 'Esta clienta',
  inactiveClients: 'clientas inactivas',
  reactivateInactiveLabel: 'Reactivar inactivas',
  referralsLabel: 'Referidas',
  referralPresetLine: 'Cuando una clienta refiere a alguien nuevo, ambas reciben 20% de descuento.',
}

const NEUTRAL: Vocabulary = {
  client: 'cliente',
  clients: 'clientes',
  Client: 'Cliente',
  theClient: 'el cliente',
  TheClient: 'El cliente',
  aClient: 'un cliente',
  thisClient: 'Este cliente',
  inactiveClients: 'clientes inactivos',
  reactivateInactiveLabel: 'Reactivar inactivos',
  referralsLabel: 'Referidos',
  referralPresetLine: 'Cuando un cliente refiere a alguien nuevo, ambos reciben 20% de descuento.',
}

export const VOCABULARIES = { feminine: FEMININE, neutral: NEUTRAL } as const

/**
 * Femenino en los rubros donde ya era el texto vigente — cambiarlo les movería el
 * tono a las manicuristas que ya usan el producto. Neutro en todo lo demás.
 */
const BY_CATEGORY: Record<BusinessCategory, Vocabulary> = {
  nails: FEMININE,
  beauty: FEMININE,
  hair_salon: FEMININE,
  barber: NEUTRAL,
  massage: NEUTRAL,
  therapy: NEUTRAL,
  other: NEUTRAL,
}

export function getVocabulary(category: BusinessCategory): Vocabulary {
  return BY_CATEGORY[category] ?? NEUTRAL
}
