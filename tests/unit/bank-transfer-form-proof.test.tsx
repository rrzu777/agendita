import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BankTransferForm } from '@/app/dashboard/settings/payments/bank-transfer-form'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/server/actions/bank-transfer-settings', () => ({
  saveBankTransferAccount: vi.fn(),
  setBankTransferEnabled: vi.fn(),
  setRequireTransferProof: vi.fn(),
}))

// Satisface el tipo Prisma completo (la prop del form es BankTransferAccount | null).
const account = {
  id: 'btp-form-1',
  businessId: 'btp-form-biz',
  accountHolder: 'María Pérez',
  rut: '12.345.678-9',
  bankName: 'BancoEstado',
  accountType: 'vista',
  accountNumber: '12345678',
  email: 'maria@ejemplo.cl',
  instructions: null,
  isEnabled: true,
  holdHours: 24,
  verifyHours: 48,
  createdAt: new Date('2026-07-10T00:00:00Z'),
  updatedAt: new Date('2026-07-10T00:00:00Z'),
}

describe('BankTransferForm — gate de comprobante', () => {
  it('con R2 disponible: muestra el control "Exigir comprobante"', () => {
    const html = renderToStaticMarkup(
      <BankTransferForm account={account} proofUploadAvailable={true} requireProof={false} />,
    )
    expect(html).toContain('Exigir comprobante')
  })

  it('sin R2 disponible: NO muestra el control "Exigir comprobante"', () => {
    const html = renderToStaticMarkup(
      <BankTransferForm account={account} proofUploadAvailable={false} requireProof={false} />,
    )
    expect(html).not.toContain('Exigir comprobante')
  })
})
