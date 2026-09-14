import { expect, test, type Page } from '@playwright/test'
import { prisma } from '@/lib/db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 834, height: 1112 },
  { width: 1440, height: 1000 },
] as const

const STATES = [
  { key: 'confirmed', status: 'confirmed', title: 'Reserva confirmada', action: 'Volver al perfil' },
  { key: 'success', status: 'completed', title: 'Gracias por tu visita', action: 'Volver al perfil' },
  { key: 'verifying', status: 'pending_payment', title: 'Verificando tu pago', action: 'Volver al perfil', paymentStatus: 'pending' },
  { key: 'rejected', status: 'pending_payment', title: 'Pago no aprobado', action: 'Intentar de nuevo', paymentStatus: 'rejected' },
  { key: 'pending', status: 'pending_payment', title: 'Reserva pendiente de pago', action: 'Volver al perfil' },
  { key: 'expired', status: 'expired', title: 'Tu reserva expiró', action: 'Reservar de nuevo' },
  { key: 'cancelled', status: 'cancelled', title: 'Reserva cancelada', action: 'Volver al perfil' },
] as const

const fixture = {
  businessId: '',
  serviceId: '',
  customerId: '',
  bookingIds: new Map<string, string>(),
}

test.describe.configure({ mode: 'serial' })

async function expectKeyboardFocus(page: Page) {
  await page.keyboard.press('Tab')
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return false
    const box = active.getBoundingClientRect()
    return ['A', 'BUTTON'].includes(active.tagName)
      && active.matches(':focus-visible')
      && box.width > 0
      && box.height > 0
  })).toBe(true)
}

test.describe('confirmación pública con estados reales de PostgreSQL', () => {
  test.beforeAll(async () => {
    const suffix = `${process.pid}-${Date.now()}`
    const business = await prisma.business.create({
      data: {
        name: 'Estudio E2E',
        slug: `confirmation-${suffix}`,
        subdomain: `confirmation-${suffix}`,
        ownerUserId: `owner-${suffix}`,
        city: 'Santiago',
        category: 'barber',
        visualStyle: 'contrast',
        brandColor: '#35524A',
        timezone: 'America/Santiago',
      },
    })
    fixture.businessId = business.id

    const service = await prisma.service.create({
      data: {
        businessId: business.id,
        name: 'Corte de prueba',
        durationMinutes: 30,
        price: 12_000,
        depositAmount: 0,
        pastelColor: '#DFE3E2',
      },
    })
    fixture.serviceId = service.id

    const customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        name: 'Cliente E2E',
        phone: `+569${String(Date.now()).slice(-8)}`,
      },
    })
    fixture.customerId = customer.id

    for (const [index, state] of STATES.entries()) {
      const startDateTime = new Date(Date.now() + (index + 10) * 86_400_000)
      const booking = await prisma.booking.create({
        data: {
          businessId: business.id,
          serviceId: service.id,
          customerId: customer.id,
          startDateTime,
          endDateTime: new Date(startDateTime.getTime() + 30 * 60_000),
          status: state.status,
          totalPrice: 12_000,
          finalAmount: 12_000,
          depositRequired: 0,
          depositPaid: 0,
          remainingBalance: state.status === 'completed' ? 0 : 12_000,
          paymentStatus: state.status === 'completed' ? 'fully_paid' : 'unpaid',
          holdExpiresAt: state.status === 'pending_payment' ? new Date(Date.now() + 3_600_000) : null,
          cancellationCutoffHours: 24,
          bookingNumber: 9_000 + index,
        },
      })
      fixture.bookingIds.set(state.key, booking.id)

      if ('paymentStatus' in state) {
        await prisma.payment.create({
          data: {
            businessId: business.id,
            bookingId: booking.id,
            customerId: customer.id,
            provider: 'mercado_pago',
            providerPaymentId: `e2e-${state.key}-${suffix}`,
            providerEnvironment: 'sandbox',
            amount: 12_000,
            status: state.paymentStatus,
            paymentType: 'deposit',
          },
        })
      }
    }
  })

  test.afterAll(async () => {
    if (!fixture.businessId) return
    await prisma.payment.deleteMany({ where: { businessId: fixture.businessId } })
    await prisma.booking.deleteMany({ where: { businessId: fixture.businessId } })
    await prisma.customer.deleteMany({ where: { businessId: fixture.businessId } })
    await prisma.service.deleteMany({ where: { businessId: fixture.businessId } })
    await prisma.business.deleteMany({ where: { id: fixture.businessId } })
  })

  for (const viewport of VIEWPORTS) {
    test(`renderiza estados, recuperación y foco a ${viewport.width}px`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize(viewport)

      for (const state of STATES) {
        const bookingId = fixture.bookingIds.get(state.key)
        expect(bookingId).toBeTruthy()
        await page.goto(`/book/confirmation?bookingId=${bookingId}`)

        await expect(page.getByRole('heading', { level: 1, name: state.title })).toBeVisible()
        await expect(page.getByText('Estudio E2E', { exact: true })).toBeVisible()
        await expect(page.getByText('Paso 6 de 6', { exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: state.action, exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => (
          document.documentElement.scrollWidth <= window.innerWidth
          && document.body.scrollWidth <= window.innerWidth
        ))).toBe(true)
        await expectKeyboardFocus(page)
      }
    })
  }
})
