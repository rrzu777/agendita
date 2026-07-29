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
  /** "inactivas" | "inactivos" — el adjetivo solo, cuando el sustantivo va antes */
  inactive: string
  /** "Reactivar inactivas" | "Reactivar inactivos" — label de la regla automática */
  reactivateInactiveLabel: string
  /** "Referidas" | "Referidos" — label de la regla automática */
  referralsLabel: string
  /** "ambas" | "ambos" — el preset de referidos premia a las dos partes */
  bothOfThem: string
  /** "reactivarla" | "reactivarlo" */
  reactivateThem: string
  /** "la referida" | "el referido" */
  referredPerson: string
  /** "Refiere una amiga" | "Refiere a alguien" — nombre del preset de referidos */
  referralPresetName: string
  /** "la referidora" | "el referidor" — quien trae a alguien nuevo */
  referrer: string
  /** "referidora" | "referidor" — el sustantivo solo */
  referrerNoun: string
  /** "referida" | "referido" — el sustantivo solo */
  referredNoun: string
  /** "Ambas" | "Ambos" — opción de beneficiario en la regla de referidos */
  bothParties: string
  /** "ambas ganan" | "ambos ganan" — copy de la tarjeta de fidelización */
  bothWin: string
  /** "Referí a una amiga" | "Referí a alguien" — título del bloque de referidos */
  referAFriend: string
  /** "Destinatarias" | "Destinatarios" */
  Recipients: string
  /** "destinatarias" | "destinatarios" */
  recipients: string
  /** "Sin destinatarias" | "Sin destinatarios" — estado vacío */
  noRecipients: string
  /** "Ninguna clienta" | "Ningún cliente" */
  noClient: string
  /** "Inactivas" | "Inactivos" — nombre del segmento de campaña */
  InactiveSegment: string
  /** "Cumpleañeras del mes" | "Cumpleañeros del mes" — nombre del segmento */
  birthdaySegment: string
}

const FEMININE: Vocabulary = {
  client: 'clienta',
  clients: 'clientas',
  Client: 'Clienta',
  theClient: 'la clienta',
  TheClient: 'La clienta',
  aClient: 'una clienta',
  thisClient: 'Esta clienta',
  inactive: 'inactivas',
  reactivateInactiveLabel: 'Reactivar inactivas',
  referralsLabel: 'Referidas',
  bothOfThem: 'ambas',
  reactivateThem: 'reactivarla',
  referredPerson: 'la referida',
  referralPresetName: 'Refiere una amiga',
  referrer: 'la referidora',
  referrerNoun: 'referidora',
  referredNoun: 'referida',
  bothParties: 'Ambas',
  bothWin: 'ambas ganan',
  referAFriend: 'Referí a una amiga',
  Recipients: 'Destinatarias',
  recipients: 'destinatarias',
  noRecipients: 'Sin destinatarias',
  noClient: 'Ninguna clienta',
  InactiveSegment: 'Inactivas',
  birthdaySegment: 'Cumpleañeras del mes',
}

const NEUTRAL: Vocabulary = {
  client: 'cliente',
  clients: 'clientes',
  Client: 'Cliente',
  theClient: 'el cliente',
  TheClient: 'El cliente',
  aClient: 'un cliente',
  thisClient: 'Este cliente',
  inactive: 'inactivos',
  reactivateInactiveLabel: 'Reactivar inactivos',
  referralsLabel: 'Referidos',
  bothOfThem: 'ambos',
  reactivateThem: 'reactivarlo',
  referredPerson: 'el referido',
  referralPresetName: 'Refiere a alguien',
  referrer: 'el referidor',
  referrerNoun: 'referidor',
  referredNoun: 'referido',
  bothParties: 'Ambos',
  bothWin: 'ambos ganan',
  referAFriend: 'Referí a alguien',
  Recipients: 'Destinatarios',
  recipients: 'destinatarios',
  noRecipients: 'Sin destinatarios',
  noClient: 'Ningún cliente',
  InactiveSegment: 'Inactivos',
  birthdaySegment: 'Cumpleañeros del mes',
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

/**
 * Reemplaza `{clave}` por la entrada del léxico.
 *
 * Para catálogos de copy que son constantes de módulo y no pueden recibir el
 * léxico al construirse — hoy los presets de fidelización. En un componente no
 * hace falta: ahí se interpola con template literals y se lee mejor.
 *
 * Una clave que no existe se deja tal cual (`{loQueSea}`) en vez de quedar
 * vacía: si se cuela un token mal escrito, se ve en pantalla en lugar de
 * producir una frase mutilada.
 */
export function interpolate(text: string, vocabulary: Vocabulary): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (vocabulary as unknown as Record<string, string | undefined>)[key]
    return value ?? match
  })
}
