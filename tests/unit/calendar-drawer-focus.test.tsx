import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CalendarViews } from '@/components/dashboard/calendar-views'

vi.mock('@/components/dashboard/block-time-modal', () => ({ BlockTimeModal: () => null }))
vi.mock('@/components/dashboard/edit-block-dialog', () => ({ EditBlockDialog: () => null }))
vi.mock('@/components/dashboard/edit-series-occurrence-dialog', () => ({ EditSeriesOccurrenceDialog: () => null }))
vi.mock('@/components/dashboard/booking-drawer', () => ({ BookingDrawer: ({ onOpenChange, onCloseAutoFocus }: { onOpenChange: (open: boolean) => void; onCloseAutoFocus?: (event: Event) => void }) => <button onClick={() => { onOpenChange(false); onCloseAutoFocus?.(new Event('closeAutoFocus')) }}>Cerrar detalle</button> }))

it('returns keyboard focus to the appointment that opened the drawer', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<CalendarViews bookings={[{ id: 'b1', startDateTime: '2026-09-27T14:00:00Z', endDateTime: '2026-09-27T15:00:00Z', status: 'confirmed', paymentStatus: 'fully_paid', holdExpiresAt: null, payments: [], service: { name: 'Corte' }, customer: { name: 'Ana' }, professional: null } as never]} timeBlocks={[]} view="week" date="2026-09-27" now={new Date('2026-09-13T14:00:00Z')} timezone="America/Santiago" businessCurrency="CLP" businessAddress={null} professionals={[]} selectedProfessionalId={null} photoUploadEnabled={false} />))
    const trigger = container.querySelector('section[aria-label="Agenda de la semana"] button') as HTMLButtonElement
    trigger.focus()
    await act(async () => trigger.click())
    const close = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cerrar detalle')!
    close.focus()
    await act(async () => close.click())
    expect(document.activeElement).toBe(trigger)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
