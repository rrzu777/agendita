import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'
import { runIndependentRegistrationCleanup } from './helpers/registration-cleanup'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

const enabled = process.env.PLAYWRIGHT_REAL_REGISTRATION === 'true'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const emailDomain = process.env.PLAYWRIGHT_REGISTRATION_EMAIL_DOMAIN

test.describe('real Supabase registration', () => {
  test.skip(!enabled, 'Requires the disposable registration E2E environment')

  test('creates, confirms and signs into a real disposable Supabase account', async ({ page }) => {
    expect(supabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL is required').toBeTruthy()
    expect(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required').toBeTruthy()
    expect(emailDomain, 'PLAYWRIGHT_REGISTRATION_EMAIL_DOMAIN is required').toBeTruthy()

    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const email = `registration-${suffix}@${emailDomain}`
    const password = `Agendita-${crypto.randomUUID()}-Aa1!`

    try {
      await page.goto('/register')
      await page.getByLabel('Nombre').fill('Registro E2E descartable')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Contraseña').fill(password)
      await page.locator('select[name="category"]').selectOption('nails')
      await page.locator('input[name="useServiceTemplate"]').check()
      await page.locator('#accept-terms').check()
      await page.getByRole('button', { name: /crear cuenta/i }).click()

      await expect(page.getByRole('heading', { name: 'Verifica tu email' })).toBeVisible({ timeout: 20_000 })

      await expect.poll(async () => prisma.user.findUnique({
        where: { email },
        select: {
          businesses: {
            select: {
              role: true,
              business: {
                select: {
                  category: true,
                  services: { select: { id: true } },
                  availability: { select: { id: true } },
                  subscriptions: { select: { status: true } },
                },
              },
            },
          },
        },
      }), { timeout: 20_000 }).toMatchObject({
        businesses: [{
          role: 'owner',
          business: {
            category: 'nails',
            subscriptions: [{ status: 'trialing' }],
          },
        }],
      })

      const created = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: {
          id: true,
          businesses: { select: { business: { select: { services: true, availability: true } } } },
        },
      })
      expect(created.businesses[0]?.business.services.length).toBeGreaterThan(0)
      expect(created.businesses[0]?.business.availability.length).toBeGreaterThan(0)

      // This protected test project stands in for the email click. The gate then
      // proves the real password/session path; email delivery + PKCE callback are
      // intentionally tracked as a separate provider/mailbox journey.
      const admin = createAdminClient()
      const { data: confirmed, error: confirmationError } = await admin.auth.admin.updateUserById(
        created.id,
        { email_confirm: true },
      )
      expect(confirmationError, 'Disposable Supabase user must be confirmable').toBeNull()
      expect(confirmed.user?.email_confirmed_at).toBeTruthy()

      await page.goto('/login')
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Iniciar sesión' }).click()
      await page.waitForURL('**/dashboard/onboarding')
      await expect(page.getByRole('heading', { name: 'Configura tu negocio' })).toBeVisible()
      for (let step = 0; step < 4; step += 1) {
        await page.getByRole('button', { name: 'Siguiente' }).click()
      }
      await page.getByRole('button', { name: '¡Listo! Ir al dashboard' }).click()
      await page.waitForURL('**/dashboard')
      await expect(page.getByRole('heading', { name: /resumen de/i })).toBeVisible()
    } finally {
      await cleanupRegistration(email)
    }
  })
})

async function cleanupRegistration(email: string) {
  const databaseUser = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  const admin = createAdminClient()
  let authUserId = databaseUser?.id
  if (!authUserId) {
    let page = 1
    do {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      authUserId = data.users.find((user) => user.email === email)?.id
      if (authUserId || data.nextPage === null) break
      page = data.nextPage
    } while (true)
  }

  await runIndependentRegistrationCleanup({
    auth: async () => {
      if (!authUserId) return
      const { error } = await admin.auth.admin.deleteUser(authUserId)
      if (error) throw error
    },
    database: async () => {
      if (!databaseUser) return
      await prisma.$transaction([
        prisma.business.deleteMany({ where: { ownerUserId: databaseUser.id } }),
        prisma.user.deleteMany({ where: { id: databaseUser.id } }),
      ])
    },
  })
}

function createAdminClient() {
  return createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
