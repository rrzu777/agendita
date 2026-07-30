import { describe, expect, it, vi } from 'vitest'
import type { BusinessCategory, ServiceModality } from '@prisma/client'
import { getVocabulary } from '@/lib/vocabulary'
import { renderWithVocabulary } from '../helpers/vocabulary'
import { ProfessionalTable } from '@/components/dashboard/professional-table'
import type { RowProfessional } from '@/components/dashboard/professional-row-actions'

// Sin este mock, renderToStaticMarkup revienta: la sidebar y varios componentes de
// panel llaman useRouter(), que fuera del router de Next tira.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/server/actions/professionals', () => ({
  toggleProfessional: vi.fn(),
  deleteProfessional: vi.fn(),
  reorderProfessionals: vi.fn(),
  createProfessional: vi.fn(),
  updateProfessional: vi.fn(),
}))

const SERVICES = [
  { id: 'svc-1', name: 'Corte', modalities: ['on_site'] as ServiceModality[] },
  { id: 'svc-2', name: 'Barba', modalities: ['on_site'] as ServiceModality[] },
]

function person(overrides: Partial<RowProfessional> = {}): RowProfessional {
  return {
    id: 'p-1',
    name: 'Juan',
    bio: null,
    isActive: true,
    sortOrder: 0,
    modalities: ['on_site'] as ServiceModality[],
    serviceIds: ['svc-1'],
    ...overrides,
  }
}

function render(professionals: RowProfessional[], category: BusinessCategory = 'barber') {
  return renderWithVocabulary(
    category,
    <ProfessionalTable professionals={professionals} services={SERVICES} />,
  )
}

describe('ProfessionalTable — el léxico del rubro', () => {
  // Es el guard del trabajo del PR 0: si alguien clava "profesional" en la
  // pantalla, el sustantivo del rubro deja de llegar y nadie se entera.
  it('el botón de alta usa el sustantivo del rubro, no "profesional"', () => {
    const barberia = render([person()], 'barber')
    expect(barberia).toContain('Agregar barbero')
    expect(barberia).not.toContain('Agregar profesional')

    const unas = render([person()], 'nails')
    expect(unas).toContain('Agregar manicurista')
    expect(unas).not.toContain('Agregar profesional')
  })

  it('el estado vacío usa noProfessionals del léxico', () => {
    expect(render([], 'barber')).toContain('Sin barberos')
    expect(render([], 'nails')).toContain('Sin manicuristas')
  })

  // El sustantivo del oficio es de género común en cinco de los seis rubros
  // (manicurista, estilista, especialista, terapeuta, profesional): lo que cambia
  // es el artículo. Esta pantalla no usa ninguna de las formas con artículo — es
  // una decisión de producto todavía abierta — así que ninguna se debe colar.
  it('no usa las formas con artículo, que son la decisión abierta', () => {
    for (const category of ['hair_salon', 'beauty', 'nails'] as BusinessCategory[]) {
      const markup = render([person()], category)
      const v = getVocabulary(category)
      expect(markup, `${category}.theProfessional`).not.toContain(v.theProfessional)
      expect(markup, `${category}.aProfessional`).not.toContain(v.aProfessional)
    }
  })
})

describe('ProfessionalTable — el interruptor', () => {
  // La presencia de gente EN AGENDA es el interruptor del multi-profesional: no
  // hay flag que configurar. Este texto es el único lugar donde la dueña puede
  // anticipar el salto de 1 a 2 antes de darlo.
  it('con nadie en agenda avisa que hay un solo horario para todo', () => {
    expect(render([])).toContain('un solo horario para todo')
  })

  it('con nadie en agenda lo dice también si hay gente en pausa', () => {
    expect(render([person({ isActive: false })])).toContain('un solo horario para todo')
  })

  it('con una sola persona en agenda avisa que se va a asignar sola', () => {
    expect(render([person()])).toContain('se va a asignar sola')
  })

  it('con dos o más dice cuántas hay y que van a poder elegir', () => {
    const markup = render([person(), person({ id: 'p-2', name: 'Ana', sortOrder: 1 })])
    expect(markup).toContain('Con 2 personas en agenda')
    expect(markup).toContain('van a poder elegir')
  })

  // El aviso cuenta ACTIVOS, no filas. Si contara filas, poner a alguien en pausa
  // dejaría el texto de 2+ mintiendo.
  it('la gente en pausa no cuenta para el aviso', () => {
    const markup = render([person(), person({ id: 'p-2', name: 'Ana', sortOrder: 1, isActive: false })])
    expect(markup).toContain('se va a asignar sola')
    expect(markup).not.toContain('van a poder elegir')
  })
})

// Este bloque existe por un hallazgo de la revisión: la pantalla decía "tus
// clientas eligen con quién se atienden" en PRESENTE, y eso todavía no es cierto —
// el horario por persona y la elección en el funnel llegan después. La dueña carga
// a sus 3 barberos, la pantalla le confirma que ya funciona, abre el funnel y no
// cambió nada. Eso entra como reporte de bug, no como "falta una parte".
//
// Estos casos se borran cuando el funnel por persona exista de verdad. Hasta
// entonces son lo que impide que la promesa vuelva en presente sin que nadie lo note.
describe('ProfessionalTable — no promete lo que todavía no funciona', () => {
  const PRESENTE_PROHIBIDO = [
    'eligen con quién se atienden',
    'cada persona tiene su propio horario',
    'nadie va a poder reservar con esta persona',
  ]

  it('con gente en agenda avisa que por ahora sólo se guarda', () => {
    expect(render([person()])).toContain('Por ahora sólo se guarda')
    expect(render([person(), person({ id: 'p-2', sortOrder: 1 })])).toContain(
      'Por ahora sólo se guarda',
    )
  })

  it('sin nadie en agenda no muestra ese aviso, que no aplica', () => {
    expect(render([])).not.toContain('Por ahora sólo se guarda')
  })

  it('no afirma en presente ninguna capacidad que no exista', () => {
    for (const markup of [render([person()]), render([person(), person({ id: 'p-2', sortOrder: 1 })])]) {
      for (const frase of PRESENTE_PROHIBIDO) {
        expect(markup, frase).not.toContain(frase)
      }
    }
  })
})

describe('ProfessionalTable — las filas', () => {
  it('muestra a la gente en pausa con su badge', () => {
    const markup = render([person({ isActive: false })])
    expect(markup).toContain('En pausa')
    // Y no el badge de servicios, que diría "Inactivo" en masculino sobre una
    // persona.
    expect(markup).not.toContain('Inactivo')
  })

  it('resume los servicios en vez de listarlos', () => {
    expect(render([person({ serviceIds: ['svc-1'] })]).includes('1 de 2')).toBe(true)
    expect(render([person({ serviceIds: ['svc-1', 'svc-2'] })])).toContain('Todos')
    expect(render([person({ serviceIds: [] })])).toContain('Ninguno')
  })

  it('respeta el orden de sortOrder, no el de llegada', () => {
    const markup = render([
      person({ id: 'p-1', name: 'Zulema', sortOrder: 1 }),
      person({ id: 'p-2', name: 'Ana', sortOrder: 0 }),
    ])
    expect(markup.indexOf('Ana')).toBeLessThan(markup.indexOf('Zulema'))
  })
})
