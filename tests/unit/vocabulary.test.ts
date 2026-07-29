import { describe, it, expect } from 'vitest'
import { getVocabulary, VOCABULARIES } from '@/lib/vocabulary'

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
