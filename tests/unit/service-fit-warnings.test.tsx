import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServiceFitWarnings } from '@/components/dashboard/service-fit-warnings'
import { getVocabulary } from '@/lib/vocabulary'

const vocabulary = getVocabulary('nails')

const fitOk = {
  serviceId: 'svc-90',
  serviceName: 'ESMALTADO',
  durationMinutes: 90,
  daysWithSlots: ['2026-07-07'],
  fitsNowhere: false,
}

const fitNowhere = {
  serviceId: 'svc-225',
  serviceName: 'MANICURA RUSA HIGH LEVEL',
  durationMinutes: 225,
  daysWithSlots: [],
  fitsNowhere: true,
}

describe('ServiceFitWarnings', () => {
  it('no renderiza nada cuando todos los servicios caben', () => {
    const html = renderToStaticMarkup(<ServiceFitWarnings vocabulary={vocabulary} fits={[fitOk]} />)
    expect(html).toBe('')
  })

  it('muestra un aviso con nombre y duración por cada servicio que no cabe', () => {
    const html = renderToStaticMarkup(<ServiceFitWarnings vocabulary={vocabulary} fits={[fitOk, fitNowhere]} />)
    expect(html).toContain('MANICURA RUSA HIGH LEVEL')
    expect(html).toContain('225 min')
    expect(html).toContain('no cabe en ningún día')
    expect(html).toContain('Amplía un horario o ajusta tus bloqueos')
    expect(html).not.toContain('ESMALTADO')
  })

  /**
   * El aviso manda a arreglar algo, así que tiene que mandar al horario correcto: con
   * una persona elegida, "amplía un horario" arriba de SU semana manda a tocar el del
   * negocio, que no es el que la está dejando sin lugar.
   */
  it('con una persona elegida el aviso habla de su horario', () => {
    const html = renderToStaticMarkup(
      <ServiceFitWarnings vocabulary={vocabulary} fits={[fitNowhere]} scopeName="Ana" />,
    )
    expect(html).toContain('el horario y los bloqueos de Ana')
    expect(html).toContain('Amplía su horario')
    expect(html).not.toContain('tu horario')
  })

  it('muestra un aviso por cada servicio afectado', () => {
    const otro = { ...fitNowhere, serviceId: 'svc-300', serviceName: 'PEDICURA SPA', durationMinutes: 300 }
    const html = renderToStaticMarkup(<ServiceFitWarnings vocabulary={vocabulary} fits={[fitNowhere, otro]} />)
    expect(html).toContain('MANICURA RUSA HIGH LEVEL')
    expect(html).toContain('PEDICURA SPA')
    expect(html).toContain('300 min')
  })
})
