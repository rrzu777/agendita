import { describe, it, expect } from 'vitest'
import type { BusinessCategory } from '@prisma/client'
import { getVocabulary, interpolate, BASE_VOCABULARIES, type Vocabulary } from '@/lib/vocabulary'

// El oficio que le toca a cada rubro. Es la ÚNICA lista escrita a mano del archivo y
// todo lo demás se deriva de ella.
//
// El tipo es `Record<BusinessCategory, string>` a propósito: agregar un rubro al enum de
// Prisma pasa a ser un error de COMPILACIÓN acá, así que alguien tiene que decidir su
// oficio antes de que el código compile. Una lista escrita a mano no da esa garantía —
// nada obliga a actualizarla, y el rubro nuevo se escapa de todos los guards de abajo en
// silencio. Verificado: sacarle un rubro a este mapa deja los 10 tests en verde y sólo
// falla `tsc`.
//
// Por qué el tipo no alcanza solo: `BY_CATEGORY` ya es `Record<BusinessCategory,
// Vocabulary>`, así que el rubro nuevo tiene que tener alguna entrada — pero `NEUTRAL`
// pelado compila perfecto y deja el oficio en el genérico. Que "barbero" sea la palabra
// correcta para `barber` es una decisión de producto, no una propiedad estructural: el
// tipo fuerza que alguien la tome, el `it()` verifica cuál tomó.
const EXPECTED_NOUN: Record<BusinessCategory, string> = {
  barber: 'barbero',
  nails: 'manicurista',
  hair_salon: 'estilista',
  beauty: 'especialista',
  massage: 'terapeuta',
  therapy: 'terapeuta',
  other: 'profesional',
}

const ALL_CATEGORIES = Object.keys(EXPECTED_NOUN) as BusinessCategory[]

describe('vocabulario por rubro', () => {
  it('los rubros con clientela femenina mantienen el texto actual', () => {
    for (const category of ['nails', 'beauty', 'hair_salon'] as const) {
      expect(getVocabulary(category).clients).toBe('clientas')
    }
  })

  it('los demás rubros usan la forma neutra', () => {
    for (const category of ['barber', 'massage', 'therapy', 'other'] as const) {
      expect(getVocabulary(category).clients).toBe('clientes')
    }
  })

  // Guarda contra el olvido más probable: agregar una clave a un léxico y no al otro.
  //
  // Tienen que mirar los léxicos ARMADOS, no sólo las dos formas base: BY_CATEGORY
  // aplica overrides por rubro y es ahí donde se cuela una clave de más o una entrada
  // vacía. Iterar sólo BASE_VOCABULARIES los deja pasar enteros.
  const EVERY_LEXICON: Array<readonly [string, Vocabulary]> = [
    ...Object.entries(BASE_VOCABULARIES),
    ...ALL_CATEGORIES.map((c) => [c, getVocabulary(c)] as const),
  ]

  it('todos los léxicos tienen exactamente las mismas claves', () => {
    const reference = Object.keys(BASE_VOCABULARIES.neutral).sort()
    for (const [name, lexicon] of EVERY_LEXICON) {
      expect(Object.keys(lexicon).sort(), name).toEqual(reference)
    }
  })

  it('ninguna entrada queda vacía', () => {
    for (const [name, lexicon] of EVERY_LEXICON) {
      for (const [key, value] of Object.entries(lexicon)) {
        expect(value.trim(), `${name}.${key}`).not.toBe('')
      }
    }
  })

  // El compilador ya obliga a que EXPECTED_NOUN tenga los 7 rubros (ver arriba); esto
  // verifica que la palabra elegida sea la que llega de verdad, o sea que el override
  // esté enganchado en BY_CATEGORY y no colgado sin usar.
  it('cada rubro dice su propio oficio', () => {
    for (const [category, noun] of Object.entries(EXPECTED_NOUN)) {
      expect(getVocabulary(category as BusinessCategory).professional, category).toBe(noun)
    }
  })

  // La concordancia del artículo es lo que el módulo existe para resolver: 'la
  // manicurista' y 'el barbero' no se derivan del sustantivo.
  it('el artículo concuerda con el género del rubro', () => {
    for (const category of ['nails', 'beauty', 'hair_salon'] as const) {
      expect(getVocabulary(category).theProfessional, category).toMatch(/^la /)
      expect(getVocabulary(category).aProfessional, category).toMatch(/^una /)
    }
    for (const category of ['barber', 'massage', 'therapy', 'other'] as const) {
      expect(getVocabulary(category).theProfessional, category).toMatch(/^el /)
      expect(getVocabulary(category).aProfessional, category).toMatch(/^un /)
    }
  })
})

describe('interpolate', () => {
  it('reemplaza los tokens por la entrada del léxico', () => {
    expect(interpolate('Tus {clients} ganan 1 sello.', getVocabulary('nails')))
      .toBe('Tus clientas ganan 1 sello.')
    expect(interpolate('Tus {clients} ganan 1 sello.', getVocabulary('barber')))
      .toBe('Tus clientes ganan 1 sello.')
  })

  it('reemplaza varios tokens en la misma frase', () => {
    expect(interpolate('Cuando {aClient} refiere, {bothOfThem} ganan.', getVocabulary('barber')))
      .toBe('Cuando un cliente refiere, ambos ganan.')
  })

  // Un token mal escrito tiene que verse en pantalla, no dejar un hueco: el hueco
  // pasa desapercibido en review y la frase queda mutilada en producción.
  it('deja intacto un token que no existe en el léxico', () => {
    expect(interpolate('Hola {noExiste}.', getVocabulary('nails'))).toBe('Hola {noExiste}.')
  })

  it('deja intacto un texto sin tokens', () => {
    expect(interpolate('Sin tokens acá.', getVocabulary('nails'))).toBe('Sin tokens acá.')
  })
})
