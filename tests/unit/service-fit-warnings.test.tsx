import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServiceFitWarnings } from '@/components/dashboard/service-fit-warnings'

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
    const html = renderToStaticMarkup(<ServiceFitWarnings fits={[fitOk]} />)
    expect(html).toBe('')
  })

  it('muestra un aviso con nombre y duración por cada servicio que no cabe', () => {
    const html = renderToStaticMarkup(<ServiceFitWarnings fits={[fitOk, fitNowhere]} />)
    expect(html).toContain('MANICURA RUSA HIGH LEVEL')
    expect(html).toContain('225 min')
    expect(html).toContain('no cabe en ningún día')
    expect(html).toContain('Amplía un horario o ajusta tus bloqueos')
    expect(html).not.toContain('ESMALTADO')
  })

  it('muestra un aviso por cada servicio afectado', () => {
    const otro = { ...fitNowhere, serviceId: 'svc-300', serviceName: 'PEDICURA SPA', durationMinutes: 300 }
    const html = renderToStaticMarkup(<ServiceFitWarnings fits={[fitNowhere, otro]} />)
    expect(html).toContain('MANICURA RUSA HIGH LEVEL')
    expect(html).toContain('PEDICURA SPA')
    expect(html).toContain('300 min')
  })
})
