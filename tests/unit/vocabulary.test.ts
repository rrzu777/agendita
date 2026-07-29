import { describe, it, expect } from 'vitest'
import type { BusinessCategory } from '@prisma/client'
import { getVocabulary, interpolate, VOCABULARIES } from '@/lib/vocabulary'

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
  it('todos los léxicos tienen exactamente las mismas claves', () => {
    const [first, ...rest] = Object.values(VOCABULARIES)
    for (const lexicon of rest) {
      expect(Object.keys(lexicon).sort()).toEqual(Object.keys(first).sort())
    }
  })

  it('ninguna entrada queda vacía', () => {
    for (const lexicon of Object.values(VOCABULARIES)) {
      for (const [key, value] of Object.entries(lexicon)) {
        expect(value, key).not.toBe('')
      }
    }
  })

  // El olvido más probable no es escribir mal una palabra — el compilador lo caza —
  // sino olvidarse de darle su oficio a un rubro y que se quede con el genérico
  // "profesional" sin que nada se queje.
  it('cada rubro dice su propio oficio', () => {
    const expected: Record<string, string> = {
      barber: 'barbero',
      nails: 'manicurista',
      hair_salon: 'estilista',
      beauty: 'especialista',
      massage: 'terapeuta',
      therapy: 'terapeuta',
      other: 'profesional',
    }
    for (const [category, noun] of Object.entries(expected)) {
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
