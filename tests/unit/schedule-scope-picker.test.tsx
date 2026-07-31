import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScheduleScopePicker } from '@/components/dashboard/schedule-scope-picker'

// El selector es el único que conoce el contrato del `?persona=`: la página lo lee y
// resuelve el alcance con él. Un href mal armado no rompe nada visiblemente —cae en el
// salón, que es el default— y la pantalla queda mostrando el horario equivocado sin un
// solo error.

const equipo = [
  { id: 'juan', name: 'Juan' },
  { id: 'ana', name: 'Ana' },
]

function render(props: Partial<React.ComponentProps<typeof ScheduleScopePicker>> = {}) {
  return renderToStaticMarkup(
    <ScheduleScopePicker professionals={equipo} selectedId={null} professionalsLabel="Barberos" {...props} />,
  )
}

describe('ScheduleScopePicker', () => {
  it('el salón va sin parámetro y cada persona con su id', () => {
    const html = render()

    expect(html).toContain('href="/dashboard/availability"')
    expect(html).toContain('href="/dashboard/availability?persona=juan"')
    expect(html).toContain('href="/dashboard/availability?persona=ana"')
  })

  it('marca cuál está elegido', () => {
    expect(render({ selectedId: 'ana' })).toContain('aria-current="page"')
    expect(render({ selectedId: 'ana' }).match(/aria-current="page"/g)).toHaveLength(1)
  })

  // Un negocio sin equipo es el caso de hoy de casi todos: un selector con una sola
  // opción es ruido en la pantalla que ya tenían.
  it('no se dibuja si no hay a quién elegir', () => {
    expect(render({ professionals: [] })).toBe('')
  })
})
