import type { PropsWithChildren } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { renderWithVocabulary } from '../helpers/vocabulary'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/server/actions/bookings', () => ({
  cancelBooking: vi.fn(),
  createBookingFromDashboard: vi.fn(),
  searchManualPaymentBookings: vi.fn(),
}))
vi.mock('@/server/actions/payments', () => ({ createManualPayment: vi.fn() }))
vi.mock('@/server/actions/promotions', () => ({ previewPromotion: vi.fn() }))
vi.mock('@/server/actions/customers', () => ({ searchCustomersForBooking: vi.fn() }))
vi.mock('@/lib/packages/use-package-availability', () => ({
  usePackageAvailability: () => ({ remaining: 0, usePackage: false, setUsePackage: vi.fn() }),
}))
vi.mock('@/server/actions/bank-transfer-verify', () => ({
  confirmBankTransfer: vi.fn(),
  rejectBankTransfer: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTrigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
}))

import { NewBookingForm } from '@/app/dashboard/bookings/new/new-booking-form'
import { CancelBookingButton } from '@/components/dashboard/cancel-booking-button'
import { ManualPaymentDialog } from '@/components/dashboard/manual-payment-dialog'
import { ProfessionalField } from '@/components/dashboard/professional-field'
import { VerifyTransferDialog } from '@/components/dashboard/verify-transfer-dialog'

const NOW = new Date('2026-08-22T12:00:00Z')
const PAYABLE_BOOKING = {
  id: 'booking-1',
  bookingNumber: 3318,
  status: 'confirmed',
  depositPaid: 5000,
  depositRequired: 5000,
  finalAmount: 15000,
  remainingBalance: 10000,
  holdExpiresAt: null,
  paymentStatus: 'deposit_paid',
  service: { name: 'Manicura' },
  customer: { name: 'Ana', phone: '+56912345678' },
  payments: [],
}

describe('operational dashboard form system', () => {
  it('uses touch controls and semantic fields for critical payment dialogs', () => {
    const manual = renderWithVocabulary(
      'nails',
      <ManualPaymentDialog bookings={[PAYABLE_BOOKING as never]} now={NOW} open hideTrigger />,
    )
    const verify = renderWithVocabulary(
      'nails',
      <VerifyTransferDialog
        paymentId="payment-1"
        defaultAmount={5000}
        businessCurrency="CLP"
        open
        onOpenChange={() => {}}
      />,
    )

    for (const markup of [manual, verify]) {
      expect(markup).not.toContain('studio-input')
      expect(markup).toContain('data-density="touch"')
      expect(markup).toContain('data-slot="form-field"')
      expect(markup).toContain('data-size="touch"')
    }
    expect(manual.match(/data-slot="native-select"/g) ?? []).toHaveLength(2)
  })

  it('uses form controls and native select semantics in dashboard booking creation', () => {
    const markup = renderWithVocabulary(
      'nails',
      <NewBookingForm
        services={[]}
        professionals={[]}
        businessId="business-1"
        timezone="America/Santiago"
        currency="CLP"
      />,
    )

    expect(markup).not.toContain('studio-input')
    expect(markup.match(/data-density="form"/g) ?? []).toHaveLength(10)
    expect(markup.match(/data-slot="form-field"/g) ?? []).toHaveLength(10)
    expect(markup).toContain('data-slot="native-select"')
    expect(markup).toContain('data-size="form"')
  })

  it('keeps professional assignment native while using dashboard form density', () => {
    const markup = renderToStaticMarkup(
      <ProfessionalField
        choice={{
          kind: 'ask',
          options: [
            { id: 'professional-1', name: 'Ana', bio: null, modalities: ['on_site'], serviceIds: ['service-1'] },
            { id: 'professional-2', name: 'Vale', bio: null, modalities: ['on_site'], serviceIds: ['service-1'] },
          ],
        }}
        pick={{ kind: 'anyone' }}
        onChange={() => {}}
      />,
    )

    expect(markup).not.toContain('studio-input')
    expect(markup).toContain('data-slot="native-select"')
    expect(markup).toContain('data-density="form"')
  })

  it('uses a semantic form field in the cancellation dialog', () => {
    const markup = renderWithVocabulary(
      'nails',
      <CancelBookingButton bookingId="booking-1" open hideTrigger onOpenChange={() => {}} />,
    )

    expect(markup).not.toContain('studio-input')
    expect(markup).toContain('data-slot="form-field"')
    expect(markup).toContain('data-density="form"')
  })
})
