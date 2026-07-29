import { describe, it, expect } from 'vitest'
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
