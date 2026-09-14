import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CalendarViews } from '@/components/dashboard/calendar-views'

vi.mock('@/components/dashboard/block-time-modal', () => ({ BlockTimeModal: () => null }))
vi.mock('@/components/dashboard/edit-block-dialog', () => ({ EditBlockDialog: ({ onOpenChange, onCloseAutoFocus }: { onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) => <button onClick={() => { onOpenChange(false); onCloseAutoFocus?.(new Event('closeAutoFocus')) }}>Cerrar bloqueo</button> }))
vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))
vi.mock('@/components/dashboard/booking-drawer', () => ({ BookingDrawer: ({ onOpenChange, onCloseAutoFocus }: { onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) => <button onClick={() => { onOpenChange(false); onCloseAutoFocus?.(new Event('closeAutoFocus')) }}>Cerrar detalle</button> }))

it('returns keyboard focus to long and brief appointment controls that opened the drawer', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<CalendarViews bookings={[
      { id: 'long', startDateTime: '2026-09-27T14:00:00Z', endDateTime: '2026-09-27T15:00:00Z', status: 'confirmed', paymentStatus: 'fully_paid', holdExpiresAt: null, payments: [], service: { name: 'Corte' }, customer: { name: 'Ana' }, professional: null },
      { id: 'brief', startDateTime: '2026-09-27T15:30:00Z', endDateTime: '2026-09-27T15:35:00Z', status: 'confirmed', paymentStatus: 'fully_paid', holdExpiresAt: null, payments: [], service: { name: 'Barba' }, customer: { name: 'Beto' }, professional: null },
    ] as never[]} timeBlocks={[
      { id: 'brief-block', startDateTime: '2026-09-27T16:00:00Z', endDateTime: '2026-09-27T16:05:00Z', reason: 'Limpieza', professionalName: null },
    ]} view="day" date="2026-09-27" now={new Date('2026-09-13T14:00:00Z')} timezone="America/Santiago" businessCurrency="CLP" businessAddress={null} professionals={[]} selectedProfessionalId={null} photoUploadEnabled={false} />))

    const triggers = [
      container.querySelector<HTMLButtonElement>('[data-booking-id="long"]')!,
      container.querySelector<HTMLButtonElement>('[data-slot="brief-calendar-events"] button')!,
    ]
    for (const trigger of triggers) {
      expect(trigger.tagName).toBe('BUTTON')
      trigger.focus()
      await act(async () => trigger.click())
      const close = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cerrar detalle')!
      close.focus()
      await act(async () => close.click())
      expect(document.activeElement).toBe(trigger)
    }

    const blockTrigger = [...container.querySelectorAll<HTMLButtonElement>('[data-slot="brief-calendar-events"] button')]
      .find((button) => button.getAttribute('aria-label')?.includes('Limpieza'))!
    blockTrigger.focus()
    await act(async () => blockTrigger.click())
    const closeBlock = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cerrar bloqueo')!
    closeBlock.focus()
    await act(async () => closeBlock.click())
    expect(document.activeElement).toBe(blockTrigger)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('returns focus to each visible segment of an appointment that crosses midnight', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<CalendarViews bookings={[
      { id: 'overnight', startDateTime: '2026-07-01T03:55:00Z', endDateTime: '2026-07-01T04:10:00Z', status: 'confirmed', paymentStatus: 'fully_paid', holdExpiresAt: null, payments: [], service: { name: 'Tratamiento nocturno' }, customer: { name: 'Ana' }, professional: null },
    ] as never[]} timeBlocks={[]} view="week" date="2026-06-30" now={new Date('2026-06-29T14:00:00Z')} timezone="America/Santiago" businessCurrency="CLP" businessAddress={null} professionals={[]} selectedProfessionalId={null} photoUploadEnabled={false} />))

    const triggers = ['2026-06-30', '2026-07-01'].map((day) =>
      container.querySelector<HTMLButtonElement>(`[data-slot="brief-calendar-events"] [data-calendar-day="${day}"] button[aria-label*="Tratamiento nocturno"]`),
    )
    expect(triggers.every(Boolean)).toBe(true)

    for (const trigger of triggers) {
      trigger!.focus()
      await act(async () => trigger!.click())
      const close = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cerrar detalle')!
      close.focus()
      await act(async () => close.click())
      expect(document.activeElement).toBe(trigger)
    }
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
