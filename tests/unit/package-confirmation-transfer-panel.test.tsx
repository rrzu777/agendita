import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ declare: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/server/actions/packages-checkout', () => ({ declarePackageTransfer: mocks.declare }))
vi.mock('@/components/packages/package-transfer-instructions', () => ({
  PackageTransferInstructions: ({ onDeclare, declaring }: { onDeclare: () => void; declaring: boolean }) => (
    <button type="button" disabled={declaring} onClick={onDeclare}>Ya transferí</button>
  ),
}))

import { PackageTransferPanel } from '@/app/paquetes/confirmation/transfer-panel'

describe('PackageTransferPanel recovery', () => {
  beforeEach(() => vi.clearAllMocks())
  it('recovers from a rejected transport promise and announces a safe error', async () => {
    mocks.declare.mockRejectedValueOnce(new Error('provider secret'))
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<PackageTransferPanel transferInfo={{} as never} amount={1000} currency="CLP" purchaseId="p1" />))
    await act(async () => { host.querySelector('button')?.click(); await Promise.resolve() })
    expect(host.querySelector('button')?.disabled).toBe(false)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Intenta nuevamente')
    expect(host.textContent).not.toContain('provider secret')
    await act(async () => root.unmount())
  })
})
