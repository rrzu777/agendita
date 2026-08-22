import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BookingData } from '@/components/booking/wizard'

vi.mock('next/navigation', () => ({
  unstable_rethrow: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/auth/actions', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
}))

const bookingData: BookingData = {
  serviceId: 'service-1',
  serviceName: 'Manicure',
  servicePrice: 20000,
  serviceDuration: 60,
  serviceDeposit: 0,
  serviceColor: '',
  serviceModalities: ['on_site'],
  serviceModality: 'on_site',
  serviceAddress: '',
  date: null,
  timeSlot: null,
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  professional: { kind: 'none' },
  professionalName: '',
  customerNotes: '',
  idempotencyKey: null,
}

function count(markup: string, pattern: RegExp) {
  return markup.match(pattern)?.length ?? 0
}

describe('auth and public form system', () => {
  it('uses touch-density semantic fields on every authentication form', async () => {
    const { default: LoginPage } = await import('@/app/login/page')
    const { default: RegisterPage } = await import('@/app/register/page')
    const { default: ForgotPasswordPage } = await import('@/app/forgot-password/page')
    const { default: ResetPasswordPage } = await import('@/app/reset-password/page')

    const pages = [
      { markup: renderToStaticMarkup(<LoginPage />), controls: 2 },
      { markup: renderToStaticMarkup(<RegisterPage />), controls: 4 },
      { markup: renderToStaticMarkup(<ForgotPasswordPage />), controls: 1 },
      { markup: renderToStaticMarkup(<ResetPasswordPage />), controls: 1 },
    ]

    for (const page of pages) {
      expect(count(page.markup, /data-slot="form-field"/g)).toBe(page.controls)
      expect(count(page.markup, /data-density="touch"/g)).toBe(page.controls)
      expect(page.markup).not.toContain('studio-input')
    }
    expect(pages[1].markup).toContain('data-slot="native-select"')
  })

  it('uses touch-density labels and descriptions in the public customer step', async () => {
    const { StepCustomer } = await import('@/components/booking/step-customer')
    const markup = renderToStaticMarkup(
      <StepCustomer data={bookingData} sessionEmail={null} onLoginCta={vi.fn()} onSubmit={vi.fn()} onBack={vi.fn()} />,
    )

    expect(count(markup, /data-slot="form-field"/g)).toBe(5)
    expect(count(markup, /data-density="touch"/g)).toBe(5)
    expect(markup).not.toContain('studio-input')
    expect(markup).toContain('type="submit"')
    expect(markup).toContain('data-size="touch"')
  })
})
