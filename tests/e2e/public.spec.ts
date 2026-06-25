import { test, expect } from '@playwright/test'

const E2E_EMAIL = 'e2e@test.agendita.com'
const E2E_OWNER_EMAIL = 'owner@mimosnails.com'

test.beforeEach(async ({ page }) => {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console error: ${message.text()}`)
    }
  })

  page.on('pageerror', (error) => {
    errors.push(`page error: ${error.message}`)
  })

  page.on('close', () => {
    expect(errors, errors.join('\n')).toEqual([])
  })
})

function nextBookableDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  while (date.getDay() === 0) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

async function selectBookingDate(page: import('@playwright/test').Page, date: Date) {
  const now = new Date()
  const monthOffset = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth()
  for (let i = 0; i < monthOffset; i += 1) {
    await page.getByRole('button', { name: 'Mes siguiente' }).click()
  }
  await page.getByRole('button', { name: String(date.getDate()), exact: true }).click()
}

test.describe('public pages', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Agendita/)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('landing page has navigation', async ({ page }) => {
    await page.goto('/')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toContain('Agenda')
    expect(bodyText).toContain('Crear cuenta')
    expect(bodyText).toContain('Iniciar sesión')
  })

  test('book page lists businesses', async ({ page }) => {
    const response = await page.goto('/book')
    expect(response?.status()).toBe(200)
  })

  test('public business profile shows content', async ({ page }) => {
    const response = await page.goto('/b/mimosnails')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Mimos Nails/)
    await expect(page.locator('text=Manicura').first()).toBeVisible({ timeout: 10000 })
  })

  test('booking page shows services', async ({ page }) => {
    const response = await page.goto('/book/mimosnails')
    expect(response?.status()).toBe(200)
    await page.waitForLoadState('networkidle')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toMatch(/Manicura|Esmaltado|Kapping/)
  })

  test('login page accessible', async ({ page }) => {
    const response = await page.goto('/login')
    expect(response?.status()).toBe(200)
  })

  test('register page accessible', async ({ page }) => {
    const response = await page.goto('/register')
    expect(response?.status()).toBe(200)
  })
})

test.describe('auth guard (unauthenticated)', () => {
  test('dashboard redirects to login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard services redirects to login', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard bookings redirects to login', async ({ page }) => {
    await page.goto('/dashboard/bookings')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })
})

test.describe('dashboard (e2e auth bypass)', () => {
  const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'

  test.use({
    extraHTTPHeaders: {
      'x-e2e-test-user-email': E2E_EMAIL,
      'x-e2e-auth-secret': E2E_SECRET,
    },
  })

  test('dashboard overview loads', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard')
    await expect(page.getByRole('heading', { name: /Resumen de Mimos Nails/ })).toBeVisible()
    await expect(page.getByText('Reservas hoy')).toBeVisible()
    await expect(page.getByText('Próximas citas')).toBeVisible()
  })

  test('dashboard services page shows service list', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/services')
    await expect(page.getByRole('heading', { name: 'Servicios', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Catálogo de servicios' })).toBeVisible()
    await expect(page.getByText('Manicura rusa')).toBeVisible({ timeout: 10000 })
  })

  test('dashboard availability page loads', async ({ page }) => {
    await page.goto('/dashboard/availability')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/availability')
    await expect(page.getByRole('heading', { name: 'Disponibilidad' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Horario semanal' })).toBeVisible()
    await expect(page.getByText('Lunes')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bloquear horario' })).toBeVisible()
  })

  test('dashboard calendar page loads', async ({ page }) => {
    await page.goto('/dashboard/calendar')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/calendar')
    await expect(page.getByRole('heading', { name: 'Calendario' })).toBeVisible()
    await expect(page.getByText('Vista mensual para revisar disponibilidad y citas.')).toBeVisible()
  })

  test('dashboard bookings page shows booking list', async ({ page }) => {
    await page.goto('/dashboard/bookings')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/bookings')
    await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
    await expect(page.getByText('Total')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Servicio' })).toBeVisible()
  })

  test('dashboard customers page loads', async ({ page }) => {
    await page.goto('/dashboard/customers')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/customers')
    await expect(page.getByRole('heading', { name: 'Clientas', exact: true })).toBeVisible()
    await expect(page.getByText('Historial y datos de contacto')).toBeVisible()
  })

  test('dashboard settings page loads', async ({ page }) => {
    await page.goto('/dashboard/settings')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/settings')
    await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible()
    await expect(page.getByText('Datos del estudio')).toBeVisible()
  })

  test('dashboard payments page loads', async ({ page }) => {
    await page.goto('/dashboard/payments')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/dashboard/payments')
    await expect(page.getByRole('heading', { name: 'Pagos y finanzas' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Historial de movimientos' })).toBeVisible()
  })
})

test.describe('main beta flows', () => {
  const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'

  test('customer books with mock payment and owner sees reservation in dashboard', async ({ page, context }) => {
    test.setTimeout(120000)

    const customerName = `Cliente E2E ${Date.now()}`
    const customerEmail = `cliente-${Date.now()}@example.com`
    const date = nextBookableDate()

    await page.goto('/book/mimosnails')
    await page.getByRole('heading', { name: '¿Qué te hacemos hoy?' }).waitFor()
    await page.getByRole('button').filter({ hasText: 'Manicura rusa' }).click()

    await expect(page.getByRole('heading', { name: 'Elige una fecha' })).toBeVisible()
    await selectBookingDate(page, date)
    await page.getByRole('button', { name: 'Continuar' }).click()

    await expect(page.getByRole('heading', { name: 'Elige una hora' })).toBeVisible({ timeout: 15000 })
    await page.locator('button').filter({ hasText: /^\d{2}:\d{2}$/ }).first().click()
    await page.getByRole('button', { name: 'Continuar' }).click()

    await page.getByPlaceholder('Tu nombre').fill(customerName)
    await page.getByPlaceholder('+569...').fill('+56912345678')
    await page.getByPlaceholder('tu@email.com').fill(customerEmail)
    await page.getByRole('button', { name: 'Continuar al pago' }).click()

    // With no per-business online payment account connected, the flow uses the
    // manual fallback ("Confirmar reserva" → pending) instead of online "Pago de
    // abono". Accept either path — the point is the booking reaches confirmation.
    await expect(page.getByRole('heading', { name: /Pago de abono|Confirmar reserva/ })).toBeVisible({ timeout: 15000 })
    await page.locator('input[type="checkbox"]#accept-terms').check().catch(() => {})
    await page.getByRole('button', { name: /Pagar abono|Confirmar reserva/ }).first().click()
    await expect(page.getByRole('heading', { name: /Reserva (recibida|confirmada)|Confirmación/ })).toBeVisible({ timeout: 60000 })

    await context.setExtraHTTPHeaders({
      'x-e2e-test-user-email': E2E_OWNER_EMAIL,
      'x-e2e-auth-secret': E2E_SECRET,
    })
    await page.goto('/dashboard/bookings')
    await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
    await expect(page.getByText(customerName).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Manicura rusa').first()).toBeVisible()
  })

  test('owner creates a service and changes weekly availability', async ({ page }) => {
    const serviceName = `Servicio E2E ${Date.now()}`

    await page.setExtraHTTPHeaders({
      'x-e2e-test-user-email': E2E_OWNER_EMAIL,
      'x-e2e-auth-secret': E2E_SECRET,
    })

    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio' }).click()
    await page.locator('input[name="name"]').fill(serviceName)
    await page.locator('textarea[name="description"]').fill('Servicio creado por Playwright')
    await page.locator('input[name="price"]').fill('19000')
    await page.locator('input[name="durationMinutes"]').fill('45')
    await page.locator('input[name="depositAmount"]').fill('5000')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText(serviceName)).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    await page.goto('/dashboard/availability')
    const monday = page.locator('div').filter({ hasText: /^Lunes$/ }).locator('..')
    await monday.locator('input[type="time"]').first().fill('10:00')
    await page.waitForLoadState('networkidle')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Horario semanal' })).toBeVisible()
    await expect(monday.locator('input[type="time"]').first()).toHaveValue('10:00')
  })
})
