import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), confirm: vi.fn(), reject: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/server/actions/bank-transfer-verify', () => ({
  confirmPackageTransfer: mocks.confirm, rejectPackageTransfer: mocks.reject,
}))

import { PendingPackageTransfers } from '@/components/packages/pending-package-transfers'

const item = {
  paymentId: 'pay1',
  purchaseId: 'purch1',
  customerName: 'Ana',
  productName: 'Pack 5 sesiones',
  amount: 50000,
}

describe('PendingPackageTransfers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.confirm.mockResolvedValue({ ok: true, data: { ok: true } })
    mocks.reject.mockResolvedValue({ ok: true, data: { ok: true } })
  })

  it('con un item: muestra clienta, producto, Confirmar y Rechazar', () => {
    const html = renderToStaticMarkup(<PendingPackageTransfers items={[item]} currency="CLP" />)
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('Confirmar')
    expect(html).toContain('Rechazar')
  })

  it('sin items: no renderiza nada', () => {
    const html = renderToStaticMarkup(<PendingPackageTransfers items={[]} currency="CLP" />)
    expect(html).not.toContain('por verificar')
  })

  it('pide confirmación accesible antes de rechazar y evita window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => root.render(<PendingPackageTransfers items={[item]} currency="CLP" />))
    const reject = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Rechazar')
    await act(async () => reject?.click())

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Rechazar transferencia')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Pack 5 sesiones quedará rechazada')
    expect(document.querySelector('[role="dialog"] button')?.className).toContain('min-h-11')

    await act(async () => root.unmount())
    host.remove()
    confirmSpy.mockRestore()
  })

  it('pide revisión explícita antes de confirmar el pago y no ejecuta al abrir o cancelar', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<PendingPackageTransfers items={[item]} currency="CLP" />))

    await act(async () => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Confirmar')?.click())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Confirmar transferencia')
    expect(dialog?.textContent).toContain('Ana')
    expect(dialog?.textContent).toContain('Pack 5 sesiones')
    expect(mocks.confirm).not.toHaveBeenCalled()

    await act(async () => Array.from(dialog?.querySelectorAll('button') ?? []).find((button) => button.textContent === 'Volver')?.click())
    expect(mocks.confirm).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    host.remove()
  })

  it('mantiene el diálogo abierto y muestra el error recuperable si el rechazo falla', async () => {
    mocks.reject.mockResolvedValueOnce({ ok: false, error: 'Esta compra ya fue procesada.' })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => root.render(<PendingPackageTransfers items={[item]} currency="CLP" />))
    await act(async () => Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Rechazar')?.click())
    const reject = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((button) => button.textContent === 'Rechazar transferencia')
    await act(async () => { reject?.click(); await Promise.resolve() })

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Esta compra ya fue procesada.')
    expect(mocks.refresh).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    host.remove()
  })
})
