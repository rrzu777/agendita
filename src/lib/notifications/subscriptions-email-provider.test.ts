import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendBatch = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn(function (this: { batch: { send: typeof sendBatch } }) {
    this.batch = { send: sendBatch }
  }),
}))
vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { sendSubscriptionEmail } = await import('./email-provider')

describe('sendSubscriptionEmail', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@example.test>')
    sendBatch.mockReset()
  })

  it('uses the Resend SDK idempotency option, not a recipient-visible email header', async () => {
    sendBatch.mockResolvedValue({ data: [], error: null })

    await expect(sendSubscriptionEmail({
      to: ['owner-a@example.test', 'owner-b@example.test'],
      subject: 'Aviso de suscripción',
      html: '<p>Seguro</p>',
      text: 'Seguro',
      idempotencyKey: 'subscription-safe:subscription_due_7_days:2026-08-18T12:00:00.000Z',
    })).resolves.toEqual({ success: true })

    expect(sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({ to: 'owner-a@example.test' }),
      expect.objectContaining({ to: 'owner-b@example.test' }),
    ], {
      idempotencyKey: 'subscription-safe:subscription_due_7_days:2026-08-18T12:00:00.000Z',
    })
  })
})
