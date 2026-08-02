import { describe, it, expect } from 'vitest'
import {
  ANYONE_LABEL,
  NO_PROFESSIONAL,
  eligibleProfessionals,
  parseProfessionalPick,
  pickCacheKey,
  professionalChoice,
  professionalFields,
  samePick,
  type FunnelProfessional,
} from '@/lib/professionals/eligible'

function persona(id: string, serviceIds: string[], modalities: FunnelProfessional['modalities'] = ['on_site']): FunnelProfessional {
  return { id, name: `Persona ${id}`, bio: null, modalities, serviceIds }
}

describe('a quién le puede tocar la reserva', () => {
  it('sin equipo cargado el funnel queda como estaba', () => {
    expect(professionalChoice([], 'svc-1', 'on_site')).toEqual({ kind: 'none' })
  })

  // El negocio tiene gente, pero ninguna hace ESE servicio. No es lo mismo que no
  // tener equipo y aun así el funnel tiene que comportarse igual: preguntar entre
  // cero opciones sería una pantalla vacía sin salida.
  it('con equipo que no hace ese servicio también queda como estaba', () => {
    expect(professionalChoice([persona('a', ['svc-2'])], 'svc-1', 'on_site')).toEqual({ kind: 'none' })
  })

  it('con una sola no pregunta, pero la reserva igual queda a su nombre', () => {
    const ana = persona('ana', ['svc-1'])
    expect(professionalChoice([ana], 'svc-1', 'on_site')).toEqual({ kind: 'auto', professional: ana })
  })

  it('con dos o más aparece el paso, en el orden que definió la dueña', () => {
    const choice = professionalChoice([persona('a', ['svc-1']), persona('b', ['svc-1'])], 'svc-1', 'on_site')
    expect(choice.kind).toBe('ask')
    expect(choice.kind === 'ask' && choice.options.map((p) => p.id)).toEqual(['a', 'b'])
  })

  /**
   * La intersección con la modalidad es la que se olvida: el servicio se puede pedir
   * a domicilio, pero eso no dice quién viaja. Sin este filtro el funnel ofrece "a
   * domicilio con Juan" y Juan no sale del local.
   */
  it('descarta a quien no atiende en la modalidad elegida', () => {
    const viaja = persona('viaja', ['svc-1'], ['on_site', 'at_home'])
    const noViaja = persona('no-viaja', ['svc-1'], ['on_site'])
    expect(professionalChoice([viaja, noViaja], 'svc-1', 'at_home')).toEqual({ kind: 'auto', professional: viaja })
  })

  it('sin servicio elegido todavía no hay nada que decidir', () => {
    expect(professionalChoice([persona('a', ['svc-1'])], null, null)).toEqual({ kind: 'none' })
  })
})

describe('quién puede tomar la reserva, pregunte o no el funnel', () => {
  it('la lista es la misma con una que con varias', () => {
    const una = professionalChoice([persona('ana', ['svc-1'])], 'svc-1', 'on_site')
    const varias = professionalChoice([persona('a', ['svc-1']), persona('b', ['svc-1'])], 'svc-1', 'on_site')
    expect(eligibleProfessionals(una).map((p) => p.id)).toEqual(['ana'])
    expect(eligibleProfessionals(varias).map((p) => p.id)).toEqual(['a', 'b'])
    expect(eligibleProfessionals({ kind: 'none' })).toEqual([])
  })
})

describe('qué elección termina en la reserva', () => {
  const DOS = professionalChoice([persona('b', ['svc-1']), persona('c', ['svc-1'])], 'svc-1', 'on_site')

  it('con una sola elegible, la suya, aunque el estado no traiga nada', () => {
    const choice = professionalChoice([persona('ana', ['svc-1'])], 'svc-1', 'on_site')
    expect(professionalFields(choice, NO_PROFESSIONAL)).toEqual({
      professional: { kind: 'person', id: 'ana' },
      professionalName: 'Persona ana',
    })
  })

  it('sin elegibles, ninguno', () => {
    expect(professionalFields({ kind: 'none' }, { kind: 'person', id: 'ana' })).toEqual({
      professional: { kind: 'none' },
      professionalName: '',
    })
  })

  /**
   * El caso del estado viejo: eligió a Ana para un corte, volvió atrás y cambió a un
   * servicio que Ana no hace. Devolver 'ana' escribiría una reserva a nombre de quien
   * no da ese servicio; el server la rechazaría, pero recién en el paso de pago.
   */
  it('descarta al elegido que ya no está entre las opciones', () => {
    expect(professionalFields(DOS, { kind: 'person', id: 'ana' }).professional).toEqual({ kind: 'none' })
    expect(professionalFields(DOS, { kind: 'person', id: 'c' }).professional).toEqual({ kind: 'person', id: 'c' })
  })

  it('"cualquiera" sobrevive mientras siga habiendo a quién elegir', () => {
    expect(professionalFields(DOS, { kind: 'anyone' })).toEqual({
      professional: { kind: 'anyone' },
      professionalName: ANYONE_LABEL,
    })
  })

  /**
   * Con una sola elegible "cualquiera" ES esa persona, y la reserva tiene que quedar
   * a su nombre: si sobreviviera como `anyone`, la confirmación no podría nombrarla y
   * el servidor tendría que resolver algo que ya está resuelto.
   */
  it('"cualquiera" colapsa en la única elegible', () => {
    const choice = professionalChoice([persona('ana', ['svc-1'])], 'svc-1', 'on_site')
    expect(professionalFields(choice, { kind: 'anyone' })).toEqual({
      professional: { kind: 'person', id: 'ana' },
      professionalName: 'Persona ana',
    })
  })

  it('y se cae junto con el paso cuando ya no queda nadie', () => {
    expect(professionalFields({ kind: 'none' }, { kind: 'anyone' }).professional).toEqual({ kind: 'none' })
  })
})

// Es lo que decide si la hora elegida sigue valiendo: pasar de una persona a
// "cualquiera" cambia la agenda tanto como cambiar de persona.
describe('cuándo dos elecciones son la misma', () => {
  it('distingue los tres casos, y a dos personas entre sí', () => {
    expect(samePick({ kind: 'anyone' }, { kind: 'anyone' })).toBe(true)
    expect(samePick({ kind: 'person', id: 'a' }, { kind: 'person', id: 'a' })).toBe(true)
    expect(samePick({ kind: 'person', id: 'a' }, { kind: 'person', id: 'b' })).toBe(false)
    expect(samePick({ kind: 'anyone' }, { kind: 'person', id: 'a' })).toBe(false)
    expect(samePick({ kind: 'none' }, { kind: 'anyone' })).toBe(false)
  })
})


/**
 * Lo que llega del navegador y del sessionStorage. Los dos bordes que no pasan por zod
 * usan esto, y lo que tiene que hacer con basura es caer a "sin persona" —el lado
 * conservador, que choca contra todas las citas y que el paso vuelve a preguntar— y no
 * dejarla pasar entera.
 */
describe('lo que llega de afuera', () => {
  it('acepta las tres formas válidas', () => {
    expect(parseProfessionalPick({ kind: 'anyone' })).toEqual({ kind: 'anyone' })
    expect(parseProfessionalPick({ kind: 'person', id: 'ana' })).toEqual({ kind: 'person', id: 'ana' })
    expect(parseProfessionalPick({ kind: 'none' })).toEqual({ kind: 'none' })
  })

  it('y todo lo demás es "sin persona"', () => {
    for (const basura of [undefined, null, 'ana', 42, {}, { kind: 'inventado' }, { kind: 'person' }, { kind: 'person', id: '' }, { kind: 'person', id: 7 }]) {
      expect(parseProfessionalPick(basura), JSON.stringify(basura) ?? 'undefined').toEqual({ kind: 'none' })
    }
  })
})

// La clave del efecto que pide horarios: tiene que distinguir las tres formas y a dos
// personas entre sí, o el paso de la hora se queda con los horarios de la anterior.
describe('la elección como clave', () => {
  it('distingue los tres casos y a dos personas', () => {
    const claves = [
      pickCacheKey({ kind: 'none' }),
      pickCacheKey({ kind: 'anyone' }),
      pickCacheKey({ kind: 'person', id: 'a' }),
      pickCacheKey({ kind: 'person', id: 'b' }),
    ]
    expect(new Set(claves).size).toBe(4)
    expect(pickCacheKey({ kind: 'person', id: 'a' })).toBe(pickCacheKey({ kind: 'person', id: 'a' }))
  })
})
