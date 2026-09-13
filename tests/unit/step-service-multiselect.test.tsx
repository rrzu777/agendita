import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Service } from '@prisma/client'
import type { BookingData } from '@/components/booking/wizard'
import { StepService } from '@/components/booking/step-service'
import { wizardServiceFields } from '@/lib/bookings/wizard-selection'
import { clickButton } from '../helpers/react-dom'
const services = [
  { id: 'cut', name: 'Corte', price: 15000, depositAmount: 5000, durationMinutes: 45, isActive: true, modalities: ['on_site'], pastelColor: '#ffffff' },
  { id: 'nose', name: 'Nasal', price: 4000, depositAmount: 1000, durationMinutes: 20, isActive: true, modalities: ['on_site'], pastelColor: '#ffffff' },
] as Service[]
let root: Root
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren() })
describe('public service cart', () => {
  it('does not offer service controls before hydration can handle their clicks', () => {
    const data = { ...wizardServiceFields([], services), serviceModality: null } as BookingData
    const html = renderToStaticMarkup(<StepService data={data} services={services} currency="CLP" onSelect={() => {}} onContinue={() => {}} />)
    expect(html.match(/disabled=""/g)).toHaveLength(services.length)
  })

  it('toggles two services in place, updates totals and requires explicit continue', async () => {
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    const next = vi.fn()
    function Harness() {
      const [data, setData] = useState({ ...wizardServiceFields([], services), serviceModality: null } as BookingData)
      return <StepService data={data} services={services} currency="CLP" onSelect={partial => setData(prev => ({ ...prev, ...partial }))} onContinue={next} />
    }
    act(() => root.render(<Harness />))
    await clickButton(host, 'Corte', { match: 'contains' }); await clickButton(host, 'Nasal', { match: 'contains' })
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2)
    expect(host.textContent).toContain('19.000')
    expect(host.textContent).toContain('1 h 5 min')
    expect(next).not.toHaveBeenCalled()
    await clickButton(host, 'Corte', { match: 'contains' })
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    await clickButton(host, 'Continuar', { match: 'contains' })
    expect(next).toHaveBeenCalledTimes(1)
  })
})
