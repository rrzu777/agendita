import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BankTransferForm } from '@/app/dashboard/settings/payments/bank-transfer-form'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/server/actions/bank-transfer-settings', () => ({
  saveBankTransferAccount: vi.fn(),
  setBankTransferEnabled: vi.fn(),
}))

const account = {
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
}

describe('BankTransferForm', () => {
  it('sin cuenta: muestra el form vacío con defaults y sin toggle', () => {
    const html = renderToStaticMarkup(<BankTransferForm account={null} />)
    expect(html).toContain('Titular')
    expect(html).toContain('value="24"')
    expect(html).toContain('value="48"')
    expect(html).not.toContain('Aceptar transferencias')
  })

  it('con cuenta: pre-carga los valores y muestra el toggle', () => {
    const html = renderToStaticMarkup(<BankTransferForm account={account} />)
    expect(html).toContain('María Pérez')
    expect(html).toContain('BancoEstado')
    expect(html).toContain('Aceptar transferencias')
  })

  it('con verifyHours null: el campo queda vacío y aparece la advertencia de sin límite', () => {
    const html = renderToStaticMarkup(<BankTransferForm account={{ ...account, verifyHours: null }} />)
    expect(html).toContain('sin límite')
  })
})
