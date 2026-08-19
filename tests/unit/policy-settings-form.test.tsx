import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnsavedChangesProvider } from '@/components/dashboard/unsaved-changes-provider'
import { writeSettingsDraft } from '@/lib/business/settings-draft'
import type { PolicySettingsInput } from '@/lib/business/schema'
import { PolicySettingsForm } from '@/components/dashboard/settings/policy-settings-form'

const { mockUpdate, mockVerifySettingsDraftBaseline } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockVerifySettingsDraftBaseline: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/server/actions/business-settings', () => ({ updatePolicySettings: mockUpdate }))
vi.mock('@/server/actions/settings-draft-verifier', () => ({ verifySettingsDraftBaseline: mockVerifySettingsDraftBaseline }))

const policyValues: PolicySettingsInput = {
  selfServiceCutoffHours: 24,
  cancellationReminderEnabled: true,
  cancellationPolicy: '',
  bookingPolicy: '',
  depositPolicy: '',
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

function getTextarea(container: HTMLElement, label: string) {
  const control = getControl(container, label)
  if (!(control instanceof HTMLTextAreaElement)) throw new Error(`Textarea not found for ${label}`)
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

async function setTextarea(container: HTMLElement, label: string, value: string) {
  const textarea = getTextarea(container, label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickControl(container: HTMLElement, label: string) {
  await act(async () => {
    getControl(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('Policy form not found')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

describe('PolicySettingsForm', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    mockUpdate.mockReset()
    mockVerifySettingsDraftBaseline.mockReset()
    mockVerifySettingsDraftBaseline.mockResolvedValue({ matches: true, current: policyValues })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderPolicies(overrides: Partial<PolicySettingsInput> = {}) {
    await act(async () => {
      root.render(
        <UnsavedChangesProvider>
          <PolicySettingsForm businessId="biz-1" initialValues={{ ...policyValues, ...overrides }} />
        </UnsavedChangesProvider>,
      )
    })
  }

  it('keeps the cancellation cutoff immediately before its dependent push switch', async () => {
    await renderPolicies()

    const cutoff = getInput(container, 'Ventana de autogestión (horas)')
    const push = getControl(container, 'Avisar antes del límite de cancelación')

    expect(cutoff.compareDocumentPosition(push) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the three visible policy fields after cancellation controls', async () => {
    await renderPolicies()

    const cutoff = getInput(container, 'Ventana de autogestión (horas)')
    const cancellation = getTextarea(container, 'Condiciones adicionales')
    const booking = getTextarea(container, 'Política de reserva')
    const deposit = getTextarea(container, 'Política de abono')

    expect(cutoff.compareDocumentPosition(cancellation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cancellation.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(booking.compareDocumentPosition(deposit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('submits policies without reservation or profile fields', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { ...policyValues, bookingPolicy: 'Con cita previa' } })
    await renderPolicies()

    await setTextarea(container, 'Política de reserva', 'Con cita previa')
    await submit(container)

    const payload = mockUpdate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toEqual({ ...policyValues, bookingPolicy: 'Con cita previa' })
    expect(payload.businessId).toBeUndefined()
    expect(payload.timezone).toBeUndefined()
    expect(payload.name).toBeUndefined()
  })

  it('preserves a zero cutoff and disabled reminder in the scoped payload', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { ...policyValues, selfServiceCutoffHours: 0, cancellationReminderEnabled: false } })
    await renderPolicies({ selfServiceCutoffHours: 0, cancellationReminderEnabled: false })

    await setTextarea(container, 'Condiciones adicionales', 'Sin cambios')
    await submit(container)

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      selfServiceCutoffHours: 0,
      cancellationReminderEnabled: false,
    }))
  })

  it('uses the default cutoff when the field is blank', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: policyValues })
    await renderPolicies()

    await setInput(container, 'Ventana de autogestión (horas)', '')
    await submit(container)

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ selfServiceCutoffHours: 24 }))
  })

  it('resets every policy textarea from normalized empty response values', async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: policyValues })
    await renderPolicies()

    await setTextarea(container, 'Condiciones adicionales', 'Cancelar con 48 horas')
    await setTextarea(container, 'Política de reserva', 'Sólo con cita')
    await setTextarea(container, 'Política de abono', 'Abono no reembolsable')
    await submit(container)

    expect(getTextarea(container, 'Condiciones adicionales').value).toBe('')
    expect(getTextarea(container, 'Política de reserva').value).toBe('')
    expect(getTextarea(container, 'Política de abono').value).toBe('')
  })

  it('locks edits and repeated submissions until the policy update resolves', async () => {
    const pending = deferred<{ ok: true; data: PolicySettingsInput }>()
    mockUpdate.mockReturnValue(pending.promise)
    await renderPolicies()

    await clickControl(container, 'Avisar antes del límite de cancelación')
    await submit(container)

    expect(container.querySelector('fieldset')?.disabled).toBe(true)
    expect(getTextarea(container, 'Política de reserva').matches(':disabled')).toBe(true)
    await submit(container)
    expect(mockUpdate).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve({ ok: true, data: { ...policyValues, cancellationReminderEnabled: false } }))

    expect(container.querySelector('fieldset')?.disabled).toBe(false)
    expect(sessionStorage.getItem('biz-1:policies')).toBeNull()
  })

  it('restores its policy draft without changing the saved baseline', async () => {
    writeSettingsDraft(sessionStorage, 'biz-1:policies', 1, policyValues, { ...policyValues, depositPolicy: 'Sólo transferencia' })
    await renderPolicies()

    expect(container.textContent).toContain('Recuperamos un borrador local')
    expect(getTextarea(container, 'Política de abono').value).toBe('Sólo transferencia')
  })

  it('associates rendered cutoff help with its control', async () => {
    await renderPolicies()

    expect(getInput(container, 'Ventana de autogestión (horas)').getAttribute('aria-describedby')).toBe('policy-cutoff-help')
  })
})
