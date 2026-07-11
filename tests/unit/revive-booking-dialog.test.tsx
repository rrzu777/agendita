import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
// El diálogo importa la action ('use server' → prisma/auth): mockearla para
// que el import del test no arrastre infraestructura de servidor.
vi.mock('@/server/actions/revive-booking', () => ({ reviveBooking: vi.fn() }))
// Radix Dialog renderiza su contenido en un Portal que no se monta en SSR
// (useLayoutEffect nunca corre con renderToStaticMarkup), así que el HTML de
// DialogContent queda vacío sin importar `open`. Igual que otros tests de
// diálogos del repo (ver AGENTS notes), se stubea el primitive para poder
// aserar el contenido directamente cuando `open` es true.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import { ReviveBookingDialog } from '@/components/dashboard/revive-booking-dialog'

const base = {
  bookingId: 'b1',
  serviceName: 'Corte',
  customerName: 'Ana',
  customerHasEmail: true,
  open: true,
  onOpenChange: () => {},
}

describe('ReviveBookingDialog', () => {
  it('con reopen habilitado muestra las dos salidas', () => {
    const html = renderToStaticMarkup(
      <ReviveBookingDialog {...base} canReopen={true} reopenDisabledReason={null} />,
    )
    expect(html).toContain('Confirmar reserva')
    expect(html).toContain('Dar nuevo plazo')
  })
  it('con reopen deshabilitado muestra la razón', () => {
    const html = renderToStaticMarkup(
      <ReviveBookingDialog {...base} canReopen={false} reopenDisabledReason="El turno ya pasó" />,
    )
    expect(html).toContain('El turno ya pasó')
  })
  it('sin email de clienta muestra el aviso de WhatsApp', () => {
    const html = renderToStaticMarkup(
      <ReviveBookingDialog {...base} customerHasEmail={false} canReopen={true} reopenDisabledReason={null} />,
    )
    expect(html).toContain('WhatsApp')
  })
})
