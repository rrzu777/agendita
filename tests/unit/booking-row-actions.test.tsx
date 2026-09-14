import { act, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'
import { BookingRowActions } from '@/components/dashboard/booking-row-actions'

const Actions = BookingRowActions as ComponentType<any>

// El reloj lo pone quien renderiza: estos componentes son cliente y salen en
// el HTML del servidor (ver `isManualPaymentAllowed`). Los plazos de los casos
// se arman contra ÉL — con `Date.now()` medirían contra otro reloj que el que
// recibe el componente, que es justo lo que este PR vino a impedir.
const NOW = new Date('2026-08-01T12:00:00Z')

describe('CancelBookingButton controlled mode', () => {
  it('renders no trigger button when hideTrigger is set', () => {
    const html = renderToStaticMarkup(
      <CancelBookingButton bookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
    )
    expect(html).not.toContain('Cancelar')
  })

  it('still renders the trigger by default', () => {
    const html = renderToStaticMarkup(<CancelBookingButton bookingId="b1" />)
    expect(html).toContain('Cancelar')
  })
})

const payableBooking = {
  id: 'b1',
  bookingNumber: 4738,
  status: 'confirmed',
  depositPaid: 15000,
  depositRequired: 15000,
  finalAmount: 45000,
  remainingBalance: 30000,
  service: { name: 'Manicura' },
  customer: { name: 'Ana' },
}

describe('ManualPaymentDialog controlled mode', () => {
  it('renders no trigger button when hideTrigger is set', () => {
    const html = renderToStaticMarkup(
      <ManualPaymentDialog bookings={[payableBooking as never]} now={NOW} defaultBookingId="b1" hideTrigger open={false} onOpenChange={() => {}} />,
    )
    expect(html).not.toContain('Registrar pago')
    expect(html).not.toContain('Cobrar')
  })
})

function rowBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', bookingNumber: 4738, status: 'confirmed',
    depositPaid: 15000, depositRequired: 15000, finalAmount: 45000,
    remainingBalance: 30000, service: { name: 'Manicura' }, customer: { name: 'Ana' },
    // Requeridos por ManualPaymentBooking. Sin esto el fixture no es una reserva
    // que la app produzca, y el guard del plazo no se ejercita nunca. El `as
    // never` de los callers apaga el chequeo del compilador, así que acá no hay
    // más red que acordarse: los dos campos los lee el MISMO guard.
    holdExpiresAt: null,
    paymentStatus: 'unpaid',
    ...overrides,
  }
}

function contactData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    customerName: 'Ana',
    customerPhone: '+56912345678',
    serviceName: 'Manicura',
    professionalName: 'Paula',
    startDateTime: new Date(NOW.getTime() + HORA).toISOString(),
    businessTimezone: 'America/Santiago',
    businessCurrency: 'CLP',
    totalPrice: 45000,
    depositPaid: 15000,
    remainingBalance: 30000,
    modality: 'on_site',
    businessAddress: 'Calle Uno 1',
    ...overrides,
  }
}

async function openActionsMenu(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Más acciones"]')
  expect(trigger).not.toBeNull()
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
  const menu = document.body.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]')
  expect(menu).not.toBeNull()
  return menu!
}

const HORA = 60 * 60 * 1000

describe('BookingRowActions', () => {
  it('shows Completar as primary + kebab for a confirmed booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking() as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Completar')
    expect(html).toContain('Más acciones')
  })

  it('shows Cobrar as primary for a pending_payment booking', () => {
    const html = renderToStaticMarkup(<BookingRowActions booking={rowBooking({ status: 'pending_payment' }) as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Cobrar')
  })

  it('keeps contact controls out of the fixed-width primary action area', () => {
    const html = renderToStaticMarkup(
      <Actions
        booking={rowBooking() as never}
        businessCurrency="CLP"
        contactData={contactData()}
        now={NOW}
      />,
    )

    expect(html).toContain('data-slot="table-actions-primary"')
    expect(html).not.toMatch(/data-slot="table-actions-primary"[^]*Contactar por WhatsApp/)
  })

  // OJO: buscar 'disabled' pelado no sirve — las clases de Tailwind traen
  // `disabled:opacity-50` en TODOS los botones. La propiedad real es `disabled=""`.
  it('con el plazo vivo el Cobrar sigue habilitado', () => {
    const booking = rowBooking({ status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() + HORA) })
    const html = renderToStaticMarkup(<BookingRowActions booking={booking as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Cobrar')
    expect(html).not.toContain('disabled=""')
  })

  it('con el plazo vencido retira Cobrar, explica por qué y conserva el overflow', () => {
    // El server rechaza este cobro (assertBookingPayable). La acción desaparece,
    // pero la fila explica la salida y mantiene las demás acciones en overflow.
    const booking = rowBooking({ status: 'pending_payment', holdExpiresAt: new Date(NOW.getTime() - HORA) })
    const html = renderToStaticMarkup(<BookingRowActions booking={booking as never} businessCurrency="CLP" now={NOW} />)
    expect(html).not.toContain('Cobrar')
    expect(html).toContain('Venció el plazo para pagar')
    expect(html).toContain('Revivir')
    expect(html).toContain('Más acciones')
  })

  it('con el plazo vencido pero el abono adentro, Cobrar sigue habilitado', () => {
    // El plazo vencido cierra el cobro porque el cron va a expirar la reserva.
    // Con plata adentro el cron la saltea, así que deshabilitar el botón la
    // dejaba sin salida: ni cobrar, ni el Expirada que habilita Revivir.
    const booking = rowBooking({
      status: 'pending_payment',
      holdExpiresAt: new Date(NOW.getTime() - HORA),
      paymentStatus: 'deposit_paid',
    })
    const html = renderToStaticMarkup(<BookingRowActions booking={booking as never} businessCurrency="CLP" now={NOW} />)
    expect(html).toContain('Cobrar')
    expect(html).not.toContain('disabled=""')
  })

  it('leaves a terminal booking with contact overflow but no primary action', () => {
    const html = renderToStaticMarkup(<Actions booking={rowBooking({ status: 'completed', remainingBalance: 0 }) as never} contactData={contactData()} businessCurrency="CLP" now={NOW} />)
    expect(html).not.toContain('Completar')
    expect(html).not.toContain('Cobrar')
    expect(html).toContain('Más acciones')
  })

  it('uses Revivir as the expired primary and keeps contact inside one overflow', () => {
    const html = renderToStaticMarkup(
      <Actions
        booking={rowBooking({ status: 'expired' }) as never}
        businessCurrency="CLP"
        contactData={contactData()}
        now={NOW}
      />,
    )

    expect(html).toContain('Revivir')
    expect(html).toContain('Más acciones')
    expect(html.match(/aria-label="Más acciones"/g)).toHaveLength(1)
  })

  it.each([
    ['confirmed', 'Completar', ['Contactar por WhatsApp', 'Enviar confirmación', 'Copiar confirmación', 'Enviar recordatorio', 'Copiar resumen', 'Copiar recordatorio', 'Reprogramar', 'Registrar pago', 'Cancelar']],
    ['pending_payment', 'Cobrar', ['Contactar por WhatsApp', 'Copiar resumen', 'Cancelar']],
    ['pending_confirmation', 'Aceptar', ['Contactar por WhatsApp', 'Copiar resumen', 'Rechazar']],
    ['expired', 'Revivir', ['Contactar por WhatsApp', 'Copiar resumen']],
    ['cancelled', null, ['Contactar por WhatsApp', 'Copiar resumen']],
    ['completed', null, ['Contactar por WhatsApp', 'Copiar resumen']],
    ['no_show', null, ['Contactar por WhatsApp', 'Copiar resumen']],
  ])('opens the real menu for %s with only truthful actions', async (status, primaryLabel, expectedItems) => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions
        booking={rowBooking({ status, remainingBalance: status === 'completed' ? 0 : 30000 })}
        businessCurrency="CLP"
        contactData={contactData()}
        transferEnabled
        now={NOW}
      />))
      const primary = container.querySelector('[data-slot="table-actions-primary"]')?.textContent ?? null
      expect(primary).toBe(primaryLabel)
      expect(container.querySelectorAll('button[aria-label="Más acciones"]')).toHaveLength(1)

      const menu = await openActionsMenu(container)
      for (const item of expectedItems) expect(menu.textContent).toContain(item)
      if (status !== 'confirmed') {
        expect(menu.textContent).not.toContain('Enviar confirmación')
        expect(menu.textContent).not.toContain('Enviar recordatorio')
        expect(menu.textContent).not.toContain('Copiar recordatorio')
      }
      if (['expired', 'cancelled', 'completed', 'no_show'].includes(status)) {
        expect(menu.textContent).not.toContain('Cancelar')
        expect(menu.textContent).not.toContain('Reprogramar')
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps confirmation but removes reminders after an effectively confirmed appointment starts', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions booking={rowBooking()} businessCurrency="CLP" contactData={contactData({ startDateTime: new Date(NOW.getTime() - HORA).toISOString() })} now={NOW} />))
      const menu = await openActionsMenu(container)
      expect(menu.textContent).toContain('Enviar confirmación')
      expect(menu.textContent).not.toContain('Enviar recordatorio')
      expect(menu.textContent).not.toContain('Copiar recordatorio')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('keeps successful clipboard feedback visible after the Radix menu closes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions booking={rowBooking()} businessCurrency="CLP" contactData={contactData()} now={NOW} />))
      const menu = await openActionsMenu(container)
      const copy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await Promise.resolve()
      })
      expect(writeText).toHaveBeenCalledOnce()
      expect(document.body.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull()
      expect(container.querySelector('[role="status"]')?.textContent).toContain('Resumen copiado')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('uses feminine confirmation feedback outside the closed menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions booking={rowBooking()} businessCurrency="CLP" contactData={contactData()} now={NOW} />))
      const menu = await openActionsMenu(container)
      const copy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar confirmación'))!
      await act(async () => {
        copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Confirmación copiada')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('shows a persistent clipboard error with a usable retry and never says Copiado', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions booking={rowBooking()} businessCurrency="CLP" contactData={contactData()} now={NOW} />))
      const menu = await openActionsMenu(container)
      const copy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await Promise.resolve()
      })
      const alert = container.querySelector('[role="alert"]')!
      expect(alert.textContent).toContain('No pudimos copiar el resumen')
      expect(alert.textContent).not.toContain('Copiado')
      const retry = [...alert.querySelectorAll('button')].find((button) => button.textContent === 'Reintentar')!
      expect(retry).toBeTruthy()
      await act(async () => {
        retry.click()
        await Promise.resolve()
      })
      expect(writeText).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Resumen copiado')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('retira un error de confirmación y su retry cuando cambia a un estado que ya no permite ese mensaje', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions booking={rowBooking()} businessCurrency="CLP" contactData={contactData()} now={NOW} />))
      const menu = await openActionsMenu(container)
      const copy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar confirmación'))!
      await act(async () => {
        copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await Promise.resolve()
      })
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reintentar')

      await act(async () => root.render(<Actions booking={rowBooking({ status: 'cancelled' })} businessCurrency="CLP" contactData={contactData()} now={NOW} />))
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.textContent).not.toContain('Reintentar')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('ignora el resultado tardío de clipboard cuando cambia la reserva de contacto', async () => {
    let resolveCopy!: () => void
    const writeText = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveCopy = resolve }))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Actions booking={rowBooking()} businessCurrency="CLP" contactData={contactData()} now={NOW} />))
      const menu = await openActionsMenu(container)
      const copy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        copy.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await Promise.resolve()
      })

      await act(async () => root.render(<Actions
        booking={rowBooking({ id: 'b2' })}
        businessCurrency="CLP"
        contactData={contactData({ id: 'b2', bookingNumber: 4739, customerName: 'Bea' })}
        now={NOW}
      />))
      await act(async () => {
        resolveCopy()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')).toBeNull()
      expect(container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('no revive un éxito asentado después de A → B → A y permite una copia nueva', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const renderBooking = async (id: 'a' | 'b') => act(async () => root.render(<Actions
      booking={rowBooking({ id })}
      businessCurrency="CLP"
      contactData={contactData({ id, bookingNumber: id === 'a' ? 4738 : 4739, customerName: id === 'a' ? 'Ana' : 'Bea' })}
      now={NOW}
    />))
    try {
      await renderBooking('a')
      let menu = await openActionsMenu(container)
      const firstCopy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        firstCopy.click()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Resumen copiado')

      await renderBooking('b')
      await renderBooking('a')
      expect(container.querySelector('[role="status"]')).toBeNull()

      menu = await openActionsMenu(container)
      const newCopy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar confirmación'))!
      await act(async () => {
        newCopy.click()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Confirmación copiada')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('no revive un error asentado después de A → B → A y permite una copia nueva', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('old denied')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const renderBooking = async (id: 'a' | 'b') => act(async () => root.render(<Actions
      booking={rowBooking({ id })}
      businessCurrency="CLP"
      contactData={contactData({ id, bookingNumber: id === 'a' ? 4738 : 4739, customerName: id === 'a' ? 'Ana' : 'Bea' })}
      now={NOW}
    />))
    try {
      await renderBooking('a')
      let menu = await openActionsMenu(container)
      const firstCopy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        firstCopy.click()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reintentar')

      await renderBooking('b')
      await renderBooking('a')
      expect(container.querySelector('[role="alert"]')).toBeNull()

      menu = await openActionsMenu(container)
      const newCopy = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        newCopy.click()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Resumen copiado')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('no deja que un resolve tardío de la primera A sobrescriba una copia nueva al volver a A', async () => {
    let resolveOld!: () => void
    const oldCopy = new Promise<void>((resolve) => { resolveOld = resolve })
    const writeText = vi.fn().mockReturnValueOnce(oldCopy).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const renderBooking = async (id: 'a' | 'b') => act(async () => root.render(<Actions
      booking={rowBooking({ id })}
      businessCurrency="CLP"
      contactData={contactData({ id, bookingNumber: id === 'a' ? 4738 : 4739, customerName: id === 'a' ? 'Ana' : 'Bea' })}
      now={NOW}
    />))
    try {
      await renderBooking('a')
      let menu = await openActionsMenu(container)
      const oldSummary = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        oldSummary.click()
        await Promise.resolve()
      })

      await renderBooking('b')
      await renderBooking('a')
      menu = await openActionsMenu(container)
      const newConfirmation = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar confirmación'))!
      await act(async () => {
        newConfirmation.click()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Confirmación copiada')

      await act(async () => {
        resolveOld()
        await oldCopy
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Confirmación copiada')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('no deja que un reject tardío de la primera A sobrescriba el retry nuevo al volver a A', async () => {
    let rejectOld!: (error: Error) => void
    const oldCopy = new Promise<void>((_resolve, reject) => { rejectOld = reject })
    const writeText = vi.fn()
      .mockReturnValueOnce(oldCopy)
      .mockRejectedValueOnce(new Error('current denied'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const renderBooking = async (id: 'a' | 'b') => act(async () => root.render(<Actions
      booking={rowBooking({ id })}
      businessCurrency="CLP"
      contactData={contactData({ id, bookingNumber: id === 'a' ? 4738 : 4739, customerName: id === 'a' ? 'Ana' : 'Bea' })}
      now={NOW}
    />))
    try {
      await renderBooking('a')
      let menu = await openActionsMenu(container)
      const oldSummary = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        oldSummary.click()
        await Promise.resolve()
      })

      await renderBooking('b')
      await renderBooking('a')
      menu = await openActionsMenu(container)
      const newSummary = [...menu.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')].find((item) => item.textContent?.includes('Copiar resumen'))!
      await act(async () => {
        newSummary.click()
        await Promise.resolve()
      })
      const retry = [...container.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find((button) => button.textContent === 'Reintentar')!
      await act(async () => {
        retry.click()
        await Promise.resolve()
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Resumen copiado')

      await act(async () => {
        rejectOld(new Error('old denied'))
        await oldCopy.catch(() => undefined)
      })
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Resumen copiado')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
