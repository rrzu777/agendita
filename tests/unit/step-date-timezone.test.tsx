import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { formatInTimeZone } from 'date-fns-tz'
import { StepDate } from '@/components/booking/step-date'
import type { BookingData } from '@/components/booking/wizard'

const data = { date: null, serviceName: 'Esmaltado', serviceDuration: 90 } as unknown as BookingData

describe('StepDate timezone', () => {
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    document.body.replaceChildren()
  })

  it('emits the business-local noon instant for the clicked day', async () => {
    const onSelect = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<StepDate data={data} timezone="Asia/Tokyo" onSelect={onSelect} onBack={() => {}} />)
    })

    // Click en un día futuro habilitado (el último habilitado del mes visible)
    const dayButtons = Array.from(container.querySelectorAll('button[data-day]')).filter(b => !(b as HTMLButtonElement).disabled)
    expect(dayButtons.length).toBeGreaterThan(0)
    const target = dayButtons[dayButtons.length - 1] as HTMLButtonElement
    const dayStr = target.getAttribute('data-day')!
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const continueBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Continuar'))!
    act(() => {
      continueBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    const emitted: Date = onSelect.mock.calls[0][0]
    // El instante emitido debe ser exactamente el mediodía de ese día EN TOKIO
    expect(formatInTimeZone(emitted, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')).toBe(`${dayStr} 12:00`)
  })

  it('disables days that are already past in the business timezone', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<StepDate data={data} timezone="Asia/Tokyo" onSelect={() => {}} onBack={() => {}} />)
    })

    const businessToday = formatInTimeZone(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')
    const dayButtons = Array.from(container.querySelectorAll('button[data-day]')) as HTMLButtonElement[]
    for (const btn of dayButtons) {
      const dayStr = btn.getAttribute('data-day')!
      if (dayStr < businessToday) {
        expect(btn.disabled).toBe(true)
      } else {
        expect(btn.disabled).toBe(false)
      }
    }
  })
})
