import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnsavedChangesProvider } from '@/components/dashboard/unsaved-changes-provider'
import { writeSettingsDraft } from '@/lib/business/settings-draft'
import type { ReservationSettingsInput } from '@/lib/business/schema'
import { ReservationSettingsForm } from '@/components/dashboard/settings/reservation-settings-form'

const { mockUpdate, mockVerifySettingsDraftBaseline } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockVerifySettingsDraftBaseline: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/server/actions/business-settings', () => ({ updateReservationSettings: mockUpdate }))
vi.mock('@/server/actions/settings-draft-verifier', () => ({ verifySettingsDraftBaseline: mockVerifySettingsDraftBaseline }))

const reservationValues: ReservationSettingsInput = {
  timezone: 'America/Santiago',
  slotStepMinutes: '30',
  manualHoldHours: 24,
  requireBookingApproval: false,
  defaultMeetingUrl: '',
}

function getControl(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll('label')).find((element) => element.textContent === label)
  const controlId = labelElement?.getAttribute('for')
  const control = controlId ? container.querySelector<HTMLElement>(`#${controlId}`) : null
  if (!control) throw new Error(`Control not found for ${label}`)
  return control
}

function getInput(container: HTMLElement, label: string) {
  const control = getControl(container, label)
  if (!(control instanceof HTMLInputElement)) throw new Error(`Input not found for ${label}`)
  return control
}

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve: (value: T) => resolve(value) }
}

async function setInput(container: HTMLElement, label: string, value: string) {
  const input = getInput(container, label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickControl(container: HTMLElement, label: string) {
  await act(async () => {
    getControl(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('Reservation form not found')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

describe('ReservationSettingsForm', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    mockUpdate.mockReset()
    mockVerifySettingsDraftBaseline.mockReset()
    mockVerifySettingsDraftBaseline.mockResolvedValue({ matches: true, current: reservationValues })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderReservations(overrides: Partial<ReservationSettingsInput> = {}) {
    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <ReservationSettingsForm businessId="biz-1" initialValues={{ ...reservationValues, ...overrides }} />
        </UnsavedChangesProvider>,
      )
    })
  }

  it('maps service duration and submits only reservation fields', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { ...reservationValues, slotStepMinutes: 'service', requireBookingApproval: true } })
    await renderReservations({ slotStepMinutes: 'service' })

    expect(getControl(container, 'Ofrecer horas de reserva').textContent).toContain('Según la duración')
    await clickControl(container, 'Confirmar cada reserva a mano')
    await submit(container)

    const payload = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({ ...reservationValues, slotStepMinutes: 'service', requireBookingApproval: true })
    expect(payload.businessId).toBeUndefined()
    expect(payload.selfServiceCutoffHours).toBeUndefined()
    expect(payload.cancellationPolicy).toBeUndefined()
    expect(payload.bookingPolicy).toBeUndefined()
    expect(payload.depositPolicy).toBeUndefined()
    expect(container.textContent).toContain('Cambios guardados')
  })

  it('uses the default hold when the manual hold is blank', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: reservationValues })
    await renderReservations()

    await setInput(container, 'Reserva sin pago online (horas)', '')
    await submit(container)

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ manualHoldHours: 24 }))
  })

  it('rejects unsafe meeting URLs before calling the action', async () => {
    await renderReservations()

    await setInput(container, 'Sala de videollamada', 'meet.google.com/abc-defg-hij')
    await submit(container)

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(container.querySelector('#reservation-meeting-url-error')?.textContent).toContain('https://')
  })

  it('replaces dirty values with the normalized response after save', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { ...reservationValues, defaultMeetingUrl: 'https://meet.google.com/abc-defg-hij' } })
    await renderReservations()

    await setInput(container, 'Sala de videollamada', 'https://meet.google.com/abc-defg-hij/')
    await submit(container)

    expect(getInput(container, 'Sala de videollamada').value).toBe('https://meet.google.com/abc-defg-hij')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

  it('locks edits and repeated submissions until the reservation update resolves', async () => {
    const pending = deferred<{ ok: true; data: ReservationSettingsInput }>()
    mockUpdate.mockReturnValue(pending.promise)
    await renderReservations()

    await setInput(container, 'Sala de videollamada', 'https://meet.google.com/abc-defg-hij')
    await submit(container)

    const meetingUrl = getInput(container, 'Sala de videollamada')
    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect(meetingUrl.matches(':disabled')).toBe(true)
    await submit(container)
    expect(mockUpdate).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve({ ok: true, data: { ...reservationValues, defaultMeetingUrl: 'https://meet.google.com/abc-defg-hij' } }))

    expect(container.querySelector('fieldset')?.disabled).toBe(false)
    expect(sessionStorage.getItem('biz-1:reservations')).toBeNull()
  })

  it('restores its own reservation draft without changing the saved baseline', async () => {
    writeSettingsDraft(sessionStorage, 'biz-1:reservations', 1, reservationValues, { ...reservationValues, manualHoldHours: 48 })
    await renderReservations()

    expect(container.textContent).toContain('Recuperamos un borrador local')
    expect(getInput(container, 'Reserva sin pago online (horas)').value).toBe('48')
  })

  it('associates only rendered help and validation errors with controls', async () => {
    await renderReservations()

    const meetingUrl = getInput(container, 'Sala de videollamada')
    expect(meetingUrl.getAttribute('aria-describedby')).toBe('reservation-meeting-url-help')

    await setInput(container, 'Sala de videollamada', 'meet.google.com/abc-defg-hij')
    await submit(container)

    expect(meetingUrl.getAttribute('aria-describedby')).toBe('reservation-meeting-url-help reservation-meeting-url-error')
    expect(container.querySelector('#reservation-meeting-url-error')?.getAttribute('role')).toBe('alert')
  })

  it('links manual hold explanation to payment settings without prefetching it', async () => {
    await renderReservations()

    const link = Array.from(container.querySelectorAll('a')).find((element) => element.textContent === 'Configurar pagos')
    expect(link?.getAttribute('href')).toBe('/dashboard/settings/payments')
  })
})
