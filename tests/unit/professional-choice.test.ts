import { describe, it, expect } from 'vitest'
import { professionalChoice, resolveProfessionalId, type FunnelProfessional } from '@/lib/professionals/eligible'

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

describe('qué id termina en la reserva', () => {
  it('con una sola elegible, la suya, aunque el estado no traiga nada', () => {
    const choice = professionalChoice([persona('ana', ['svc-1'])], 'svc-1', 'on_site')
    expect(resolveProfessionalId(choice, null)).toBe('ana')
  })

  it('sin elegibles, ninguno', () => {
    expect(resolveProfessionalId({ kind: 'none' }, 'ana')).toBeNull()
  })

  /**
   * El caso del estado viejo: eligió a Ana para un corte, volvió atrás y cambió a un
   * servicio que Ana no hace. Devolver 'ana' escribiría una reserva a nombre de quien
   * no da ese servicio; el server la rechazaría, pero recién en el paso de pago.
   */
  it('descarta al elegido que ya no está entre las opciones', () => {
    const choice = professionalChoice([persona('b', ['svc-1']), persona('c', ['svc-1'])], 'svc-1', 'on_site')
    expect(resolveProfessionalId(choice, 'ana')).toBeNull()
    expect(resolveProfessionalId(choice, 'c')).toBe('c')
  })
})
