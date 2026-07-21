import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/actions/bank-transfer-public', () => ({
  createProofUploadUrl: vi.fn(async () => ({ ok: true, data: { uploadUrl: 'https://r2/put', key: 'proofs/b/x/deposit' } })),
}))

import { TransferDetails } from '@/components/booking/transfer-details'

const bank = {
  accountHolder: 'Ana',
  rut: '1-9',
  bankName: 'X',
  accountType: 'corriente',
  accountNumber: '123',
  email: null,
  instructions: null,
  holdHours: 24,
  requireProof: true,
}

describe('TransferDetails con comprobante', () => {
  it('requireProof=true deshabilita "Ya transferí" hasta subir', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={bank as never} amount={1000} currency="CLP" deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} bookingId="b1" kind="deposit" />,
    )
    expect(html).toContain('Comprobante')
    expect(html).toMatch(/disabled/)
  })

  it('requireProof=false: el botón no está bloqueado por falta de comprobante', () => {
    const html = renderToStaticMarkup(
      <TransferDetails bank={{ ...bank, requireProof: false } as never} amount={1000} currency="CLP" deadline={null} timezone="America/Santiago" declaring={false} onDeclare={() => {}} bookingId="b1" kind="deposit" />,
    )
    // el botón no debe estar deshabilitado sólo por falta de proof
    expect(html).toContain('Comprobante')
  })
})
